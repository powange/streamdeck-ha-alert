import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AlertManager } from "../src/alerts/alert-manager";
import { alertSchema, type Alert } from "../src/alerts/schema";

function alert(fields: Partial<Alert> & { id: string }): Alert {
	return alertSchema.parse(fields);
}

const DEVICE = { deviceId: "DEV1", deviceName: "Stream Deck XL" };

function setup() {
	const fired: [string, Record<string, unknown>][] = [];
	const onChange = vi.fn();
	const manager = new AlertManager({
		fire: (type, data) => fired.push([type, data]),
		onChange,
		now: () => Date.now(),
	});
	return { manager, fired, onChange };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("AlertManager", () => {
	it("affiche l'alerte la plus prioritaire et prévient les observateurs", () => {
		const { manager, onChange } = setup();
		manager.handleAlert(alert({ id: "a", priority: 1 }));
		manager.handleAlert(alert({ id: "b", priority: 5 }));
		expect(manager.current()?.alert.id).toBe("b");
		expect(manager.position()).toEqual({ index: 1, total: 2 });
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it("redémarre l'animation quand l'alerte affichée change ou est mise à jour", () => {
		const { manager } = setup();
		manager.handleAlert(alert({ id: "a" }));
		expect(manager.current()?.startedAt).toBe(0);
		vi.setSystemTime(1000);
		manager.handleAlert(alert({ id: "b", priority: -1 }));
		expect(manager.current()?.startedAt).toBe(0); // « a » reste affichée
		vi.setSystemTime(2000);
		manager.handleAlert(alert({ id: "a", text: "maj" }));
		expect(manager.current()?.startedAt).toBe(2000);
	});

	it("expire l'alerte à la fin de duration_s et envoie streamdeck_alert_expired", async () => {
		const { manager, fired } = setup();
		manager.handleAlert(alert({ id: "a", duration_s: 30 }));
		await vi.advanceTimersByTimeAsync(29_999);
		expect(manager.current()?.alert.id).toBe("a");
		await vi.advanceTimersByTimeAsync(1);
		expect(manager.current()).toBeUndefined();
		expect(fired).toEqual([["streamdeck_alert_expired", { id: "a" }]]);
	});

	it("garde une alerte sans durée jusqu'à l'acquittement", async () => {
		const { manager } = setup();
		manager.handleAlert(alert({ id: "a", duration_s: 0 }));
		await vi.advanceTimersByTimeAsync(24 * 3600 * 1000);
		expect(manager.current()?.alert.id).toBe("a");
	});

	it("affiche l'alerte suivante après une expiration", async () => {
		const { manager } = setup();
		manager.handleAlert(alert({ id: "longue", priority: 1, duration_s: 60 }));
		manager.handleAlert(alert({ id: "courte", priority: 9, duration_s: 5 }));
		await vi.advanceTimersByTimeAsync(5_000);
		expect(manager.current()?.alert.id).toBe("longue");
		expect(manager.current()?.startedAt).toBe(5_000);
	});

	describe("acquittement", () => {
		it("envoie streamdeck_alert_ack avec l'appareil si ack_required", () => {
			const { manager, fired } = setup();
			manager.handleAlert(alert({ id: "sonnette", ack_required: true }));
			expect(manager.acknowledge(DEVICE)).toBe(true);
			expect(fired).toEqual([["streamdeck_alert_ack", { id: "sonnette", device: "Stream Deck XL", device_id: "DEV1" }]]);
			expect(manager.current()).toBeUndefined();
		});

		it("ferme l'alerte sans rien envoyer si ack_required est faux", () => {
			const { manager, fired } = setup();
			manager.handleAlert(alert({ id: "linge" }));
			expect(manager.acknowledge(DEVICE)).toBe(true);
			expect(fired).toEqual([]);
		});

		it("n'acquitte que l'alerte affichée et passe à la suivante", () => {
			const { manager } = setup();
			manager.handleAlert(alert({ id: "a", priority: 1 }));
			manager.handleAlert(alert({ id: "b", priority: 2 }));
			manager.acknowledge(DEVICE);
			expect(manager.current()?.alert.id).toBe("a");
		});

		it("ne fait rien sans alerte", () => {
			const { manager, onChange } = setup();
			expect(manager.acknowledge(DEVICE)).toBe(false);
			expect(onChange).not.toHaveBeenCalled();
		});

		it("acquitte tout, en envoyant l'ack des seules alertes qui le demandent", () => {
			const { manager, fired } = setup();
			manager.handleAlert(alert({ id: "a", ack_required: true }));
			manager.handleAlert(alert({ id: "b" }));
			manager.acknowledgeAll(DEVICE);
			expect(manager.size).toBe(0);
			expect(fired.map(([type, data]) => [type, data.id])).toEqual([["streamdeck_alert_ack", "a"]]);
		});

		it("annule l'expiration d'une alerte acquittée", async () => {
			const { manager, fired } = setup();
			manager.handleAlert(alert({ id: "a", duration_s: 10 }));
			manager.acknowledge(DEVICE);
			await vi.advanceTimersByTimeAsync(20_000);
			expect(fired).toEqual([]);
		});
	});

	describe("clear", () => {
		it("efface une alerte par id, sans événement", () => {
			const { manager, fired } = setup();
			manager.handleAlert(alert({ id: "a" }));
			manager.handleAlert(alert({ id: "b" }));
			manager.handleClear({ id: "b" });
			expect(manager.current()?.alert.id).toBe("a");
			expect(fired).toEqual([]);
		});

		it("efface tout sans id", () => {
			const { manager } = setup();
			manager.handleAlert(alert({ id: "a" }));
			manager.handleAlert(alert({ id: "b" }));
			manager.handleClear({});
			expect(manager.current()).toBeUndefined();
		});

		it("ignore un id inconnu", () => {
			const { manager } = setup();
			manager.handleAlert(alert({ id: "a" }));
			manager.handleClear({ id: "zzz" });
			expect(manager.current()?.alert.id).toBe("a");
		});
	});

	it("parcourt la file avec navigate()", () => {
		const { manager } = setup();
		manager.handleAlert(alert({ id: "a", priority: 1 }));
		manager.handleAlert(alert({ id: "b", priority: 2 }));
		manager.navigate(1);
		expect(manager.current()?.alert.id).toBe("a");
		expect(manager.position()).toEqual({ index: 2, total: 2 });
	});
});
