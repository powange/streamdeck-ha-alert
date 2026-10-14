import type { ProfileMap } from "./profiles";

/** Appareil vu par le contrôleur de profils. */
export interface DeviceInfo {
	readonly id: string;
	readonly name: string;
	readonly type: number;
	readonly isConnected: boolean;
}

export interface ProfileControllerOptions {
	readonly profiles: ProfileMap;
	devices(): Iterable<DeviceInfo>;
	/** `profile` absent : retour au profil précédent (comportement documenté du SDK). */
	switchToProfile(deviceId: string, profile?: string): Promise<void>;
	/** Nombre d'Alert keys actuellement visibles sur l'appareil. */
	visibleKeys(deviceId: string): number;
	log?(message: string): void;
	/** Délai avant de conclure que l'utilisateur a quitté le profil Alerte (ms). */
	leaveDelayMs?: number;
}

/** Ce que veut l'alerte affichée. */
export interface FullscreenRequest {
	/** Identifiant de l'alerte affichée. */
	readonly alertId: string;
	/** L'alerte affichée est en mode `fullscreen`. */
	readonly fullscreen: boolean;
	/** Il reste au moins une alerte `fullscreen` dans la file. */
	readonly anyFullscreen: boolean;
}

/**
 * Bascule chaque appareil vers son profil « Alerte » et l'en fait revenir.
 *
 * Le SDK ne permet pas de connaître le profil affiché : on suit donc l'état de chaque appareil.
 * `switchToProfile(device)` sans nom ramène au profil précédent, sur la page qui était affichée ;
 * il n'y a qu'un niveau de « précédent », d'où le soin à ne jamais rebasculer un appareil déjà
 * sur le profil Alerte.
 */
export class ProfileController {
	readonly #options: ProfileControllerOptions;
	/** Appareils actuellement basculés sur le profil Alerte. */
	readonly #inAlert = new Set<string>();
	/** Appareils dont l'utilisateur a quitté le profil Alerte, avec l'alerte alors affichée. */
	readonly #dismissed = new Map<string, string>();
	readonly #leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	#request: FullscreenRequest | null = null;

	constructor(options: ProfileControllerOptions) {
		this.#options = options;
	}

	/** Vrai si l'appareil affiche (en principe) le profil Alerte. */
	isInAlertProfile(deviceId: string): boolean {
		return this.#inAlert.has(deviceId);
	}

	/** Vrai si un profil Alerte est déclaré pour ce type d'appareil. */
	hasProfile(type: number): boolean {
		return this.#options.profiles.has(type);
	}

	/**
	 * Applique l'état voulu à tous les appareils. On entre dans le profil quand l'alerte affichée
	 * est `fullscreen`, et on y reste tant qu'il reste une alerte `fullscreen` dans la file
	 * (pour pouvoir parcourir la file avec ◀ ▶ sans rebasculer).
	 */
	sync(request: FullscreenRequest | null): void {
		this.#request = request;
		for (const device of this.#options.devices()) {
			this.#syncDevice(device);
		}
		if (!request?.anyFullscreen) this.#dismissed.clear();
	}

	/** À appeler quand des Alert keys apparaissent ou disparaissent sur un appareil. */
	keysChanged(deviceId: string): void {
		if (!this.#inAlert.has(deviceId) || this.#leaveTimers.has(deviceId)) return;
		if (this.#options.visibleKeys(deviceId) > 0) return;
		// Pendant une bascule, les touches de l'ancienne page disparaissent avant que celles du
		// profil Alerte n'apparaissent : on attend un peu avant de conclure à une sortie manuelle.
		this.#leaveTimers.set(
			deviceId,
			setTimeout(() => {
				this.#leaveTimers.delete(deviceId);
				if (!this.#inAlert.has(deviceId) || this.#options.visibleKeys(deviceId) > 0) return;
				this.#inAlert.delete(deviceId);
				if (this.#request) this.#dismissed.set(deviceId, this.#request.alertId);
				this.#log(`${deviceId} : profil Alerte quitté manuellement, pas de retour automatique`);
			}, this.#options.leaveDelayMs ?? 1000),
		);
	}

	/** Appareil déconnecté : on oublie son état (il sera rebasculé à la reconnexion si besoin). */
	deviceDisconnected(deviceId: string): void {
		this.#inAlert.delete(deviceId);
		this.#dismissed.delete(deviceId);
		const timer = this.#leaveTimers.get(deviceId);
		if (timer) clearTimeout(timer);
		this.#leaveTimers.delete(deviceId);
	}

	/** Appareil (re)connecté : applique l'état voulu. */
	deviceConnected(device: DeviceInfo): void {
		this.#syncDevice(device);
	}

	/** Ramène l'appareil au profil précédent (appui sur une touche du profil Alerte hors alerte). */
	leave(deviceId: string): void {
		this.#inAlert.delete(deviceId);
		this.#switch(deviceId, undefined);
	}

	#syncDevice(device: DeviceInfo): void {
		const profile = this.#options.profiles.get(device.type);
		if (!profile || !device.isConnected) return;
		const request = this.#request;
		const inAlert = this.#inAlert.has(device.id);

		if (!inAlert && request?.fullscreen && this.#dismissed.get(device.id) !== request.alertId) {
			this.#inAlert.add(device.id);
			this.#dismissed.delete(device.id);
			this.#log(`${device.name} : bascule vers ${profile}`);
			this.#switch(device.id, profile);
		} else if (inAlert && !request?.anyFullscreen) {
			this.#inAlert.delete(device.id);
			this.#log(`${device.name} : retour au profil précédent`);
			this.#switch(device.id, undefined);
		}
	}

	#switch(deviceId: string, profile: string | undefined): void {
		this.#options.switchToProfile(deviceId, profile).catch((error: unknown) => {
			this.#log(`${deviceId} : changement de profil impossible (${error instanceof Error ? error.message : String(error)})`);
		});
	}

	#log(message: string): void {
		this.#options.log?.(message);
	}
}
