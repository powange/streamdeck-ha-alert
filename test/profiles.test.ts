import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileController, type DeviceInfo, type FullscreenRequest } from "../src/devices/profile-controller";
import { profilesFromManifest } from "../src/devices/profiles";
import { KeyRegistry, type AlertKeyHandle } from "../src/devices/key-registry";
import { hasBadge, keyRole } from "../src/render/layout";
import { DEFAULT_IDLE } from "../src/render/key-image";

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

describe("KeyRegistry.coversDevice", () => {
	const key = (id: string, column: number, row: number, deviceId = "XL"): AlertKeyHandle => ({
		id,
		deviceId,
		deviceName: "XL",
		grid: { columns: 2, rows: 2 },
		position: { column, row },
		idle: DEFAULT_IDLE,
		setImage: async () => undefined,
	});

	it("n'est vrai que si toutes les positions de la grille ont une Alert key", () => {
		const registry = new KeyRegistry();
		registry.add(key("a", 0, 0));
		registry.add(key("b", 1, 0));
		registry.add(key("c", 0, 1));
		expect(registry.coversDevice("XL")).toBe(false);
		registry.add(key("d", 1, 1));
		expect(registry.coversDevice("XL")).toBe(true);
		expect(registry.coversDevice("AUTRE")).toBe(false);
	});
});

