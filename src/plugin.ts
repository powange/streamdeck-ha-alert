import streamDeck from "@elgato/streamdeck";

import { AlertKey } from "./actions/alert-key";
import { StatusKey } from "./actions/status-key";
import { AlertManager } from "./alerts/alert-manager";
import { parseAlert, parseClear } from "./alerts/schema";
import { KeyRegistry } from "./devices/key-registry";
import { ALERT_EVENT, CLEAR_EVENT, fireHaEvent, onHaEvent, startConnection } from "./ha/connection";
import { Animator } from "./render/animator";
import { keyImage } from "./render/key-image";

// Niveau "info" : le niveau "trace" journaliserait aussi les paramètres globaux, donc le token HA.
streamDeck.logger.setLevel("info");
const logger = streamDeck.logger.createScope("Alertes");

const registry = new KeyRegistry();

const manager: AlertManager = new AlertManager({
	fire: (eventType, data) => void fireHaEvent(eventType, data),
	onChange: () => {
		animator.setAnimating(manager.current() !== undefined);
		animator.refresh();
	},
	log: (message) => logger.info(message),
});

const animator = new Animator({
	keys: () => registry.all(),
	render: (key, now) => keyImage(key, manager.current(), now),
	onError: (error) => logger.error("rendu impossible", error),
});

streamDeck.actions.registerAction(new AlertKey(registry, animator, manager));
streamDeck.actions.registerAction(new StatusKey());

onHaEvent((eventType, data) => {
	if (eventType === ALERT_EVENT) {
		const result = parseAlert(data);
		if (result.ok) manager.handleAlert(result.value);
		else logger.warn(`alerte invalide ignorée :\n${result.error}`);
	} else if (eventType === CLEAR_EVENT) {
		const result = parseClear(data);
		if (result.ok) manager.handleClear(result.value);
		else logger.warn(`effacement invalide ignoré :\n${result.error}`);
	}
});

streamDeck.logger.info("démarrage du plugin");
await streamDeck.connect();
await startConnection();
