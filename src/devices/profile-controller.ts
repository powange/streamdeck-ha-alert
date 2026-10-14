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
	/**
	 * Vrai si le profil Alerte est affiché sur l'appareil, c'est-à-dire si toute la grille est
	 * couverte d'Alert keys visibles (le profil n'en contient pas d'autres).
	 */
	isAlertProfileVisible(deviceId: string): boolean;
	/** Appelé quand un appareil entre dans le profil Alerte ou en sort (pour redessiner). */
	onChange?(): void;
	log?(message: string): void;
	/** Délai pour voir apparaître le profil Alerte après la demande de bascule (ms). */
	confirmTimeoutMs?: number;
	/** Délai avant de conclure que l'utilisateur a quitté le profil Alerte (ms). */
	leaveDelayMs?: number;
}

/** Ce que veut l'alerte affichée. */
export interface FullscreenRequest {
	/**
	 * Identifie l'alerte et son envoi : une alerte renvoyée par HA avec le même id (nouvelle
	 * sonnerie) a un autre jeton, et rebascule un appareil dont on avait quitté le profil.
	 */
	readonly token: string;
	/** L'alerte affichée est en mode `fullscreen`. */
	readonly fullscreen: boolean;
	/** Il reste au moins une alerte `fullscreen` dans la file. */
	readonly anyFullscreen: boolean;
}

