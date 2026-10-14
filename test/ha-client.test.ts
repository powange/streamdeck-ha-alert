import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffDelay, HaClient, normalizeHaUrl, testConnection, type ConnectionState, type SocketLike } from "../src/ha/ha-client";

/** Faux WebSocket : enregistre les messages envoyés et simule les réponses de Home Assistant. */
class FakeSocket implements SocketLike {
	readonly sent: Record<string, unknown>[] = [];
	closed = false;
	onopen: ((ev: unknown) => void) | null = null;
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	onclose: ((ev: unknown) => void) | null = null;
	onerror: ((ev: unknown) => void) | null = null;

	send(data: string): void {
		this.sent.push(JSON.parse(data) as Record<string, unknown>);
	}
	close(): void {
		this.closed = true;
	}
	receive(message: Record<string, unknown>): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}
	/** Fermeture côté serveur (coupure réseau, redémarrage de HA…). */
	drop(): void {
		this.onclose?.({});
	}
	last(): Record<string, unknown> | undefined {
		return this.sent.at(-1);
	}
}

/** Laisse les promesses en attente se résoudre. */
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(options: { pingIntervalMs?: number } = {}) {
	const sockets: FakeSocket[] = [];
	const states: ConnectionState[] = [];
	const events: [string, unknown][] = [];
	const client = new HaClient({
		url: "ws://ha.local:8123/api/websocket",
		token: "secret",
		eventTypes: ["streamdeck_alert", "streamdeck_alert_clear"],
		onEvent: (type, data) => events.push([type, data]),
		onStateChange: (state) => states.push(state),
		createSocket: () => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		...options,
	});
	return { client, sockets, states, events, socket: () => sockets.at(-1)! };
}

/** Déroule l'authentification et répond favorablement aux abonnements. */
async function authenticate(socket: FakeSocket): Promise<void> {
	socket.receive({ type: "auth_required" });
	socket.receive({ type: "auth_ok", ha_version: "2026.10.0" });
	for (let i = 0; i < 2; i++) {
		await flush();
		const request = socket.last();
		socket.receive({ id: request?.id, type: "result", success: true, result: null });
	}
	await flush();
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("HaClient", () => {
	it("s'authentifie avec le token puis s'abonne aux deux événements", async () => {
		const { client, socket, states } = setup();
		client.start();
		socket().receive({ type: "auth_required" });
		expect(socket().last()).toEqual({ type: "auth", access_token: "secret" });

		await authenticate(socket());
		const subscriptions = socket().sent.filter((m) => m.type === "subscribe_events");
		expect(subscriptions.map((m) => m.event_type)).toEqual(["streamdeck_alert", "streamdeck_alert_clear"]);
		expect(new Set(subscriptions.map((m) => m.id)).size).toBe(2);
		expect(states).toEqual(["connecting", "connected"]);
		client.stop();
	});

	it("transmet les événements reçus", async () => {
		const { client, socket, events } = setup();
		client.start();
		await authenticate(socket());
		socket().receive({ id: 1, type: "event", event: { event_type: "streamdeck_alert", data: { id: "sonnette" } } });
		expect(events).toEqual([["streamdeck_alert", { id: "sonnette" }]]);
		client.stop();
	});

	it("ne se reconnecte pas si le token est refusé", async () => {
		const { client, sockets, socket, states } = setup();
		client.start();
		socket().receive({ type: "auth_required" });
		socket().receive({ type: "auth_invalid", message: "Invalid access token" });
		expect(states.at(-1)).toBe("auth_failed");
		expect(socket().closed).toBe(true);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(sockets).toHaveLength(1);
	});

	it("signale un compte non administrateur quand l'abonnement est refusé", async () => {
		const { client, socket, states } = setup();
		client.start();
		socket().receive({ type: "auth_required" });
		socket().receive({ type: "auth_ok" });
		await flush();
		socket().receive({ id: socket().last()?.id, type: "result", success: false, error: { code: "unauthorized", message: "Unauthorized" } });
		await flush();
		expect(states.at(-1)).toBe("forbidden");
		client.stop();
	});

	it("se reconnecte avec un backoff exponentiel après une coupure", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5); // pas d'aléa : 1 s, 2 s, 4 s…
		const { client, sockets, socket, states } = setup();
		client.start();
		await authenticate(socket());

		socket().drop();
		expect(states.at(-1)).toBe("disconnected");
		await vi.advanceTimersByTimeAsync(999);
		expect(sockets).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(sockets).toHaveLength(2);

		// Deuxième échec consécutif : 2 s d'attente.
		socket().drop();
		await vi.advanceTimersByTimeAsync(1999);
		expect(sockets).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(sockets).toHaveLength(3);

		// Une connexion réussie remet le compteur à zéro.
		await authenticate(socket());
		socket().drop();
		await vi.advanceTimersByTimeAsync(1000);
		expect(sockets).toHaveLength(4);
		client.stop();
	});

	it("envoie un ping régulier et relance la connexion sans pong", async () => {
		const { client, sockets, socket } = setup({ pingIntervalMs: 30_000 });
		client.start();
		await authenticate(socket());

		await vi.advanceTimersByTimeAsync(30_000);
		const ping = socket().last();
		expect(ping?.type).toBe("ping");
		socket().receive({ id: ping?.id, type: "pong" });
		await vi.advanceTimersByTimeAsync(10_000);
		expect(sockets).toHaveLength(1);

		// Ping suivant sans réponse : nouvelle connexion après le délai de réponse.
		await vi.advanceTimersByTimeAsync(20_000);
		expect(socket().last()?.type).toBe("ping");
		await vi.advanceTimersByTimeAsync(10_000);
		expect(sockets).toHaveLength(2);
		client.stop();
	});

	it("envoie un événement avec fire_event", async () => {
		const { client, socket } = setup();
		client.start();
		await authenticate(socket());

		const sent = client.fireEvent("streamdeck_alert_ack", { id: "sonnette", device: "ABC" });
		const request = socket().last();
		expect(request).toMatchObject({ type: "fire_event", event_type: "streamdeck_alert_ack", event_data: { id: "sonnette", device: "ABC" } });
		socket().receive({ id: request?.id, type: "result", success: true, result: { context: {} } });
		await expect(sent).resolves.toBeUndefined();
		client.stop();
	});

	it("refuse d'envoyer un événement hors connexion", async () => {
		const { client } = setup();
		await expect(client.fireEvent("x", {})).rejects.toThrow("pas connecté");
	});

	it("ne signale pas « pas admin » si la connexion tombe pendant l'abonnement", async () => {
		const { client, socket, states } = setup();
		client.start();
		socket().receive({ type: "auth_required" });
		socket().receive({ type: "auth_ok" });
		await flush();
		socket().drop();
		await flush();
		expect(states).not.toContain("forbidden");
		expect(states.at(-1)).toBe("disconnected");
		client.stop();
	});

	it("abandonne une connexion sans réponse d'authentification et réessaie plus tard", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const { client, sockets, socket, states } = setup();
		client.start();
		// Serveur qui accepte le WebSocket mais n'envoie jamais auth_required.
		await vi.advanceTimersByTimeAsync(10_000);
		expect(socket().closed).toBe(true);
		expect(states.at(-1)).toBe("disconnected");
		await vi.advanceTimersByTimeAsync(1000);
		expect(sockets).toHaveLength(2);
		client.stop();
	});

	it("respecte le délai de reconnexion quand la connexion tombe pendant un ping", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const { client, sockets, socket } = setup({ pingIntervalMs: 30_000 });
		client.start();
		await authenticate(socket());
		await vi.advanceTimersByTimeAsync(30_000);
		expect(socket().last()?.type).toBe("ping");
		socket().drop();
		await flush();
		// Pas de reconnexion immédiate : on attend le délai (1 s pour le premier essai).
		expect(sockets).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(sockets).toHaveLength(2);
		client.stop();
	});

	it("arrête toute reconnexion après stop()", async () => {
		const { client, sockets, socket } = setup();
		client.start();
		socket().drop();
		client.stop();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(sockets).toHaveLength(1);
	});
});

