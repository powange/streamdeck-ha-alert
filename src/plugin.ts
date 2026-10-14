import streamDeck from "@elgato/streamdeck";

import { AlertKey } from "./actions/alert-key";
import { StatusKey } from "./actions/status-key";

// Niveau "info" : le niveau "trace" journaliserait aussi les paramètres globaux, donc le token HA.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new AlertKey());
streamDeck.actions.registerAction(new StatusKey());

streamDeck.connect();