describe("ProfileController", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	/** Simule le logiciel Stream Deck : la bascule affiche (ou non) le profil Alerte. */
	function setup(devices: DeviceInfo[], options: { switchWorks?: boolean } = {}) {
		const switches: [string, string | undefined][] = [];
		/** Appareils dont le profil Alerte est affiché (grille couverte d'Alert keys). */
		const shown = new Set<string>();
		const onChange = vi.fn();
		const controller = new ProfileController({
			profiles: new Map([
				[2, "profiles/HA Alert XL"],
				[0, "profiles/HA Alert"],
			]),
			devices: () => devices,
			switchToProfile: async (id, profile) => {
				switches.push([id, profile]);
			},
			isAlertProfileVisible: (id) => shown.has(id),
			onChange,
		});
		/** Le profil Alerte apparaît (ou disparaît) sur l'appareil. */
		const show = (id: string, visible = true) => {
			if (visible) shown.add(id);
			else shown.delete(id);
			controller.keysChanged(id);
		};
		return { controller, switches, show, onChange, switchWorks: options.switchWorks ?? true };
	}

	const xl: DeviceInfo = { id: "XL", name: "Stream Deck XL", type: 2, isConnected: true };
	const mk2: DeviceInfo = { id: "MK2", name: "Stream Deck", type: 0, isConnected: true };
	const pedal: DeviceInfo = { id: "PED", name: "Pedal", type: 5, isConnected: true };
	const full = (token: string): FullscreenRequest => ({ token, fullscreen: true, anyFullscreen: true });

	it("bascule tous les appareils ayant un profil, et ceux-là seulement", () => {
		const { controller, switches } = setup([xl, mk2, pedal]);
		controller.sync(full("a"));
		expect(switches).toEqual([
			["XL", "profiles/HA Alert XL"],
			["MK2", "profiles/HA Alert"],
		]);
	});

	it("ne considère l'appareil sur le profil Alerte qu'une fois celui-ci affiché", () => {
		const { controller, show, onChange } = setup([xl]);
		controller.sync(full("a"));
		expect(controller.isInAlertProfile("XL")).toBe(false);
		show("XL");
		expect(controller.isInAlertProfile("XL")).toBe(true);
		expect(onChange).toHaveBeenCalled();
	});

	it("ne rebascule jamais un appareil déjà en cours de bascule ou sur le profil Alerte", () => {
		const { controller, switches, show } = setup([xl]);
		controller.sync(full("a"));
		controller.sync(full("b"));
		show("XL");
		controller.sync(full("c"));
		expect(switches).toHaveLength(1);
	});

	it("revient au profil précédent (sans nom) quand plus aucune alerte plein écran ne reste", () => {
		const { controller, switches, show } = setup([xl, mk2]);
		controller.sync(full("a"));
		show("XL");
		show("MK2");
		controller.sync(null);
		expect(switches.slice(2)).toEqual([
			["XL", undefined],
			["MK2", undefined],
		]);
		expect(controller.isInAlertProfile("XL")).toBe(false);
	});

	it("ne revient jamais en arrière si la bascule n'a pas eu lieu (profil non installé)", async () => {
		const { controller, switches } = setup([xl]);
		controller.sync(full("a"));
		await vi.advanceTimersByTimeAsync(5000);
		// Pas de nouvelle tentative pour la même alerte (évite de redemander l'installation en boucle)…
		controller.sync(full("a"));
		expect(switches).toHaveLength(1);
		// … et surtout pas de retour arrière à la fin de l'alerte.
		controller.sync(null);
		expect(switches).toEqual([["XL", "profiles/HA Alert XL"]]);
	});

	it("revient dès la confirmation si l'alerte s'est terminée pendant une bascule lente", async () => {
		const { controller, switches, show } = setup([xl]);
		controller.sync(full("a"));
		controller.sync(null);
		expect(switches).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(3000);
		show("XL");
		expect(switches).toEqual([
			["XL", "profiles/HA Alert XL"],
			["XL", undefined],
		]);
	});

	it("reste sur le profil en parcourant une alerte keys tant qu'une alerte plein écran attend", () => {
		const { controller, switches, show } = setup([xl]);
		controller.sync(full("a"));
		show("XL");
		controller.sync({ token: "k", fullscreen: false, anyFullscreen: true });
		expect(switches).toHaveLength(1);
	});

	it("ne bascule pas pour une alerte en mode keys", () => {
		const { controller, switches } = setup([xl]);
		controller.sync({ token: "k", fullscreen: false, anyFullscreen: false });
		expect(switches).toEqual([]);
	});

	it("détecte une sortie manuelle, même vers une page qui contient des Alert keys", async () => {
		const { controller, switches, show } = setup([xl]);
		controller.sync(full("a"));
		show("XL");
		// La grille n'est plus entièrement couverte : l'utilisateur a changé de page.
		show("XL", false);
		await vi.advanceTimersByTimeAsync(500);
		expect(controller.isInAlertProfile("XL")).toBe(false);
		// Pas de retour automatique à la fin de l'alerte.
		controller.sync(null);
		expect(switches).toHaveLength(1);
	});

	it("ignore une disparition passagère du profil Alerte", async () => {
		const { controller, show } = setup([xl]);
		controller.sync(full("a"));
		show("XL");
		show("XL", false);
		await vi.advanceTimersByTimeAsync(200);
		show("XL");
		await vi.advanceTimersByTimeAsync(1000);
		expect(controller.isInAlertProfile("XL")).toBe(true);
	});

	it("après une sortie manuelle, rebascule pour une alerte renvoyée par HA, pas pour la même", async () => {
		const { controller, switches, show } = setup([xl]);
		controller.sync(full("sonnette@1"));
		show("XL");
		show("XL", false);
		await vi.advanceTimersByTimeAsync(500);
		controller.sync(full("sonnette@1"));
		expect(switches).toHaveLength(1);
		controller.sync(full("sonnette@2"));
		expect(switches).toHaveLength(2);
	});

	it("reshow() rebascule les appareils dont on avait quitté le profil", async () => {
		const { controller, switches, show } = setup([xl]);
		controller.sync(full("a"));
		show("XL");
		show("XL", false);
		await vi.advanceTimersByTimeAsync(500);
		controller.reshow();
		expect(switches).toHaveLength(2);
	});

	it("ne rebascule pas un appareil qui affiche déjà le profil Alerte (redémarrage)", () => {
		const { controller, switches, show } = setup([xl]);
		show("XL");
		controller.sync(full("a"));
		expect(switches).toEqual([]);
		expect(controller.isInAlertProfile("XL")).toBe(true);
		controller.sync(null);
		expect(switches).toEqual([["XL", undefined]]);
	});

	it("leave() ne ramène en arrière que si le profil Alerte est affiché", () => {
		const { controller, switches, show } = setup([xl]);
		controller.leave("XL");
		expect(switches).toEqual([]);
		show("XL");
		controller.leave("XL");
		expect(switches).toEqual([["XL", undefined]]);
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
