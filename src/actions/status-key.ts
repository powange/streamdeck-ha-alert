import streamDeck, {
	action,
	SingletonAction,
	type KeyDownEvent,
	type KeyUpEvent,
	type SendToPluginEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import type { AlertManager } from "../alerts/alert-manager";
import { alertSchema } from "../alerts/schema";
import type { ProfileController } from "../devices/profile-controller";
import { connectionState, onConnectionState } from "../ha/connection";
import { normalizeHaUrl, testConnection, type ConnectionState } from "../ha/ha-client";
import { escapeXml, toDataUrl } from "../render/svg";

/** Durée d'appui à partir de laquelle on lance l'alerte de test (ms). */
const LONG_PRESS_MS = 600;

/** Alerte de test (appui long) : locale, elle fonctionne même sans Home Assistant. */
const TEST_ALERT = alertSchema.parse({ id: "test", text: "Test\nHA Alert", pattern: "rainbow", interval_ms: 200, duration_s: 10 });

/** Libellé et couleur de l'indicateur pour chaque état de connexion. */
const STATE_LOOK: Record<ConnectionState, { label: string; color: string }> = {
	unconfigured: { label: "À configurer", color: "#9e9e9e" },
	connecting: { label: "Connexion…", color: "#ffb300" },
	connected: { label: "Connecté", color: "#43a047" },
	auth_failed: { label: "Token refusé", color: "#e53935" },
	forbidden: { label: "Pas admin", color: "#e53935" },
	disconnected: { label: "Hors ligne", color: "#fb8c00" },
};

/** Image de la touche : maison et pastille d'état, libellé de connexion, alertes en cours. */
export function statusImage(state: ConnectionState, alerts: number): string {
	const { label, color } = STATE_LOOK[state];
	const font = 'font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle"';
	const pending =
		alerts > 0
			? `<rect x="10" y="102" width="124" height="34" rx="10" fill="#e65100"/>` +
				`<text x="72" y="126" ${font} font-size="20" fill="#ffffff">${alerts} alerte${alerts > 1 ? "s" : ""}</text>`
			: `<text x="72" y="126" ${font} font-size="17" fill="#757575">Aucune alerte</text>`;
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="#1c1c1c"/>` +
		`<g transform="translate(44 4) scale(2)" fill="none" stroke="#18bcf2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13 14 4.5 24 13"/><path d="M7 11v12h14V11"/></g>` +
		`<circle cx="72" cy="36" r="7" fill="${color}"/>` +
		`<text x="72" y="84" ${font} font-size="20" fill="#ffffff">${escapeXml(label)}</text>` +
		pending +
		`</svg>`;
	return toDataUrl(svg);
}

/** Message de l'inspecteur : test de la connexion avec les valeurs saisies. */
type TestRequest = { event: "testConnection"; url?: string; token?: string };

/** Services partagés utilisés par l'action. */
export interface StatusKeyServices {
	readonly manager: AlertManager;
	readonly profiles: ProfileController;
}

/**
 * Touche « Statut HA » : état de la connexion et nombre d'alertes en cours.
 * Appui court : réaffiche le profil Alerte s'il a été quitté. Appui long : alerte de test.
 */
@action({ UUID: "com.powange.ha-alert.status" })
export class StatusKey extends SingletonAction {
	readonly #services: StatusKeyServices;
	/** Appuis en cours, par instance : minuterie de l'appui long. */
	readonly #presses = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(services: StatusKeyServices) {
		super();
		this.#services = services;
		onConnectionState(() => this.refresh());
	}

	/** Redessine toutes les touches Statut (connexion ou alertes modifiées). */
	refresh(): void {
		const image = statusImage(connectionState().state, this.#services.manager.size);
		for (const instance of this.actions) {
			if (instance.isKey()) void instance.setImage(image);
		}
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (ev.action.isKey()) await ev.action.setImage(statusImage(connectionState().state, this.#services.manager.size));
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.#cancelPress(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent): void {
		this.#cancelPress(ev.action.id);
		this.#presses.set(
			ev.action.id,
			setTimeout(() => {
				this.#presses.delete(ev.action.id);
				streamDeck.logger.info("alerte de test (appui long sur Statut HA)");
				this.#services.manager.handleAlert(TEST_ALERT);
			}, LONG_PRESS_MS),
		);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		// Minuterie encore active : relâché avant l'appui long, c'est un appui court.
		if (!this.#cancelPress(ev.action.id)) return;
		if (this.#services.manager.size > 0) {
			this.#services.profiles.reshow();
		} else if (ev.action.isKey()) {
			await ev.action.showOk();
		}
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

	/** Annule la minuterie d'appui long ; renvoie `true` si elle était encore active. */
	#cancelPress(id: string): boolean {
		const timer = this.#presses.get(id);
		if (!timer) return false;
		clearTimeout(timer);
		this.#presses.delete(id);
		return true;
	}
}
