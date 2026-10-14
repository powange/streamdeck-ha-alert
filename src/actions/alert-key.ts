import { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";

/**
 * Touche d'affichage des alertes.
 * Squelette de l'étape 1 : le rendu et l'acquittement arrivent aux étapes 4 et 5.
 */
@action({ UUID: "com.powange.ha-alert.alert-key" })
export class AlertKey extends SingletonAction {
	override onKeyDown(_ev: KeyDownEvent): void {
		// Acquittement : implémenté à l'étape 5.
	}
}
