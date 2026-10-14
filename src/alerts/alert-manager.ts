import { AlertQueue, type QueuedAlert } from "./alert-queue";
import type { Alert, ClearRequest } from "./schema";

/** Alerte affichée, avec l'instant de début d'affichage (base de temps des animations). */
export interface DisplayedAlert {
	readonly alert: Alert;
	readonly startedAt: number;
	/** Réception de l'alerte : change quand HA renvoie une alerte de même id (nouvelle sonnerie…). */
	readonly receivedAt: number;
}

export interface AlertManagerOptions {
	/** Envoie un événement à Home Assistant. */
	fire(eventType: string, data: Record<string, unknown>): void;
	/** Appelé quand l'alerte affichée ou la file change. */
	onChange(): void;
	now?(): number;
	log?(message: string): void;
}

/** Appareil sur lequel une alerte est acquittée. */
export interface AckSource {
	readonly deviceId: string;
	readonly deviceName: string;
}

/**
 * Logique des alertes, indépendante du SDK : file de priorité, expiration,
 * acquittement et navigation. Le rendu et les profils réagissent à `onChange`.
 */
export class AlertManager {
	readonly #queue = new AlertQueue();
	readonly #options: AlertManagerOptions;
	readonly #now: () => number;
	#expiryTimer: ReturnType<typeof setTimeout> | null = null;
	/** Alerte affichée et début de son affichage, pour redémarrer l'animation quand elle change. */
	#displayed: { queued: QueuedAlert; startedAt: number } | null = null;

	constructor(options: AlertManagerOptions) {
		this.#options = options;
		this.#now = options.now ?? Date.now;
	}

	/** Alerte actuellement affichée. */
	current(): DisplayedAlert | undefined {
		const displayed = this.#displayed;
		return displayed ? { alert: displayed.queued.alert, startedAt: displayed.startedAt, receivedAt: displayed.queued.receivedAt } : undefined;
	}

	/** Position de l'alerte affichée dans la file (badge « 1/3 »). */
	position(): { index: number; total: number } | null {
		return this.#queue.position();
	}

	/** Identifiants des alertes actives, de la plus prioritaire à la moins prioritaire. */
	activeIds(): string[] {
		return this.#queue.list().map((q) => q.alert.id);
	}

	/** Vrai s'il reste au moins une alerte `fullscreen` dans la file. */
	anyFullscreen(): boolean {
		return this.#queue.list().some((q) => q.alert.mode === "fullscreen");
	}

	/** Nombre d'alertes actives. */
	get size(): number {
		return this.#queue.size;
	}

	/** Nouvelle alerte (ou mise à jour d'une alerte de même id). */
	handleAlert(alert: Alert): void {
		this.#queue.upsert(alert, this.#now());
		this.#log(`alerte « ${alert.id} » ajoutée (priorité ${alert.priority}, ${this.#queue.size} active(s))`);
		this.#update();
	}

	/** Effacement demandé par Home Assistant : une alerte, ou toutes sans id. */
	handleClear(request: ClearRequest): void {
		if (request.id === undefined) {
			const removed = this.#queue.clear();
			this.#log(`toutes les alertes effacées (${removed.length})`);
		} else if (this.#queue.remove(request.id)) {
			this.#log(`alerte « ${request.id} » effacée`);
		}
		this.#update();
	}

	/**
	 * Acquitte l'alerte affichée (appui sur une Alert key). L'événement `streamdeck_alert_ack`
	 * n'est envoyé que si l'alerte le demande (`ack_required`). Renvoie `false` sans alerte.
	 */
	acknowledge(source: AckSource): boolean {
		const current = this.#queue.current();
		if (!current) return false;
		this.#queue.remove(current.alert.id);
		this.#log(`alerte « ${current.alert.id} » acquittée sur ${source.deviceName}`);
		if (current.alert.ack_required) {
			this.#options.fire("streamdeck_alert_ack", { id: current.alert.id, device: source.deviceName, device_id: source.deviceId });
		}
		this.#update();
		return true;
	}

	/** Acquitte toutes les alertes (touche ✖✖). */
	acknowledgeAll(source: AckSource): void {
		for (const queued of this.#queue.clear()) {
			if (queued.alert.ack_required) {
				this.#options.fire("streamdeck_alert_ack", { id: queued.alert.id, device: source.deviceName, device_id: source.deviceId });
			}
		}
		this.#log(`toutes les alertes acquittées sur ${source.deviceName}`);
		this.#update();
	}

	/** Parcourt la file sans acquitter (◀ = -1, ▶ = +1). */
	navigate(step: number): void {
		this.#queue.navigate(step);
		this.#update();
	}

	/** Arrête le timer d'expiration. */
	dispose(): void {
		if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
		this.#expiryTimer = null;
	}

	#expire(): void {
		for (const queued of this.#queue.expire(this.#now())) {
			this.#log(`alerte « ${queued.alert.id} » expirée sans acquittement`);
			this.#options.fire("streamdeck_alert_expired", { id: queued.alert.id });
		}
		this.#update();
	}

	/** Met à jour l'alerte affichée, reprogramme l'expiration et prévient les observateurs. */
	#update(): void {
		const current = this.#queue.current();
		if (!current) {
			this.#displayed = null;
		} else if (this.#displayed?.queued !== current) {
			// Nouvelle alerte affichée (ou mise à jour de la même) : l'animation repart de zéro,
			// et sa durée d'affichage commence si c'est son premier affichage.
			this.#displayed = { queued: current, startedAt: this.#now() };
			this.#queue.markDisplayed(current.alert.id, this.#now());
		}

		this.dispose();
		const next = this.#queue.nextExpiry();
		if (next !== null) {
			this.#expiryTimer = setTimeout(() => this.#expire(), Math.max(0, next - this.#now()));
		}
		this.#options.onChange();
	}

	#log(message: string): void {
		this.#options.log?.(message);
	}
}