/** Suivi d'un appareil basculé (ou en cours de bascule) sur le profil Alerte. */
interface DeviceState {
	/** `pending` : bascule demandée, profil pas encore vu ; `shown` : profil affiché. */
	phase: "pending" | "shown";
	/** Retour demandé avant la confirmation de la bascule : à faire dès qu'elle est confirmée. */
	returnWhenShown: boolean;
	timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Bascule chaque appareil vers son profil « Alerte » et l'en fait revenir.
 *
 * Le SDK ne dit pas quel profil est affiché, et `switchToProfile(device)` sans nom ramène
 * au profil *précédent* : un retour demandé alors que la bascule n'a pas eu lieu enverrait
 * l'utilisateur sur un autre profil. Le contrôleur ne revient donc en arrière que depuis un
 * profil Alerte effectivement vu (grille couverte d'Alert keys), et ne rebascule jamais un
 * appareil qui y est déjà.
 */
export class ProfileController {
	readonly #options: ProfileControllerOptions;
	readonly #states = new Map<string, DeviceState>();
	/** Appareils dont l'utilisateur a quitté le profil Alerte, avec le jeton de l'alerte d'alors. */
	readonly #dismissed = new Map<string, string>();
	#request: FullscreenRequest | null = null;

	constructor(options: ProfileControllerOptions) {
		this.#options = options;
	}

	/** Vrai si l'appareil affiche le profil Alerte (bascule confirmée). */
	isInAlertProfile(deviceId: string): boolean {
		return this.#states.get(deviceId)?.phase === "shown";
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
		if (!request?.anyFullscreen) this.#dismissed.clear();
		for (const device of this.#options.devices()) {
			this.#syncDevice(device);
		}
	}

	/** Réaffiche le profil Alerte sur les appareils qui l'avaient quitté (touche Statut). */
	reshow(): void {
		this.#dismissed.clear();
		this.sync(this.#request);
	}

	/** À appeler quand des Alert keys apparaissent ou disparaissent sur un appareil. */
	keysChanged(deviceId: string): void {
		const state = this.#states.get(deviceId);
		if (!state) return;
		const visible = this.#options.isAlertProfileVisible(deviceId);

		if (state.phase === "pending") {
			if (!visible) return;
			this.#clearTimer(state);
			state.phase = "shown";
			this.#log(`${deviceId} : profil Alerte affiché`);
			if (state.returnWhenShown) {
				this.#return(deviceId);
			} else {
				this.#options.onChange?.();
			}
			return;
		}

		if (visible) {
			// Disparition passagère (changement de page dans le logiciel…) : rien à faire.
			this.#clearTimer(state);
			return;
		}
		if (state.timer) return;
		state.timer = setTimeout(() => {
			state.timer = null;
			if (this.#states.get(deviceId) !== state || this.#options.isAlertProfileVisible(deviceId)) return;
			this.#states.delete(deviceId);
			if (this.#request) this.#dismissed.set(deviceId, this.#request.token);
			this.#log(`${deviceId} : profil Alerte quitté manuellement, pas de retour automatique`);
			this.#options.onChange?.();
		}, this.#options.leaveDelayMs ?? 500);
	}

	/** Appareil déconnecté : on oublie son état (il sera rebasculé à la reconnexion si besoin). */
	deviceDisconnected(deviceId: string): void {
		const state = this.#states.get(deviceId);
		if (state) this.#clearTimer(state);
		this.#states.delete(deviceId);
		this.#dismissed.delete(deviceId);
	}

	/** Appareil (re)connecté : applique l'état voulu. */
	deviceConnected(device: DeviceInfo): void {
		this.#syncDevice(device);
	}

	/**
	 * Ramène l'appareil au profil précédent, sans alerte en cours, si le profil Alerte est affiché
	 * (appui sur une de ses touches après un redémarrage, par exemple).
	 */
	leave(deviceId: string): void {
		if (!this.#options.isAlertProfileVisible(deviceId)) return;
		const state = this.#states.get(deviceId);
		if (state) this.#clearTimer(state);
		this.#states.delete(deviceId);
		this.#switch(deviceId, undefined);
	}

	#syncDevice(device: DeviceInfo): void {
		const profile = this.#options.profiles.get(device.type);
		if (!profile || !device.isConnected) return;
		const request = this.#request;
		const state = this.#states.get(device.id);

		if (!state && request?.fullscreen && this.#dismissed.get(device.id) !== request.token) {
			this.#dismissed.delete(device.id);
			if (this.#options.isAlertProfileVisible(device.id)) {
				// Déjà sur le profil Alerte (plugin redémarré pendant une alerte…) : rebasculer
				// ferait du profil Alerte le « précédent ».
				this.#states.set(device.id, { phase: "shown", returnWhenShown: false, timer: null });
				this.#options.onChange?.();
				return;
			}
			this.#enter(device, profile);
		} else if (state && !request?.anyFullscreen) {
			if (state.phase === "shown") {
				this.#return(device.id);
			} else {
				// Bascule pas encore confirmée : on ne revient qu'une fois le profil Alerte vu.
				state.returnWhenShown = true;
			}
		} else if (state?.phase === "pending" && request?.anyFullscreen) {
			state.returnWhenShown = false;
		}
	}

	#enter(device: DeviceInfo, profile: string): void {
		const state: DeviceState = { phase: "pending", returnWhenShown: false, timer: null };
		state.timer = setTimeout(() => {
			state.timer = null;
			if (this.#states.get(device.id) !== state || state.phase !== "pending") return;
			// Profil jamais affiché (non installé, installation refusée, supprimé…) : surtout ne
			// pas « revenir », ce qui enverrait l'utilisateur sur un autre profil.
			this.#states.delete(device.id);
			if (this.#request) this.#dismissed.set(device.id, this.#request.token);
			this.#log(`${device.name} : le profil Alerte ne s'est pas affiché (non installé ?), alerte limitée aux Alert keys visibles`);
			this.#options.onChange?.();
		}, this.#options.confirmTimeoutMs ?? 5000);
		this.#states.set(device.id, state);
		this.#log(`${device.name} : bascule vers ${profile}`);
		this.#switch(device.id, profile);
	}

	#return(deviceId: string): void {
		const state = this.#states.get(deviceId);
		if (state) this.#clearTimer(state);
		this.#states.delete(deviceId);
		this.#log(`${deviceId} : retour au profil précédent`);
		this.#switch(deviceId, undefined);
		this.#options.onChange?.();
	}

	#switch(deviceId: string, profile: string | undefined): void {
		this.#options.switchToProfile(deviceId, profile).catch((error: unknown) => {
			this.#log(`${deviceId} : changement de profil impossible (${error instanceof Error ? error.message : String(error)})`);
		});
	}

	#clearTimer(state: DeviceState): void {
		if (state.timer) clearTimeout(state.timer);
		state.timer = null;
	}

	#log(message: string): void {
		this.#options.log?.(message);
	}
}
