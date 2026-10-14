import { describe, expect, it } from "vitest";

import { AlertQueue } from "../src/alerts/alert-queue";
import { alertSchema, type Alert } from "../src/alerts/schema";

function alert(fields: Partial<Alert> & { id: string }): Alert {
	return alertSchema.parse(fields);
}

const ids = (queue: AlertQueue): string[] => queue.list().map((q) => q.alert.id);

describe("AlertQueue", () => {
	it("trie par priorité décroissante, puis la plus récente d'abord", () => {
		const queue = new AlertQueue();
		queue.upsert(alert({ id: "a", priority: 1 }), 0);
		queue.upsert(alert({ id: "b", priority: 5 }), 1);
		queue.upsert(alert({ id: "c", priority: 1 }), 2);
		expect(ids(queue)).toEqual(["b", "c", "a"]);
		expect(queue.current()?.alert.id).toBe("b");
	});

	it("remplace une alerte de même id", () => {
		const queue = new AlertQueue();
		queue.upsert(alert({ id: "a", text: "v1" }), 0);
		queue.upsert(alert({ id: "a", text: "v2" }), 1);
		expect(queue.size).toBe(1);
		expect(queue.current()?.alert.text).toBe("v2");
	});

	it("calcule l'expiration à partir de duration_s, sans expiration si 0", () => {
		const queue = new AlertQueue();
		expect(queue.upsert(alert({ id: "a", duration_s: 30 }), 1000).expiresAt).toBe(31_000);
		expect(queue.upsert(alert({ id: "b", duration_s: 0 }), 1000).expiresAt).toBeNull();
		expect(queue.nextExpiry()).toBe(31_000);
	});

	it("retire les alertes expirées et passe à la suivante", () => {
		const queue = new AlertQueue();
		queue.upsert(alert({ id: "court", priority: 9, duration_s: 5 }), 0);
		queue.upsert(alert({ id: "long", priority: 1, duration_s: 0 }), 0);
		expect(queue.expire(4_999)).toEqual([]);
		expect(queue.expire(5_000).map((q) => q.alert.id)).toEqual(["court"]);
		expect(queue.current()?.alert.id).toBe("long");
		expect(queue.nextExpiry()).toBeNull();
	});

	it("retire une alerte par id et vide la file", () => {
		const queue = new AlertQueue();
		queue.upsert(alert({ id: "a" }), 0);
		queue.upsert(alert({ id: "b" }), 0);
		expect(queue.remove("a")?.alert.id).toBe("a");
		expect(queue.remove("inconnue")).toBeUndefined();
		expect(queue.clear().map((q) => q.alert.id)).toEqual(["b"]);
		expect(queue.size).toBe(0);
		expect(queue.current()).toBeUndefined();
		expect(queue.position()).toBeNull();
	});

	describe("navigation ◀ ▶", () => {
		function threeAlerts(): AlertQueue {
			const queue = new AlertQueue();
			queue.upsert(alert({ id: "bas", priority: 1 }), 0);
			queue.upsert(alert({ id: "moyen", priority: 2 }), 0);
			queue.upsert(alert({ id: "haut", priority: 3 }), 0);
			return queue;
		}

		it("parcourt la file en boucle et met à jour la position", () => {
			const queue = threeAlerts();
			expect(queue.position()).toEqual({ index: 1, total: 3 });
			expect(queue.navigate(1)?.alert.id).toBe("moyen");
			expect(queue.position()).toEqual({ index: 2, total: 3 });
			expect(queue.navigate(1)?.alert.id).toBe("bas");
			expect(queue.navigate(1)?.alert.id).toBe("haut");
			expect(queue.navigate(-1)?.alert.id).toBe("bas");
		});

		it("garde l'alerte consultée si une alerte moins prioritaire arrive", () => {
			const queue = threeAlerts();
			queue.navigate(1);
			queue.upsert(alert({ id: "faible", priority: 0 }), 1);
			expect(queue.current()?.alert.id).toBe("moyen");
		});

		it("revient à la plus prioritaire si une nouvelle alerte passe en tête", () => {
			const queue = threeAlerts();
			queue.navigate(1);
			queue.upsert(alert({ id: "urgent", priority: 10 }), 1);
			expect(queue.current()?.alert.id).toBe("urgent");
		});

		it("revient à la plus prioritaire quand l'alerte consultée est acquittée", () => {
			const queue = threeAlerts();
			queue.navigate(2);
			queue.remove("bas");
			expect(queue.current()?.alert.id).toBe("haut");
		});

		it("ne fait rien sur une file vide", () => {
			expect(new AlertQueue().navigate(1)).toBeUndefined();
		});
	});
});
