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
import type { Animator } from "../render/animator";
import { idleLookFrom, type AlertKeySettings } from "../render/key-image";

/**
 * Touche d'affichage des alertes. Hors alerte, elle montre l'apparence réglée dans son
 * inspecteur ; pendant une alerte, elle est animée, et un appui acquitte l'alerte affichée.
 */
@action({ UUID: "com.powange.ha-alert.alert-key" })
export class AlertKey extends SingletonAction<AlertKeySettings> {
	readonly #registry: KeyRegistry;
	readonly #animator: Animator;
	readonly #manager: AlertManager;

	constructor(registry: KeyRegistry, animator: Animator, manager: AlertManager) {
		super();
		this.#registry = registry;
		this.#animator = animator;
		this.#manager = manager;
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
		this.#registry.add(handle);
		this.#animator.draw(handle);
	}

	override onWillDisappear(ev: WillDisappearEvent<AlertKeySettings>): void {
		this.#registry.remove(ev.action.id);
		this.#animator.forget(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<AlertKeySettings>): void {
		const handle = this.#registry.get(ev.action.id);
		if (!handle) return;
		handle.idle = idleLookFrom(ev.payload.settings);
		this.#animator.draw(handle);
	}

	override onKeyDown(ev: KeyDownEvent<AlertKeySettings>): void {
		this.#manager.acknowledge({ deviceId: ev.action.device.id, deviceName: ev.action.device.name });
	}
}
