import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileController, type DeviceInfo, type FullscreenRequest } from "../src/devices/profile-controller";
import { profilesFromManifest } from "../src/devices/profiles";
import { hasBadge, keyRole } from "../src/render/layout";

const XL = { columns: 8, rows: 4 };
const MINI = { columns: 3, rows: 2 };

describe("profilesFromManifest", () => {
	it("associe chaque type d'appareil à son profil", () => {
		const profiles = profilesFromManifest({
			Profiles: [
				{ Name: "profiles/HA Alert XL", DeviceType: 2 },
				{ Name: "profiles/HA Alert", DeviceType: 0 },
				{ Name: "profiles/Doublon", DeviceType: 2 },
				{ Name: 42, DeviceType: 1 },
			],
		});
		expect([...profiles]).toEqual([
			[2, "profiles/HA Alert XL"],
			[0, "profiles/HA Alert"],
		]);
	});

	it("renvoie une liste vide sans profils", () => {
		expect(profilesFromManifest({}).size).toBe(0);
		expect(profilesFromManifest(null).size).toBe(0);
	});
});

describe("keyRole et hasBadge", () => {
	const inProfile = { inAlertProfile: true, queueSize: 3 };

	it("place ◀ ▶ ✖✖ sur la dernière rangée", () => {
		expect(keyRole({ column: 0, row: 3 }, XL, inProfile)).toBe("prev");
		expect(keyRole({ column: 1, row: 3 }, XL, inProfile)).toBe("next");
		expect(keyRole({ column: 7, row: 3 }, XL, inProfile)).toBe("clearAll");
		expect(keyRole({ column: 4, row: 3 }, XL, inProfile)).toBe("alert");
		expect(keyRole({ column: 0, row: 2 }, XL, inProfile)).toBe("alert");
	});

	it("pas de navigation hors profil Alerte, avec une seule alerte, ou sur un petit appareil", () => {
		expect(keyRole({ column: 0, row: 3 }, XL, { inAlertProfile: false, queueSize: 3 })).toBe("alert");
		expect(keyRole({ column: 0, row: 3 }, XL, { inAlertProfile: true, queueSize: 1 })).toBe("alert");
		expect(keyRole({ column: 0, row: 1 }, MINI, inProfile)).toBe("alert");
	});

	it("met le badge en haut à droite, Mini compris", () => {
		expect(hasBadge({ column: 7, row: 0 }, XL, inProfile)).toBe(true);
		expect(hasBadge({ column: 2, row: 0 }, MINI, inProfile)).toBe(true);
		expect(hasBadge({ column: 6, row: 0 }, XL, inProfile)).toBe(false);
		expect(hasBadge({ column: 7, row: 0 }, XL, { inAlertProfile: true, queueSize: 1 })).toBe(false);
	});
});

describe("ProfileController", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function setup(devices: DeviceInfo[]) {
		const switches: [string, string | undefined][] = [];
		const visible = new Map<string, number>();
		const controller = new ProfileController({
			profiles: new Map([
				[2, "profiles/HA Alert XL"],
				[0, "profiles/HA Alert"],
			]),
			devices: () => devices,
			switchToProfile: async (id, profile) => {
				switches.push([id, profile]);
			},
			visibleKeys: (id) => visible.get(id) ?? 0,
		});
		return { controller, switches, visible };
	}

	const xl: DeviceInfo = { id: "XL", name: "Stream Deck XL", type: 2, isConnected: true };
	const mk2: DeviceInfo = { id: "MK2", name: "Stream Deck", type: 0, isConnected: true };
	const pedal: DeviceInfo = { id: "PED", name: "Pedal", type: 5, isConnected: true };
	const full = (alertId: string): FullscreenRequest => ({ alertId, fullscreen: true, anyFullscreen: true });

	it("bascule tous les appareils ayant un profil, et ceux-là seulement", () => {
		const { controller, switches } = setup([xl, mk2, pedal]);
		controller.sync(full("a"));
		expect(switches).toEqual([
			["XL", "profiles/HA Alert XL"],
			["MK2", "profiles/HA Alert"],
		]);
		expect(controller.isInAlertProfile("XL")).toBe(true);
		expect(controller.isInAlertProfile("PED")).toBe(false);
	});

	it("ne rebascule jamais un appareil déjà sur le profil Alerte", () => {
		const { controller, switches } = setup([xl]);
		controller.sync(full("a"));
		controller.sync(full("b"));
		expect(switches).toHaveLength(1);
	});

	it("revient au profil précédent (sans nom) quand plus aucune alerte plein écran ne reste", () => {
		const { controller, switches } = setup([xl, mk2]);
		controller.sync(full("a"));
		controller.sync(null);
		expect(switches.slice(2)).toEqual([
			["XL", undefined],
			["MK2", undefined],
		]);
		expect(controller.isInAlertProfile("XL")).toBe(false);
	});

	it("reste sur le profil en parcourant une alerte keys tant qu'une alerte plein écran attend", () => {
		const { controller, switches } = setup([xl]);
		controller.sync(full("a"));
		controller.sync({ alertId: "k", fullscreen: false, anyFullscreen: true });
		expect(switches).toHaveLength(1);
	});

	it("ne bascule pas pour une alerte en mode keys", () => {
		const { controller, switches } = setup([xl]);
		controller.sync({ alertId: "k", fullscreen: false, anyFullscreen: false });
		expect(switches).toEqual([]);
	});

	it("détecte une sortie manuelle du profil et ne force pas le retour", async () => {
		const { controller, switches, visible } = setup([xl]);
		controller.sync(full("a"));
		visible.set("XL", 32);
		controller.keysChanged("XL");
		// L'utilisateur change de profil : toutes les Alert keys disparaissent.
		visible.set("XL", 0);
		controller.keysChanged("XL");
		await vi.advanceTimersByTimeAsync(1000);
		expect(controller.isInAlertProfile("XL")).toBe(false);
		// Pas de retour automatique à la fin de l'alerte…
		controller.sync(null);
		expect(switches).toHaveLength(1);
	});

	it("ne rebascule pas pour la même alerte après une sortie manuelle, mais pour une nouvelle", async () => {
		const { controller, switches } = setup([xl]);
		controller.sync(full("a"));
		controller.keysChanged("XL");
		await vi.advanceTimersByTimeAsync(1000);
		controller.sync(full("a"));
		expect(switches).toHaveLength(1);
		controller.sync(full("b"));
		expect(switches).toHaveLength(2);
	});

	it("tolère la disparition momentanée des touches pendant la bascule", async () => {
		const { controller, visible } = setup([xl]);
		controller.sync(full("a"));
		controller.keysChanged("XL");
		await vi.advanceTimersByTimeAsync(300);
		visible.set("XL", 32);
		controller.keysChanged("XL");
		await vi.advanceTimersByTimeAsync(1000);
		expect(controller.isInAlertProfile("XL")).toBe(true);
	});

	it("rebascule un appareil reconnecté pendant une alerte", () => {
		const { controller, switches } = setup([xl]);
		controller.sync(full("a"));
		controller.deviceDisconnected("XL");
		controller.deviceConnected(xl);
		expect(switches).toEqual([
			["XL", "profiles/HA Alert XL"],
			["XL", "profiles/HA Alert XL"],
		]);
	});

	it("ignore les appareils déconnectés", () => {
		const { controller, switches } = setup([{ ...xl, isConnected: false }]);
		controller.sync(full("a"));
		expect(switches).toEqual([]);
	});
});
