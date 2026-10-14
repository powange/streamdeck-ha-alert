import { describe, expect, it } from "vitest";

import { Outbox } from "../src/ha/outbox";

describe("Outbox", () => {
	it("renvoie les événements en attente dans l'ordre, puis se vide", () => {
		const outbox = new Outbox();
		outbox.push("streamdeck_alert_ack", { id: "a" }, 0);
		outbox.push("streamdeck_alert_expired", { id: "b" }, 10);
		expect(outbox.drain(20).map((e) => [e.eventType, e.data.id])).toEqual([
			["streamdeck_alert_ack", "a"],
			["streamdeck_alert_expired", "b"],
		]);
		expect(outbox.size).toBe(0);
	});

	it("abandonne les événements trop anciens", () => {
		const outbox = new Outbox({ maxAgeMs: 1000 });
		outbox.push("vieux", {}, 0);
		outbox.push("récent", {}, 900);
		expect(outbox.drain(1500).map((e) => e.eventType)).toEqual(["récent"]);
	});

	it("garde au plus maxSize événements, les plus récents", () => {
		const outbox = new Outbox({ maxSize: 2 });
		outbox.push("1", {}, 0);
		outbox.push("2", {}, 0);
		outbox.push("3", {}, 0);
		expect(outbox.drain(0).map((e) => e.eventType)).toEqual(["2", "3"]);
	});
});
