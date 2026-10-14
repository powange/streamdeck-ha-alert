import type { AlertKeyHandle } from "../devices/key-registry";

/** Débit maximal d'images envoyées au logiciel Stream Deck, toutes touches confondues. */
export const MAX_IMAGES_PER_SECOND = 200;
/** Intervalle minimal entre deux ticks : 10 images par seconde au plus. */
export const MIN_TICK_MS = 100;

/**
 * Intervalle du tick selon le nombre de touches : 100 ms (10 fps) tant que le débit
 * reste sous MAX_IMAGES_PER_SECOND, plus lent au-delà (Stream Deck XL, plusieurs appareils).
 */
export function tickInterval(keyCount: number): number {
	return Math.max(MIN_TICK_MS, Math.ceil((keyCount * 1000) / MAX_IMAGES_PER_SECOND));
}

export interface AnimatorOptions {
	/** Touches à dessiner. */
	keys(): Iterable<AlertKeyHandle>;
	/** Image (data URL) d'une touche à l'instant `now`. */
	render(key: AlertKeyHandle, now: number): string;
	now?(): number;
	onError?(error: unknown): void;
}

/**
 * Timer central unique : à chaque tick, calcule l'image de chaque touche et
 * n'envoie `setImage` que pour celles dont l'image a changé.
 */
export class Animator {
	readonly #options: AnimatorOptions;
	readonly #now: () => number;
	/** Dernière image envoyée à chaque touche. */
	readonly #sent = new Map<string, string>();
	#timer: ReturnType<typeof setTimeout> | null = null;
	#animating = false;

	constructor(options: AnimatorOptions) {
		this.#options = options;
		this.#now = options.now ?? Date.now;
	}

	get animating(): boolean {
		return this.#animating;
	}

	/** Démarre ou arrête le tick périodique (inutile sans alerte affichée). */
	setAnimating(on: boolean): void {
		if (on === this.#animating) return;
		this.#animating = on;
		if (on) {
			this.#tick();
		} else if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
	}

	/** Redessine toutes les touches immédiatement (changement d'alerte, de réglages…). */
	refresh(): void {
		this.#draw();
	}

	/** Redessine une touche immédiatement, même si son image n'a pas changé (touche qui réapparaît). */
	draw(key: AlertKeyHandle): void {
		this.#sent.delete(key.id);
		this.#drawKey(key, this.#now());
	}

	/** Oublie une touche qui n'est plus visible. */
	forget(id: string): void {
		this.#sent.delete(id);
	}

	#tick(): void {
		const count = this.#draw();
		if (this.#animating) {
			this.#timer = setTimeout(() => this.#tick(), tickInterval(count));
		}
	}

	/** Dessine toutes les touches ; renvoie leur nombre. */
	#draw(): number {
		const now = this.#now();
		let count = 0;
		for (const key of this.#options.keys()) {
			this.#drawKey(key, now);
			count++;
		}
		return count;
	}

	#drawKey(key: AlertKeyHandle, now: number): void {
		let image: string;
		try {
			image = this.#options.render(key, now);
		} catch (error) {
			this.#options.onError?.(error);
			return;
		}
		if (this.#sent.get(key.id) === image) return;
		this.#sent.set(key.id, image);
		key.setImage(image).catch((error: unknown) => {
			// En cas d'échec, l'image sera renvoyée au prochain tick.
			this.#sent.delete(key.id);
			this.#options.onError?.(error);
		});
	}
}
