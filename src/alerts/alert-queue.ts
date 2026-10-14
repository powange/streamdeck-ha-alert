import type { Alert } from "./schema";

/** Alerte présente dans la file, avec ses informations de suivi. */
export interface QueuedAlert {
	readonly alert: Alert;
	/** Horodatage de réception (ms). */
	readonly receivedAt: number;
	/** Horodatage d'expiration (ms), ou `null` si l'alerte reste jusqu'à l'acquittement ou un clear. */
	readonly expiresAt: number | null;
	/** Numéro d'ordre d'arrivée : départage les alertes de même priorité (la plus récente d'abord). */
	readonly seq: number;
}

/**
 * File des alertes actives, triée par priorité décroissante puis par arrivée la plus récente.
 *
 * Elle gère aussi un curseur de consultation (touches ◀ ▶) : par défaut, l'alerte affichée
 * est la plus prioritaire ; l'utilisateur peut parcourir les autres sans les acquitter.
 * Le temps est toujours passé en paramètre pour rester testable.
 */
export class AlertQueue {
	readonly #items = new Map<string, QueuedAlert>();
	#seq = 0;
	/** Alerte choisie avec ◀ ▶, ou `null` pour suivre automatiquement la plus prioritaire. */
	#selectedId: string | null = null;

	/** Nombre d'alertes actives. */
	get size(): number {
		return this.#items.size;
	}

	/**
	 * Ajoute une alerte, ou remplace celle qui a le même `id`.
	 * Si elle devient la plus prioritaire, l'affichage revient sur elle.
	 */
	upsert(alert: Alert, now: number): QueuedAlert {
		const queued: QueuedAlert = {
			alert,
			receivedAt: now,
			expiresAt: alert.duration_s > 0 ? now + alert.duration_s * 1000 : null,
			seq: ++this.#seq,
		};
		this.#items.set(alert.id, queued);
		if (this.top()?.alert.id === alert.id) {
			this.#selectedId = null;
		}
		return queued;
	}

	/** Retire une alerte (acquittement ou clear ciblé). */
	remove(id: string): QueuedAlert | undefined {
		const queued = this.#items.get(id);
		this.#items.delete(id);
		if (this.#selectedId === id) {
			this.#selectedId = null;
		}
		return queued;
	}

	/** Vide la file et renvoie les alertes retirées. */
	clear(): QueuedAlert[] {
		const removed = this.list();
		this.#items.clear();
		this.#selectedId = null;
		return removed;
	}

	/** Retire les alertes expirées à l'instant `now` et les renvoie. */
	expire(now: number): QueuedAlert[] {
		const expired = this.list().filter((q) => q.expiresAt !== null && q.expiresAt <= now);
		for (const q of expired) {
			this.remove(q.alert.id);
		}
		return expired;
	}

	/** Prochaine échéance d'expiration, ou `null` s'il n'y en a aucune. */
	nextExpiry(): number | null {
		let next: number | null = null;
		for (const q of this.#items.values()) {
			if (q.expiresAt !== null && (next === null || q.expiresAt < next)) {
				next = q.expiresAt;
			}
		}
		return next;
	}

	/** Alertes triées : priorité décroissante, puis la plus récente d'abord. */
	list(): QueuedAlert[] {
		return [...this.#items.values()].sort((a, b) => b.alert.priority - a.alert.priority || b.seq - a.seq);
	}

	/** Alerte la plus prioritaire. */
	top(): QueuedAlert | undefined {
		return this.list()[0];
	}

	/** Alerte actuellement affichée : celle choisie avec ◀ ▶, sinon la plus prioritaire. */
	current(): QueuedAlert | undefined {
		return (this.#selectedId !== null ? this.#items.get(this.#selectedId) : undefined) ?? this.top();
	}

	/** Position (à partir de 1) de l'alerte affichée et taille de la file, pour le badge « 1/3 ». */
	position(): { index: number; total: number } | null {
		const current = this.current();
		if (!current) return null;
		const index = this.list().findIndex((q) => q.alert.id === current.alert.id);
		return { index: index + 1, total: this.size };
	}

	/** Parcourt la file (◀ = -1, ▶ = +1), en boucle. Renvoie la nouvelle alerte affichée. */
	navigate(step: number): QueuedAlert | undefined {
		const items = this.list();
		const current = this.current();
		if (!current || items.length === 0) return undefined;
		const index = items.findIndex((q) => q.alert.id === current.alert.id);
		const target = items[(((index + step) % items.length) + items.length) % items.length];
		this.#selectedId = target && target !== items[0] ? target.alert.id : null;
		return target;
	}
}
