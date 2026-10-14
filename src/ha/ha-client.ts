/**
 * Client WebSocket Home Assistant : authentification, abonnement aux événements,
 * heartbeat `ping`, reconnexion automatique avec backoff exponentiel et envoi d'événements.
 *
 * Utilise le WebSocket natif de Node.js 24. La fabrique de sockets et les timers
 * sont injectables pour les tests.
 */

/** État de la connexion, affiché par la touche « Statut HA ». */
export type ConnectionState =
	/** URL ou token manquant. */
	| "unconfigured"
	| "connecting"
	| "connected"
	/** Token refusé : pas de reconnexion avant un changement de paramètres. */
	| "auth_failed"
	/** Connecté, mais l'abonnement a échoué (le compte n'est pas administrateur). */
	| "forbidden"
	/** Connexion perdue, reconnexion programmée. */
	| "disconnected";

/** Sous-ensemble de l'API WebSocket utilisé par le client. */
export interface SocketLike {
	send(data: string): void;
	close(): void;
	onopen: ((ev: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onclose: ((ev: unknown) => void) | null;
	onerror: ((ev: unknown) => void) | null;
}

export interface HaClientOptions {
	readonly url: string;
	readonly token: string;
	/** Types d'événements à écouter. */
	readonly eventTypes: readonly string[];
	onEvent(eventType: string, data: unknown): void;
	onStateChange(state: ConnectionState, detail?: string): void;
	/** Fabrique de sockets (par défaut : WebSocket natif). */
	readonly createSocket?: (url: string) => SocketLike;
	/** Intervalle du heartbeat (ms). */
	readonly pingIntervalMs?: number;
	/** Délai maximal pour recevoir une réponse (ms). */
	readonly responseTimeoutMs?: number;
}

/** Délai avant la reconnexion n° `attempt` (0, 1, 2…) : 1 s, 2 s, 4 s… plafonné à 60 s, avec ±20 % d'aléa. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
	const base = Math.min(1000 * 2 ** attempt, 60_000);
	return Math.round(base * (0.8 + 0.4 * random()));
}

/**
 * Normalise l'URL saisie : accepte aussi `http(s)://hôte:8123` ou un simple `hôte:8123`,
 * et renvoie l'URL WebSocket complète (`ws(s)://…/api/websocket`), ou `null` si elle est invalide.
 */
export function normalizeHaUrl(input: string): string | null {
	let value = input.trim();
	if (value === "") return null;
	if (!/^[a-z]+:\/\//i.test(value)) value = `ws://${value}`;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol === "http:") url.protocol = "ws:";
	else if (url.protocol === "https:") url.protocol = "wss:";
	else if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
	if (url.pathname === "/" || url.pathname === "") url.pathname = "/api/websocket";
	url.search = "";
	url.hash = "";
	return url.toString();
}

interface Pending {
	resolve(result: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

/** Messages reçus de Home Assistant (champs utilisés seulement). */
interface HaMessage {
	type: string;
	id?: number;
	success?: boolean;
	result?: unknown;
	error?: { code?: string; message?: string };
	event?: { event_type?: string; data?: unknown };
	message?: string;
	ha_version?: string;
}

export class HaClient {
	readonly #options: HaClientOptions;
	readonly #pingIntervalMs: number;
	readonly #responseTimeoutMs: number;
	#socket: SocketLike | null = null;
	#state: ConnectionState = "disconnected";
	#nextId = 1;
	#attempt = 0;
	#stopped = true;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#pingTimer: ReturnType<typeof setInterval> | null = null;
	readonly #pending = new Map<number, Pending>();

	constructor(options: HaClientOptions) {
		this.#options = options;
		this.#pingIntervalMs = options.pingIntervalMs ?? 30_000;
		this.#responseTimeoutMs = options.responseTimeoutMs ?? 10_000;
	}

	get state(): ConnectionState {
		return this.#state;
	}

	/** Démarre la connexion (et les reconnexions automatiques). */
	start(): void {
		this.#stopped = false;
		this.#attempt = 0;
		this.#connect();
	}

	/** Ferme la connexion et annule toute reconnexion. */
	stop(): void {
		this.#stopped = true;
		this.#clearTimers();
		this.#closeSocket();
		this.#rejectPending(new Error("Client arrêté"));
	}

	/** Envoie un événement sur le bus Home Assistant (`fire_event`, compte administrateur requis). */
	async fireEvent(eventType: string, data: Record<string, unknown>): Promise<void> {
		if (this.#state !== "connected" && this.#state !== "forbidden") {
			throw new Error("Home Assistant n'est pas connecté");
		}
		await this.#request({ type: "fire_event", event_type: eventType, event_data: data });
	}

	#connect(): void {
		this.#clearTimers();
		this.#closeSocket();
		this.#setState("connecting");

		let socket: SocketLike;
		try {
			socket = (this.#options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike))(this.#options.url);
		} catch (error) {
			this.#scheduleReconnect(error instanceof Error ? error.message : String(error));
			return;
		}
		this.#socket = socket;
		this.#nextId = 1;

		socket.onmessage = (ev) => {
			if (this.#socket !== socket) return;
			let message: HaMessage;
			try {
				message = JSON.parse(String(ev.data)) as HaMessage;
			} catch {
				return;
			}
			this.#handleMessage(message);
		};
		socket.onclose = () => {
			if (this.#socket !== socket) return;
			this.#socket = null;
			this.#stopPing();
			this.#rejectPending(new Error("Connexion fermée"));
			if (this.#state === "auth_failed" || this.#stopped) return;
			this.#scheduleReconnect("connexion fermée");
		};
		// Une erreur est toujours suivie d'un `close` : la reconnexion est gérée là.
		socket.onerror = () => undefined;
	}

	#handleMessage(message: HaMessage): void {
		switch (message.type) {
			case "auth_required":
				this.#socket?.send(JSON.stringify({ type: "auth", access_token: this.#options.token }));
				return;
			case "auth_invalid":
				this.#setState("auth_failed", message.message ?? "token refusé");
				this.#closeSocket();
				return;
			case "auth_ok":
				this.#attempt = 0;
				void this.#subscribe(message.ha_version);
				this.#startPing();
				return;
			case "result":
			case "pong":
				this.#settle(message);
				return;
			case "event":
				if (message.event?.event_type) {
					this.#options.onEvent(message.event.event_type, message.event.data ?? {});
				}
				return;
		}
	}

	async #subscribe(version: string | undefined): Promise<void> {
		try {
			for (const eventType of this.#options.eventTypes) {
				await this.#request({ type: "subscribe_events", event_type: eventType });
			}
			this.#setState("connected", version ? `Home Assistant ${version}` : undefined);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			// HA réserve l'écoute des événements personnalisés aux administrateurs.
			this.#setState("forbidden", `abonnement refusé (${detail}) : le token doit appartenir à un administrateur`);
		}
	}

	#request(payload: Record<string, unknown>): Promise<unknown> {
		const socket = this.#socket;
		if (!socket) return Promise.reject(new Error("Connexion fermée"));
		const id = this.#nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error("Pas de réponse de Home Assistant"));
			}, this.#responseTimeoutMs);
			this.#pending.set(id, { resolve, reject, timer });
			socket.send(JSON.stringify({ id, ...payload }));
		});
	}

	#settle(message: HaMessage): void {
		if (message.id === undefined) return;
		const pending = this.#pending.get(message.id);
		if (!pending) return;
		this.#pending.delete(message.id);
		clearTimeout(pending.timer);
		if (message.type === "pong" || message.success) {
			pending.resolve(message.result);
		} else {
			pending.reject(new Error(message.error?.message ?? message.error?.code ?? "erreur inconnue"));
		}
	}

	#startPing(): void {
		this.#stopPing();
		this.#pingTimer = setInterval(() => {
			// Sans `pong` dans le délai, on considère la connexion morte et on la relance.
			this.#request({ type: "ping" }).catch(() => {
				if (!this.#stopped && this.#state !== "auth_failed") this.#connect();
			});
		}, this.#pingIntervalMs);
	}

	#stopPing(): void {
		if (this.#pingTimer) clearInterval(this.#pingTimer);
		this.#pingTimer = null;
	}

	#scheduleReconnect(reason: string): void {
		if (this.#stopped) return;
		const delay = backoffDelay(this.#attempt++);
		this.#setState("disconnected", `${reason}, nouvelle tentative dans ${Math.round(delay / 1000)} s`);
		this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
	}

	#setState(state: ConnectionState, detail?: string): void {
		this.#state = state;
		this.#options.onStateChange(state, detail);
	}

	#closeSocket(): void {
		const socket = this.#socket;
		this.#socket = null;
		if (socket) {
			socket.onclose = null;
			socket.onmessage = null;
			socket.onerror = null;
			try {
				socket.close();
			} catch {
				// Socket déjà fermée.
			}
		}
	}

	#clearTimers(): void {
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = null;
		this.#stopPing();
	}

	#rejectPending(error: Error): void {
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.#pending.clear();
	}
}

