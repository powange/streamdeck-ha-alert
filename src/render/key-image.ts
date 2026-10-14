import type { DisplayedAlert } from "../alerts/alert-manager";
import { ICONS, type Hex, type IconName } from "../alerts/schema";
import type { AlertKeyHandle } from "../devices/key-registry";
import { computeKeyFrame } from "./frames";
import { hasBadge, keyRole } from "./layout";
import { renderControl, renderFrame, renderIdle, type IdleLook } from "./svg";

/** État global nécessaire pour dessiner une touche. */
export interface RenderContext {
	readonly displayed: DisplayedAlert | undefined;
	/** Position de l'alerte affichée dans la file. */
	readonly position: { readonly index: number; readonly total: number } | null;
	/** L'appareil affiche le profil Alerte. */
	isInAlertProfile(deviceId: string): boolean;
}

/**
 * Image d'une Alert key :
 * - touche de navigation (◀ ▶ ✖✖) dans le profil Alerte quand plusieurs alertes attendent ;
 * - frame de l'alerte affichée si la touche est concernée, avec le badge « 1/3 » le cas échéant ;
 * - sinon son apparence de repos.
 */
export function keyImage(key: AlertKeyHandle, context: RenderContext, now: number): string {
	const { displayed, position } = context;
	if (displayed && key.position) {
		const layout = { inAlertProfile: context.isInAlertProfile(key.deviceId), queueSize: position?.total ?? 1 };
		const role = keyRole(key.position, key.grid, layout);
		if (role !== "alert") return renderControl(role);

		const frame = computeKeyFrame(displayed.alert, key.position, key.grid, now - displayed.startedAt);
		if (frame) {
			const badge = position && hasBadge(key.position, key.grid, layout) ? `${position.index}/${position.total}` : undefined;
			return renderFrame(frame, key.grid, badge);
		}
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
