/** Événement en attente d'envoi à Home Assistant. */
export interface OutgoingEvent {
	readonly eventType: string;
	readonly data: Record<string, unknown>;
	/** Horodatage de création (ms). */
	readonly createdAt: number;
}

/**
 * File des événements à envoyer quand Home Assistant est injoignable (acquittement, expiration…).
 * Bornée en taille et en âge : un acquittement vieux de plusieurs heures n'a plus de sens.
 */
export class Outbox {
	readonly #items: OutgoingEvent[] = [];
	readonly #maxSize: number;
	readonly #maxAgeMs: number;

	constructor(options: { maxSize?: number; maxAgeMs?: number } = {}) {
		this.#maxSize = options.maxSize ?? 50;
		this.#maxAgeMs = options.maxAgeMs ?? 15 * 60 * 1000;
	}

	get size(): number {
		return this.#items.length;
	}

	/** Met un événement en attente (le plus ancien est abandonné si la file est pleine). */
	push(eventType: string, data: Record<string, unknown>, now: number): void {
		this.#items.push({ eventType, data, createdAt: now });
		if (this.#items.length > this.#maxSize) this.#items.shift();
	}

	/** Vide la file et renvoie les événements encore assez récents, du plus ancien au plus récent. */
	drain(now: number): OutgoingEvent[] {
		const fresh = this.#items.filter((item) => now - item.createdAt <= this.#maxAgeMs);
		this.#items.length = 0;
		return fresh;
	}
}
