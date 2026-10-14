import streamDeck from "@elgato/streamdeck";

import { AlertKey } from "./actions/alert-key";
import { StatusKey } from "./actions/status-key";
import { parseAlert, parseClear } from "./alerts/schema";
import { ALERT_EVENT, CLEAR_EVENT, onHaEvent, startConnection } from "./ha/connection";

// Niveau "info" : le niveau "trace" journaliserait aussi les paramètres globaux, donc le token HA.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new AlertKey());
streamDeck.actions.registerAction(new StatusKey());

// Étape 3 : les événements sont validés et journalisés ; l'affichage arrive aux étapes 4 et 5.
onHaEvent((eventType, data) => {
	if (eventType === ALERT_EVENT) {
		const result = parseAlert(data);
		if (result.ok) streamDeck.logger.info("alerte reçue", result.value);
		else streamDeck.logger.warn(`alerte invalide ignorée :\n${result.error}`);
	} else if (eventType === CLEAR_EVENT) {
		const result = parseClear(data);
		if (result.ok) streamDeck.logger.info("effacement reçu", result.value);
		else streamDeck.logger.warn(`effacement invalide ignoré :\n${result.error}`);
	}
});

streamDeck.logger.info("démarrage du plugin");
await streamDeck.connect();
await startConnection();
