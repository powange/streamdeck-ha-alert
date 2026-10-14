import { describe, expect, it } from "vitest";

import { alertSchema, type Alert } from "../src/alerts/schema";
import {
	bannerSlice,
	chaseOrder,
	computeKeyFrame,
	contrastColor,
	hslToHex,
	isTargeted,
	keyIndexOf,
	mix,
	patternColor,
	PULSE_LEVELS,
	SCROLL_STEP,
	snakeIndex,
} from "../src/render/frames";
import { canvasSize, estimateTextWidth, fitKeyText, KEY_PX, layoutBanner, wrapText } from "../src/render/text-layout";

const MK2 = { columns: 5, rows: 3 };
const XL = { columns: 8, rows: 4 };
const MINI = { columns: 3, rows: 2 };

function alert(fields: Partial<Alert> & { id?: string }): Alert {
	return alertSchema.parse({ id: "test", ...fields });
}

/** Position d'un index sur une grille. */
const at = (index: number, grid = MK2) => ({ column: index % grid.columns, row: Math.floor(index / grid.columns) });

describe("index et ciblage des touches", () => {
	it("calcule l'index ligne × colonnes + colonne", () => {
		expect(keyIndexOf({ column: 0, row: 0 }, MK2)).toBe(0);
		expect(keyIndexOf({ column: 4, row: 0 }, MK2)).toBe(4);
		expect(keyIndexOf({ column: 0, row: 2 }, MK2)).toBe(10);
		expect(keyIndexOf({ column: 7, row: 3 }, XL)).toBe(31);
	});

	it("cible toutes les touches si keys est absent, sinon seulement la liste", () => {
		expect(isTargeted(alert({}), 7)).toBe(true);
		expect(isTargeted(alert({ keys: [0, 4] }), 4)).toBe(true);
		expect(isTargeted(alert({ keys: [0, 4] }), 7)).toBe(false);
		expect(computeKeyFrame(alert({ keys: [0] }), at(1), MK2, 0)).toBeNull();
	});
});

describe("motifs", () => {
	const base = { color: "#ff0000", color2: "#000000", interval_ms: 400 } as const;

	it("solid : couleur fixe", () => {
		const a = alert({ ...base, pattern: "solid" });
		expect(patternColor(a, at(0), MK2, 0)).toBe("#ff0000");
		expect(patternColor(a, at(0), MK2, 12_345)).toBe("#ff0000");
	});

	it("blink : alterne color et color2 à chaque intervalle", () => {
		const a = alert({ ...base, pattern: "blink" });
		expect(patternColor(a, at(0), MK2, 0)).toBe("#ff0000");
		expect(patternColor(a, at(0), MK2, 399)).toBe("#ff0000");
		expect(patternColor(a, at(0), MK2, 400)).toBe("#000000");
		expect(patternColor(a, at(0), MK2, 800)).toBe("#ff0000");
	});

	it("key_colors remplace la couleur principale de la touche", () => {
		const a = alert({ ...base, pattern: "blink", key_colors: { "4": "#00ff00" } });
		expect(patternColor(a, at(4), MK2, 0)).toBe("#00ff00");
		expect(patternColor(a, at(4), MK2, 400)).toBe("#000000");
		expect(patternColor(a, at(3), MK2, 0)).toBe("#ff0000");
	});

	it("pulse : part de color2, culmine à color à mi-période, avec un nombre limité de niveaux", () => {
		const a = alert({ ...base, pattern: "pulse" });
		expect(patternColor(a, at(0), MK2, 0)).toBe("#000000");
		expect(patternColor(a, at(0), MK2, 400)).toBe("#ff0000");
		expect(patternColor(a, at(0), MK2, 800)).toBe("#000000");
		const colors = new Set<string>();
		for (let t = 0; t < 800; t += 10) colors.add(patternColor(a, at(0), MK2, t));
		expect(colors.size).toBeLessThanOrEqual(PULSE_LEVELS);
	});

	it("chase : une tête lumineuse parcourt les touches en serpentin", () => {
		const a = alert({ ...base, pattern: "chase" });
		// Pas 0 : la tête est sur la touche 0.
		expect(patternColor(a, at(0), MK2, 0)).toBe("#ff0000");
		expect(patternColor(a, at(1), MK2, 0)).toBe("#000000");
		// Pas 5 : fin de la ligne 0, la tête passe sur la ligne 1 côté droit (index 9).
		expect(patternColor(a, at(9), MK2, 5 * 400)).toBe("#ff0000");
		// La traîne suit la tête.
		expect(patternColor(a, at(4), MK2, 5 * 400)).toBe(mix("#000000", "#ff0000", 0.35));
		// Exactement une tête à chaque pas.
		for (let step = 0; step < 20; step++) {
			const heads = [...Array(15).keys()].filter((i) => patternColor(a, at(i), MK2, step * 400) === "#ff0000");
			expect(heads).toHaveLength(1);
		}
	});

	it("chase : ne parcourt que les touches ciblées", () => {
		const a = alert({ ...base, pattern: "chase", keys: [10, 0, 4] });
		expect(chaseOrder(a, MK2)).toEqual([0, 4, 10]);
		expect(patternColor(a, at(4), MK2, 400)).toBe("#ff0000");
		expect(patternColor(a, at(10), MK2, 800)).toBe("#ff0000");
		expect(patternColor(a, at(0), MK2, 1200)).toBe("#ff0000");
	});

	it("snakeIndex inverse les lignes impaires", () => {
		expect([5, 6, 9].map((i) => snakeIndex(i, MK2))).toEqual([9, 8, 5]);
	});

	it("rainbow : la teinte avance avec le temps et varie selon la position", () => {
		const a = alert({ ...base, pattern: "rainbow" });
		expect(patternColor(a, at(0), MK2, 0)).toBe("#ff0000");
		expect(patternColor(a, at(0), MK2, 400)).not.toBe(patternColor(a, at(0), MK2, 0));
		expect(patternColor(a, at(1), MK2, 0)).not.toBe(patternColor(a, at(0), MK2, 0));
	});
});

