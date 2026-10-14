import streamDeck from "@elgato/streamdeck";

import { AlertKey } from "./actions/alert-key";
import { StatusKey } from "./actions/status-key";
import { AlertManager } from "./alerts/alert-manager";
import { parseAlert, parseClear } from "./alerts/schema";
import { KeyRegistry } from "./devices/key-registry";
import { ProfileController, type DeviceInfo } from "./devices/profile-controller";
import { loadProfiles } from "./devices/profiles";
import { ALERT_EVENT, CLEAR_EVENT, fireHaEvent, onConnectionState, onHaEvent, READY_EVENT, startConnection } from "./ha/connection";
import { Animator } from "./render/animator";
import { keyImage } from "./render/key-image";

// Niveau "info" : le niveau "trace" journaliserait aussi les paramètres globaux, donc le token HA.
streamDeck.logger.setLevel("info");
const logger = streamDeck.logger.createScope("Alertes");

const deviceInfo = (device: DeviceInfo): DeviceInfo => ({
	id: device.id,
	name: device.name,
	type: device.type,
	isConnected: device.isConnected,
});

const registry = new KeyRegistry();

const profiles = new ProfileController({
	profiles: loadProfiles(),
	devices: () => [...streamDeck.devices].map(deviceInfo),
	switchToProfile: (deviceId, profile) => streamDeck.profiles.switchToProfile(deviceId, profile),
	isAlertProfileVisible: (deviceId) => registry.coversDevice(deviceId),
	onChange: () => animator.refresh(),
	log: (message) => logger.info(message),
});

const manager: AlertManager = new AlertManager({
	fire: (eventType, data) => void fireHaEvent(eventType, data),
	onChange: () => {
		const current = manager.current();
		profiles.sync(
			current
				? {
						token: `${current.alert.id}@${current.receivedAt}`,
						fullscreen: current.alert.mode === "fullscreen",
						anyFullscreen: manager.anyFullscreen(),
					}
				: null,
		);
		animator.setAnimating(current !== undefined);
		animator.refresh();
		statusKey.refresh();
	},
	log: (message) => logger.info(message),
});

const animator = new Animator({
	keys: () => registry.all(),
	render: (key, now) =>
		keyImage(key, { displayed: manager.current(), position: manager.position(), isInAlertProfile: (id) => profiles.isInAlertProfile(id) }, now),
	onError: (error) => logger.error("rendu impossible", error),
});

const statusKey = new StatusKey({ manager, profiles });
streamDeck.actions.registerAction(new AlertKey({ registry, animator, manager, profiles }));
streamDeck.actions.registerAction(statusKey);

streamDeck.devices.onDeviceDidConnect((ev) => profiles.deviceConnected(deviceInfo(ev.device)));
streamDeck.devices.onDeviceDidDisconnect((ev) => profiles.deviceDisconnected(ev.device.id));

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

// À chaque (re)connexion, HA reçoit la liste des alertes encore affichées : un effacement envoyé
// pendant une coupure a pu être perdu, une automatisation peut alors faire le ménage.
onConnectionState((state) => {
	if (state === "connected") void fireHaEvent(READY_EVENT, { active: manager.activeIds() });
});

streamDeck.logger.info("démarrage du plugin");
await streamDeck.connect();
for (const device of streamDeck.devices) {
	logger.info(
		`appareil « ${device.name} » (type ${device.type}, ${device.size.columns}×${device.size.rows}) : ` +
			(profiles.hasProfile(device.type) ? "profil Alerte disponible" : "pas de profil Alerte, plein écran limité aux Alert keys visibles"),
	);
}
await startConnection();