describe("testConnection", () => {
	it("réussit après authentification et abonnement d'essai", async () => {
		let socket: FakeSocket | undefined;
		const result = testConnection("ws://ha/api/websocket", "secret", () => (socket = new FakeSocket()));
		socket!.receive({ type: "auth_required" });
		socket!.receive({ type: "auth_ok", ha_version: "2026.10.0" });
		await flush();
		socket!.receive({ id: socket!.last()?.id, type: "result", success: true });
		await expect(result).resolves.toEqual({ ok: true, message: "Connecté à Home Assistant 2026.10.0." });
		expect(socket!.closed).toBe(true);
	});

	it("échoue clairement si le token est refusé", async () => {
		let socket: FakeSocket | undefined;
		const result = testConnection("ws://ha/api/websocket", "faux", () => (socket = new FakeSocket()));
		socket!.receive({ type: "auth_required" });
		socket!.receive({ type: "auth_invalid" });
		await expect(result).resolves.toEqual({ ok: false, message: "Token refusé par Home Assistant." });
	});

	it("échoue après le délai si Home Assistant ne répond pas", async () => {
		const result = testConnection("ws://ha/api/websocket", "secret", () => new FakeSocket(), 5_000);
		await vi.advanceTimersByTimeAsync(5_000);
		await expect(result).resolves.toMatchObject({ ok: false });
	});
});

describe("backoffDelay", () => {
	it("double à chaque tentative et plafonne à 60 s", () => {
		const fixed = () => 0.5;
		expect([0, 1, 2, 3, 6, 10].map((a) => backoffDelay(a, fixed))).toEqual([1000, 2000, 4000, 8000, 60_000, 60_000]);
	});

	it("ajoute ±20 % d'aléa", () => {
		expect(backoffDelay(0, () => 0)).toBe(800);
		expect(backoffDelay(0, () => 1)).toBe(1200);
	});
});

describe("normalizeHaUrl", () => {
	it.each([
		["ws://ha.local:8123/api/websocket", "ws://ha.local:8123/api/websocket"],
		["http://ha.local:8123", "ws://ha.local:8123/api/websocket"],
		["https://maison.example.com/", "wss://maison.example.com/api/websocket"],
		["192.168.1.10:8123", "ws://192.168.1.10:8123/api/websocket"],
		["  wss://ha.example.com/api/websocket  ", "wss://ha.example.com/api/websocket"],
		["http://ha.local:8123/lovelace/0?edit=1", "ws://ha.local:8123/api/websocket"],
		["https://maison.example.com/ha/api/websocket", "wss://maison.example.com/ha/api/websocket"],
	])("%s → %s", (input, expected) => {
		expect(normalizeHaUrl(input)).toBe(expected);
	});

	it.each(["", "   ", "ftp://ha.local", "http://"])("refuse %j", (input) => {
		expect(normalizeHaUrl(input)).toBeNull();
	});
});