describe("couleurs", () => {
	it("mix interpole linéairement", () => {
		expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
		expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
		expect(mix("#000000", "#ff0000", 0.5)).toBe("#800000");
	});

	it("contrastColor choisit noir sur fond clair et blanc sur fond sombre", () => {
		expect(contrastColor("#ffffff")).toBe("#000000");
		expect(contrastColor("#00ff00")).toBe("#000000");
		expect(contrastColor("#ff0000")).toBe("#ffffff");
		expect(contrastColor("#000000")).toBe("#ffffff");
	});

	it("hslToHex donne les couleurs primaires", () => {
		expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
		expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
		expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
	});
});

describe("texte sur une touche", () => {
	it("tient sur une ligne en gros pour un mot court", () => {
		const block = fitKeyText("Linge", false);
		expect(block?.lines).toEqual(["Linge"]);
		expect(block?.fontSize).toBeGreaterThan(30);
	});

	it("passe sur plusieurs lignes, jamais plus de 3, sans dépasser la touche", () => {
		const block = fitKeyText("La machine à laver est terminée depuis longtemps", false);
		expect(block).not.toBeNull();
		if (!block) return;
		expect(block.lines.length).toBeLessThanOrEqual(3);
		for (const line of block.lines) expect(estimateTextWidth(line, block.fontSize)).toBeLessThanOrEqual(KEY_PX);
	});

	it("tronque avec … un texte trop long", () => {
		const block = fitKeyText("a ".repeat(100), false);
		expect(block?.lines.at(-1)?.endsWith("…")).toBe(true);
	});

	it("renvoie null pour un texte vide", () => {
		expect(fitKeyText("  ", false)).toBeNull();
	});

	it("respecte les retours à la ligne saisis, réels ou tapés \\n", () => {
		expect(wrapText("Porte\nd'entrée", 30, 500)).toEqual(["Porte", "d'entrée"]);
		expect(wrapText("Porte\\nd'entrée", 30, 500)).toEqual(["Porte", "d'entrée"]);
		expect(wrapText("Ligne 1\r\n\n  Ligne 2  ", 30, 500)).toEqual(["Ligne 1", "Ligne 2"]);
		expect(fitKeyText("Lave\nlinge", false)?.lines).toEqual(["Lave", "linge"]);
	});

	it("wrapText coupe un mot plus large que la ligne", () => {
		const lines = wrapText("Anticonstitutionnellement", 40, 120);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join("")).toBe("Anticonstitutionnellement");
	});
});

