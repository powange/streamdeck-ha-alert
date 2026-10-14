import streamDeck, { action, SingletonAction, type SendToPluginEvent, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { connectionState, onConnectionState } from "../ha/connection";
import { normalizeHaUrl, testConnection, type ConnectionState } from "../ha/ha-client";

/** Libellé et couleur de l'indicateur pour chaque état de connexion. */
const STATE_LOOK: Record<ConnectionState, { label: string; color: string }> = {
	unconfigured: { label: "À configurer", color: "#9e9e9e" },
	connecting: { label: "Connexion…", color: "#ffb300" },
	connected: { label: "Connecté", color: "#43a047" },
	auth_failed: { label: "Token refusé", color: "#e53935" },
	forbidden: { label: "Pas admin", color: "#e53935" },
	disconnected: { label: "Hors ligne", color: "#fb8c00" },
};

/** Image de la touche : maison, pastille colorée et libellé de l'état. */
function statusImage(state: ConnectionState): string {
	const { label, color } = STATE_LOOK[state];
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" fill="#1c1c1c"/>
<g transform="translate(36 8) scale(2.6)" fill="none" stroke="#18bcf2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13 14 4.5 24 13"/><path d="M7 11v12h14V11"/></g>
<circle cx="72" cy="52" r="9" fill="${color}"/>
<text x="72" y="118" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="bold" text-anchor="middle">${label}</text>
</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Message de l'inspecteur : test de la connexion avec les valeurs saisies. */
type TestRequest = { event: "testConnection"; url?: string; token?: string };

/**
 * Touche « Statut HA » : état de la connexion.
 * L'affichage des alertes en attente et l'appui long arrivent à l'étape 6.
 */
@action({ UUID: "com.powange.ha-alert.status" })
export class StatusKey extends SingletonAction {
	constructor() {
		super();
		onConnectionState((state) => {
			for (const instance of this.actions) {
				if (instance.isKey()) void instance.setImage(statusImage(state));
			}
		});
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (ev.action.isKey()) await ev.action.setImage(statusImage(connectionState().state));
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
		const payload = ev.payload as TestRequest | null;
		if (payload?.event !== "testConnection") return;

		const url = normalizeHaUrl(payload.url ?? "");
		const token = payload.token?.trim() ?? "";
		const result = !url
			? { ok: false, message: "URL invalide." }
			: !token
				? { ok: false, message: "Token manquant." }
				: await testConnection(url, token);
		streamDeck.logger.info(`test de connexion : ${result.message}`);
		await streamDeck.ui.sendToPropertyInspector({ event: "testResult", ...result, url });
	}
}
