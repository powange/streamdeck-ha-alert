import type { KeyPosition } from "../render/frames";
import type { IdleLook } from "../render/svg";
import type { Grid } from "../render/text-layout";

/**
 * Alert key visible sur un appareil. Interface indépendante du SDK
 * pour que l'animateur et le gestionnaire d'alertes restent testables.
 */
export interface AlertKeyHandle {
	/** Identifiant de l'instance d'action (contexte Stream Deck). */
	readonly id: string;
	readonly deviceId: string;
	readonly deviceName: string;
	/** Grille de l'appareil (colonnes × lignes). */
	readonly grid: Grid;
	/** Position sur l'appareil, `null` dans une multi-action. */
	readonly position: KeyPosition | null;
	/** Apparence hors alerte, réglée dans l'inspecteur. */
	idle: IdleLook;
	setImage(image: string): Promise<void>;
}

/** Alert keys actuellement visibles, tous appareils confondus. */
export class KeyRegistry {
	readonly #keys = new Map<string, AlertKeyHandle>();

	add(key: AlertKeyHandle): void {
		this.#keys.set(key.id, key);
	}

	remove(id: string): AlertKeyHandle | undefined {
		const key = this.#keys.get(id);
		this.#keys.delete(id);
		return key;
	}

	get(id: string): AlertKeyHandle | undefined {
		return this.#keys.get(id);
	}

	all(): IterableIterator<AlertKeyHandle> {
		return this.#keys.values();
	}

	get size(): number {
		return this.#keys.size;
	}

	/** Alert keys visibles sur un appareil donné. */
	onDevice(deviceId: string): AlertKeyHandle[] {
		return [...this.#keys.values()].filter((key) => key.deviceId === deviceId);
	}

	/**
	 * Vrai si toutes les touches de l'appareil sont des Alert keys visibles : c'est le cas du
	 * profil Alerte, et pratiquement jamais d'une page normale.
	 */
	coversDevice(deviceId: string): boolean {
		const keys = this.onDevice(deviceId);
		const grid = keys[0]?.grid;
		if (!grid) return false;
		const positions = new Set(keys.flatMap((key) => (key.position ? [`${key.position.column},${key.position.row}`] : [])));
		return positions.size >= grid.columns * grid.rows;
	}
}