describe("bannière (texte géant sur toute la grille)", () => {
	it("affiche un texte court fixe, en très gros", () => {
		const layout = layoutBanner("STOP", MK2);
		expect(layout.kind).toBe("static");
		if (layout.kind === "static") expect(layout.fontSize).toBeGreaterThan(KEY_PX);
	});

	it("répartit un texte moyen sur plusieurs lignes si la grille le permet", () => {
		const layout = layoutBanner("Repas prêt", XL);
		expect(layout.kind).toBe("static");
	});

	it("place chaque ligne saisie sur sa propre rangée", () => {
		const layout = layoutBanner("Repas\nprêt", XL);
		expect(layout.kind).toBe("static");
		if (layout.kind === "static") expect(layout.lines).toEqual(["Repas", "prêt"]);
	});

	it("joint les lignes par « · » dans un texte défilant", () => {
		const layout = layoutBanner("La machine à laver est terminée\npense à étendre le linge tout de suite", MK2);
		expect(layout.kind).toBe("scroll");
		if (layout.kind === "scroll") expect(layout.line).toBe("La machine à laver est terminée · pense à étendre le linge tout de suite");
	});

	it("fait défiler un texte long", () => {
		const layout = layoutBanner("Le repas est prêt, tout le monde à table !", MK2);
		expect(layout.kind).toBe("scroll");
	});

	it("sur un Mini, un mot tient encore mais une phrase défile", () => {
		expect(layoutBanner("Sonnette", MINI).kind).toBe("static");
		expect(layoutBanner("Machine à laver terminée", MINI).kind).toBe("scroll");
	});

	it("positionne chaque touche dans le panneau en tenant compte des espaces", () => {
		const slice = bannerSlice("STOP", { column: 2, row: 1 }, MK2, 0);
		expect(slice.viewX).toBe(2 * (KEY_PX + 36));
		expect(slice.viewY).toBe(KEY_PX + 36);
		expect(slice.scroll).toBe(0);
		expect(canvasSize(MK2)).toEqual({ width: 5 * 144 + 4 * 36, height: 3 * 144 + 2 * 36 });
	});

	it("fait avancer le défilement par pas quantifiés et boucle", () => {
		const text = "Le repas est prêt, tout le monde à table !";
		const scrolls = [0, 500, 1000, 5000].map((t) => bannerSlice(text, at(0), MK2, t).scroll);
		expect(scrolls[0]).toBe(0);
		expect(scrolls[1]).toBeGreaterThan(0);
		expect(scrolls[2]).toBeGreaterThan(scrolls[1] ?? 0);
		for (const s of scrolls) expect(s % SCROLL_STEP).toBe(0);
		const layout = layoutBanner(text, MK2);
		const travel = canvasSize(MK2).width + (layout.kind === "scroll" ? layout.textWidth : 0);
		for (let t = 0; t < 60_000; t += 333) {
			expect(bannerSlice(text, at(0), MK2, t).scroll).toBeLessThan(travel);
		}
	});

	it("la frame d'une bannière n'a ni texte de touche ni icône", () => {
		const frame = computeKeyFrame(alert({ text: "STOP", text_style: "banner", icon: "bell" }), at(3), MK2, 0);
		expect(frame?.banner).not.toBeNull();
		expect(frame?.text).toBeNull();
		expect(frame?.icon).toBe("none");
	});

	it("sans texte, le style banner retombe sur une frame simple", () => {
		const frame = computeKeyFrame(alert({ text_style: "banner" }), at(0), MK2, 0);
		expect(frame?.banner).toBeNull();
	});
});
