import { action, SingletonAction } from "@elgato/streamdeck";

/**
 * Touche « Statut HA » : état de la connexion et alertes en attente.
 * Squelette de l'étape 1 : l'affichage réel arrive à l'étape 6.
 */
@action({ UUID: "com.powange.ha-alert.status" })
export class StatusKey extends SingletonAction {}