/**
 * Teste une URL et un token sans toucher à la connexion principale :
 * authentification puis abonnement d'essai (vérifie aussi les droits administrateur).
 */
export function testConnection(
	url: string,
	token: string,
	createSocket?: (url: string) => SocketLike,
	timeoutMs = 10_000,
): Promise<{ ok: boolean; message: string }> {
	return new Promise((resolve) => {
		let done = false;
		const client = new HaClient({
			url,
			token,
			eventTypes: ["streamdeck_alert"],
			onEvent: () => undefined,
			onStateChange: (state, detail) => {
				if (state === "connected") finish(true, `Connecté${detail ? ` à ${detail}` : ""}.`);
				else if (state === "auth_failed") finish(false, "Token refusé par Home Assistant.");
				else if (state === "forbidden") finish(false, "Connecté, mais le compte n'est pas administrateur : HA refuse l'écoute des événements.");
				else if (state === "disconnected") finish(false, `Connexion impossible (${detail ?? "erreur réseau"}).`);
			},
			responseTimeoutMs: timeoutMs,
			...(createSocket ? { createSocket } : {}),
		});
		const timer = setTimeout(() => finish(false, "Délai dépassé : Home Assistant ne répond pas."), timeoutMs);

		function finish(ok: boolean, message: string): void {
			if (done) return;
			done = true;
			clearTimeout(timer);
			client.stop();
			resolve({ ok, message });
		}

		client.start();
	});
}
