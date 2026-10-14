import streamDeck from "@elgato/streamdeck";

/** Paramètres globaux du plugin, partagés par toutes les actions. */
export type GlobalSettings = {
	/** URL de Home Assistant (WebSocket ou HTTP, normalisée à l'usage). */
	haUrl?: string;
	/** Token d'accès longue durée d'un compte administrateur. */
	haToken?: string;
};

type Listener = (settings: GlobalSettings) => void;

const listeners = new Set<Listener>();
let current: GlobalSettings | undefined;

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
	current = ev.settings ?? {};
	for (const listener of listeners) listener(current);
});

/** Lit les paramètres globaux (mis en cache après la première lecture). */
export async function getGlobalSettings(): Promise<GlobalSettings> {
	current ??= (await streamDeck.settings.getGlobalSettings<GlobalSettings>()) ?? {};
	return current;
}

/** Appelle `listener` à chaque modification des paramètres globaux (depuis l'inspecteur). */
export function onGlobalSettingsChanged(listener: Listener): void {
	listeners.add(listener);
}
