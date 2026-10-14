import {
	action,
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { AlertManager } from "../alerts/alert-manager";
import type { AlertKeyHandle, KeyRegistry } from "../devices/key-registry";
import type { ProfileController } from "../devices/profile-controller";
import type { Animator } from "../render/animator";
import { idleLookFrom, type AlertKeySettings } from "../render/key-image";
import { keyRole } from "../render/layout";

/** Services partagés utilisés par l'action. */
export interface AlertKeyServices {
	readonly registry: KeyRegistry;
	readonly animator: Animator;
	readonly manager: AlertManager;
	readonly profiles: ProfileController;
}

/**
 * Touche d'affichage des alertes. Hors alerte, elle montre l'apparence réglée dans son
 * inspecteur ; pendant une alerte, elle est animée, et un appui acquitte l'alerte affichée
 * (ou parcourt la file, pour les touches ◀ ▶ ✖✖ du profil Alerte).
 */
@action({ UUID: "com.powange.ha-alert.alert-key" })
export class AlertKey extends SingletonAction<AlertKeySettings> {
	readonly #services: AlertKeyServices;

	constructor(services: AlertKeyServices) {
		super();
		this.#services = services;
	}

	override onWillAppear(ev: WillAppearEvent<AlertKeySettings>): void {
		if (!ev.action.isKey()) return;
		const keyAction = ev.action;
		const device = keyAction.device;
		const handle: AlertKeyHandle = {
			id: keyAction.id,
			deviceId: device.id,
			deviceName: device.name,
			grid: { columns: device.size.columns, rows: device.size.rows },
			// Dans une multi-action, la position n'est pas connue : la touche reste au repos.
			position: keyAction.isInMultiAction() ? null : (keyAction.coordinates ?? null),
			idle: idleLookFrom(ev.payload.settings),
			setImage: (image) => keyAction.setImage(image),
		};
		this.#services.registry.add(handle);
		this.#services.animator.draw(handle);
		this.#services.profiles.keysChanged(device.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<AlertKeySettings>): void {
		this.#services.registry.remove(ev.action.id);
		this.#services.animator.forget(ev.action.id);
		this.#services.profiles.keysChanged(ev.action.device.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<AlertKeySettings>): void {
		const handle = this.#services.registry.get(ev.action.id);
		if (!handle) return;
		handle.idle = idleLookFrom(ev.payload.settings);
		this.#services.animator.draw(handle);
	}

	override onKeyDown(ev: KeyDownEvent<AlertKeySettings>): void {
		const { registry, manager, profiles } = this.#services;
		const device = ev.action.device;
		const handle = registry.get(ev.action.id);

		if (!manager.current()) {
			// Hors alerte, une touche du profil Alerte (reconnu à ce qu'il ne contient que des
			// Alert keys) ramène au profil précédent : utile si on y est resté coincé.
			if (profiles.hasProfile(device.type)) profiles.leave(device.id);
			return;
		}

		const role = handle?.position
			? keyRole(handle.position, handle.grid, { inAlertProfile: profiles.isInAlertProfile(device.id), queueSize: manager.size })
			: "alert";
		const source = { deviceId: device.id, deviceName: device.name };
		switch (role) {
			case "prev":
				manager.navigate(-1);
				break;
			case "next":
				manager.navigate(1);
				break;
			case "clearAll":
				manager.acknowledgeAll(source);
				break;
			case "alert":
				manager.acknowledge(source);
				break;
		}
	}
}
