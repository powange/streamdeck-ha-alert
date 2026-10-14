import type { DisplayedAlert } from "../alerts/alert-manager";
import { ICONS, type Hex, type IconName } from "../alerts/schema";
import type { AlertKeyHandle } from "../devices/key-registry";
import { computeKeyFrame } from "./frames";
import { renderFrame, renderIdle, type IdleLook } from "./svg";

/**
 * Image d'une Alert key : la frame de l'alerte affichée si la touche est concernée,
 * sinon son apparence de repos.
 */
export function keyImage(key: AlertKeyHandle, displayed: DisplayedAlert | undefined, now: number): string {
	if (displayed && key.position) {
		const frame = computeKeyFrame(displayed.alert, key.position, key.grid, now - displayed.startedAt);
		if (frame) return renderFrame(frame, key.grid);
	}
	return renderIdle(key.idle);
}

/** Réglages d'une Alert key (inspecteur). */
export type AlertKeySettings = {
	idleColor?: string;
	idleText?: string;
	idleIcon?: string;
};

/** Apparence de repos par défaut : touche noire avec une cloche discrète. */
export const DEFAULT_IDLE: IdleLook = { color: "#000000", text: "", icon: "bell" };

/** Convertit les réglages de l'inspecteur en apparence de repos, en ignorant les valeurs invalides. */
export function idleLookFrom(settings: AlertKeySettings): IdleLook {
	const color = /^#[0-9a-f]{6}$/i.test(settings.idleColor ?? "") ? (settings.idleColor!.toLowerCase() as Hex) : DEFAULT_IDLE.color;
	const icon = (ICONS as readonly string[]).includes(settings.idleIcon ?? "") ? (settings.idleIcon as IconName) : DEFAULT_IDLE.icon;
	return { color, text: (settings.idleText ?? "").slice(0, 60), icon };
}
