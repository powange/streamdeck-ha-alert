import { describe, expect, it } from "vitest";

import { parseAlert, parseClear } from "../src/alerts/schema";

describe("parseAlert", () => {
	it("applique les valeurs par défaut quand seul l'id est fourni", () => {
		const result = parseAlert({ id: "sonnette" });
		expect(result).toEqual({
			ok: true,
			value: {
				id: "sonnette",
				mode: "fullscreen",
				pattern: "blink",
				color: "#ff0000",
				color2: "#000000",
				keys: undefined,
				key_colors: {},
				text: "",
				text_style: "key",
				icon: "none",
				interval_ms: 500,
				duration_s: 30,
				priority: 0,
				ack_required: false,
			},
		});
	});

	it("accepte l'exemple complet de la spécification", () => {
		const result = parseAlert({
			id: "sonnette",
			mode: "fullscreen",
			pattern: "blink",
			color: "#ff0000",
			color2: "#000000",
			keys: [0, 4, 10],
			key_colors: { "0": "#ff0000", "4": "#00ff00" },
			text: "Sonnette",
			interval_ms: 400,
			duration_s: 30,
			priority: 5,
			ack_required: true,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.keys).toEqual([0, 4, 10]);
		expect(result.value.key_colors).toEqual({ "0": "#ff0000", "4": "#00ff00" });
		expect(result.value.ack_required).toBe(true);
	});

	it("refuse une alerte sans id", () => {
		const result = parseAlert({ color: "#ff0000" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("id");
	});

	it("refuse un id vide", () => {
		expect(parseAlert({ id: "  " }).ok).toBe(false);
	});

	it.each([
		["#F00", "#ff0000"],
		["#00FF00", "#00ff00"],
		[[0, 0, 255], "#0000ff"],
		[[255, 128, 0], "#ff8000"],
	])("normalise la couleur %j en %s", (input, expected) => {
		const result = parseAlert({ id: "a", color: input });
		expect(result.ok && result.value.color).toBe(expected);
	});

	it.each(["red", "#ff00", "ff0000", [1, 2]])("refuse la couleur invalide %j", (color) => {
		expect(parseAlert({ id: "a", color }).ok).toBe(false);
	});

	it.each([
		["0, 4, 10", [0, 4, 10]],
		["1;2 3", [1, 2, 3]],
		[["0", "4"], [0, 4]],
		[[], undefined],
		["", undefined],
	])("lit la liste de touches %j", (keys, expected) => {
		const result = parseAlert({ id: "a", keys });
		expect(result.ok && result.value.keys).toEqual(expected);
	});

	it("refuse un index de touche négatif ou non entier", () => {
		expect(parseAlert({ id: "a", keys: [-1] }).ok).toBe(false);
		expect(parseAlert({ id: "a", keys: [1.5] }).ok).toBe(false);
	});

	it("convertit les nombres et booléens envoyés en texte par les templates HA", () => {
		const result = parseAlert({ id: "a", interval_ms: "250", duration_s: "0", priority: "3", ack_required: "false" });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({ interval_ms: 250, duration_s: 0, priority: 3, ack_required: false });
		const on = parseAlert({ id: "a", ack_required: "true" });
		expect(on.ok && on.value.ack_required).toBe(true);
	});

	it("refuse un intervalle trop court (protection du logiciel Stream Deck)", () => {
		expect(parseAlert({ id: "a", interval_ms: 50 }).ok).toBe(false);
	});

	it("refuse un mode, un motif ou une icône inconnus", () => {
		expect(parseAlert({ id: "a", mode: "page" }).ok).toBe(false);
		expect(parseAlert({ id: "a", pattern: "strobe" }).ok).toBe(false);
		expect(parseAlert({ id: "a", icon: "unicorn" }).ok).toBe(false);
	});

	it("refuse une clé de key_colors qui n'est pas un index", () => {
		expect(parseAlert({ id: "a", key_colors: { haut: "#ff0000" } }).ok).toBe(false);
	});

	it("accepte un id numérique et le convertit en texte", () => {
		const result = parseAlert({ id: 42 });
		expect(result.ok && result.value.id).toBe("42");
	});
});

describe("parseClear", () => {
	it("accepte un id", () => {
		expect(parseClear({ id: "sonnette" })).toEqual({ ok: true, value: { id: "sonnette" } });
	});

	it("accepte l'absence de données (tout effacer)", () => {
		expect(parseClear(undefined)).toEqual({ ok: true, value: {} });
		expect(parseClear({})).toEqual({ ok: true, value: {} });
	});
});
