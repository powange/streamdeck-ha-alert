import streamDeck from "@elgato/streamdeck";

import { getGlobalSettings, onGlobalSettingsChanged, type GlobalSettings } from "../settings";
import { HaClient, normalizeHaUrl, type ConnectionState } from "./ha-client";

/** Événements Home Assistant écoutés par le plugin. */
export const ALERT_EVENT = "streamdeck_alert";
export const CLEAR_EVENT = "streamdeck_alert_clear";
/** Événements envoyés à Home Assistant. */
export const ACK_EVENT = "streamdeck_alert_ack";
export const EXPIRED_EVENT = "streamdeck_alert_expired";

type EventListener = (eventType: string, data: unknown) => void;
type StateListener = (state: ConnectionState, detail: string | undefined) => void;

const logger = streamDeck.logger.createScope("HA");
const eventListeners = new Set<EventListener>();
const stateListeners = new Set<StateListener>();

let client: HaClient | null = null;
/** Paramètres de la connexion en cours, pour ne relancer que s'ils changent (`null` avant le premier passage). */
let activeKey: string | null = null;
let state: ConnectionState = "unconfigured";
let stateDetail: string | undefined;

/** État courant de la connexion. */
export function connectionState(): { state: ConnectionState; detail: string | undefined } {
	return { state, detail: stateDetail };
}

/** Écoute les événements reçus de Home Assistant. */
export function onHaEvent(listener: EventListener): void {
	eventListeners.add(listener);
}

/** Écoute les changements d'état de la connexion. */
export function onConnectionState(listener: StateListener): void {
	stateListeners.add(listener);
}

/** Envoie un événement à Home Assistant ; les erreurs sont journalisées, jamais levées. */
export async function fireHaEvent(eventType: string, data: Record<string, unknown>): Promise<boolean> {
	if (!client) {
		logger.warn(`${eventType} non envoyé : Home Assistant n'est pas configuré`);
		return false;
	}
	try {
		await client.fireEvent(eventType, data);
		logger.info(`${eventType} envoyé`, data);
		return true;
	} catch (error) {
		logger.error(`${eventType} non envoyé : ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}

function setState(next: ConnectionState, detail?: string): void {
	state = next;
	stateDetail = detail;
	const log = next === "auth_failed" || next === "forbidden" ? logger.error : logger.info;
	log.call(logger, `état : ${next}${detail ? ` (${detail})` : ""}`);
	for (const listener of stateListeners) listener(next, detail);
}

/** (Re)crée la connexion selon les paramètres globaux ; ne fait rien s'ils n'ont pas changé. */
function apply(settings: GlobalSettings): void {
	const url = normalizeHaUrl(settings.haUrl ?? "");
	const token = settings.haToken?.trim() ?? "";
	const key = url && token ? `${url}\n${token}` : "";
	if (key === activeKey) return;
	activeKey = key;

	client?.stop();
	client = null;
	if (!url || !token) {
		setState("unconfigured", !url && settings.haUrl ? "URL invalide" : undefined);
		return;
	}

	logger.info(`connexion à ${url}`);
	client = new HaClient({
		url,
		token,
		eventTypes: [ALERT_EVENT, CLEAR_EVENT],
		onEvent: (eventType, data) => {
			for (const listener of eventListeners) listener(eventType, data);
		},
		onStateChange: setState,
	});
	client.start();
}

/** Démarre la connexion et suit les modifications des paramètres globaux. */
export async function startConnection(): Promise<void> {
	onGlobalSettingsChanged(apply);
	apply(await getGlobalSettings());
}
