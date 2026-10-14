import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisplayedAlert } from "../src/alerts/alert-manager";
import { alertSchema, type Alert } from "../src/alerts/schema";
import type { AlertKeyHandle } from "../src/devices/key-registry";
import { Animator, MIN_TICK_MS, tickInterval } from "../src/render/animator";
import { computeKeyFrame } from "../src/render/frames";
import { DEFAULT_IDLE, idleLookFrom, keyImage, type RenderContext } from "../src/render/key-image";
import { cacheSize, escapeXml, renderControl, renderFrame, renderIdle } from "../src/render/svg";

const MK2 = { columns: 5, rows: 3 };

function alert(fields: Partial<Alert> = {}): Alert {
	return alertSchema.parse({ id: "test", ...fields });
}

/** Décode une data URL SVG. */
function svgOf(url: string): string {
	expect(url.startsWith("data:image/svg+xml;charset=utf8,")).toBe(true);
	return decodeURIComponent(url.slice(url.indexOf(",") + 1));
}

function handle(id: string, column: number, row: number, setImage = vi.fn(() => Promise.resolve())): AlertKeyHandle {
	return { id, deviceId: "DEV", deviceName: "Stream Deck", grid: MK2, position: { column, row }, idle: DEFAULT_IDLE, setImage };
}

describe("svg", () => {
	it("dessine le fond et le texte d'une touche", () => {
		const frame = computeKeyFrame(alert({ pattern: "solid", text: "Linge", text_style: "key" }), { column: 0, row: 0 }, MK2, 0)!;
		const svg = svgOf(renderFrame(frame, MK2));
		expect(svg).toContain('fill="#ff0000"');
		expect(svg).toContain(">Linge</text>");
		expect(svg).toMatch(/^<svg [^>]*width="144" height="144"/);
	});

	it("échappe le texte", () => {
		expect(escapeXml(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
		const frame = computeKeyFrame(alert({ pattern: "solid", text: "R&D <ok>", text_style: "key" }), { column: 0, row: 0 }, MK2, 0)!;
		const svg = svgOf(renderFrame(frame, MK2));
		expect(svg).toContain(">R&amp;D</text>");
		expect(svg).toContain(">&lt;ok&gt;</text>");
	});

	it("dessine l'icône demandée", () => {
		const frame = computeKeyFrame(alert({ pattern: "solid", icon: "bell", text_style: "key" }), { column: 0, row: 0 }, MK2, 0)!;
		expect(svgOf(renderFrame(frame, MK2))).toContain("<g transform=");
	});

	it("découpe la bannière : chaque touche montre sa portion du panneau", () => {
		const a = alert({ pattern: "solid", text: "STOP", text_style: "banner" });
		const left = svgOf(renderFrame(computeKeyFrame(a, { column: 0, row: 0 }, MK2, 0)!, MK2));
		const right = svgOf(renderFrame(computeKeyFrame(a, { column: 4, row: 2 }, MK2, 0)!, MK2));
		expect(left).toContain('viewBox="0 0 144 144"');
		expect(right).toContain('viewBox="720 360 144 144"');
		// Le texte est centré sur tout le panneau (864 × 504), contour noir compris.
		expect(left).toContain('x="432"');
		expect(left.match(/>STOP<\/text>/g)).toHaveLength(2);
	});

	it("met en cache les images identiques", () => {
		const frame = computeKeyFrame(alert({ pattern: "solid", text: "cache", text_style: "key" }), { column: 1, row: 1 }, MK2, 0)!;
		const first = renderFrame(frame, MK2);
		const size = cacheSize();
		expect(renderFrame({ ...frame }, MK2)).toBe(first);
		expect(cacheSize()).toBe(size);
	});

	it("dessine l'apparence de repos", () => {
		const svg = svgOf(renderIdle({ color: "#202020", text: "Porte", icon: "door" }));
		expect(svg).toContain('fill="#202020"');
		expect(svg).toContain(">Porte</text>");
	});
});

describe("keyImage", () => {
	/** Contexte avec une seule alerte affichée, hors profil Alerte. */
	const displayed = (fields: Partial<Alert>, startedAt = 0): RenderContext => ({
		displayed: { alert: alert(fields), startedAt, receivedAt: 0 } satisfies DisplayedAlert,
		position: { index: 1, total: 1 },
		isInAlertProfile: () => false,
	});

	it("montre l'apparence de repos sans alerte", () => {
		expect(keyImage(handle("k", 0, 0), { displayed: undefined, position: null, isInAlertProfile: () => false }, 0)).toBe(renderIdle(DEFAULT_IDLE));
	});

	it("montre l'alerte sur les touches ciblées seulement", () => {
		const shown = displayed({ pattern: "solid", keys: [1] });
		expect(keyImage(handle("k", 1, 0), shown, 0)).not.toBe(renderIdle(DEFAULT_IDLE));
		expect(keyImage(handle("k", 2, 0), shown, 0)).toBe(renderIdle(DEFAULT_IDLE));
	});

	it("laisse au repos une touche de multi-action (position inconnue)", () => {
		const key = { ...handle("k", 0, 0), position: null };
		expect(keyImage(key, displayed({ pattern: "solid" }), 0)).toBe(renderIdle(DEFAULT_IDLE));
	});

	it("anime à partir du début d'affichage de l'alerte", () => {
		const shown = displayed({ pattern: "blink", interval_ms: 400 }, 10_000);
		const on = keyImage(handle("k", 0, 0), shown, 10_000);
		const off = keyImage(handle("k", 0, 0), shown, 10_400);
		expect(on).not.toBe(off);
		expect(svgOf(on)).toContain('fill="#ff0000"');
	});

	describe("dans le profil Alerte avec plusieurs alertes", () => {
		const queued = (total: number): RenderContext => ({
			displayed: { alert: alert({ pattern: "solid" }), startedAt: 0, receivedAt: 0 },
			position: { index: 1, total },
			isInAlertProfile: () => true,
		});

		it("dessine ◀ ▶ ✖✖ sur la dernière rangée", () => {
			expect(keyImage(handle("k", 0, 2), queued(3), 0)).toBe(renderControl("prev"));
			expect(keyImage(handle("k", 1, 2), queued(3), 0)).toBe(renderControl("next"));
			expect(keyImage(handle("k", 4, 2), queued(3), 0)).toBe(renderControl("clearAll"));
			expect(keyImage(handle("k", 2, 2), queued(3), 0)).toBe(renderFrame(computeKeyFrame(alert({ pattern: "solid" }), { column: 2, row: 2 }, MK2, 0)!, MK2));
		});

		it("affiche le badge 1/3 dans le coin haut-droit", () => {
			expect(svgOf(keyImage(handle("k", 4, 0), queued(3), 0))).toContain(">1/3</text>");
			expect(svgOf(keyImage(handle("k", 3, 0), queued(3), 0))).not.toContain("1/3");
		});

		it("n'affiche ni navigation ni badge avec une seule alerte", () => {
			expect(keyImage(handle("k", 0, 2), queued(1), 0)).not.toBe(renderControl("prev"));
			expect(svgOf(keyImage(handle("k", 4, 0), queued(1), 0))).not.toContain("1/1");
		});
	});

	it("idleLookFrom ignore les réglages invalides", () => {
		expect(idleLookFrom({})).toEqual(DEFAULT_IDLE);
		expect(idleLookFrom({ idleColor: "rouge", idleIcon: "licorne" })).toEqual(DEFAULT_IDLE);
		expect(idleLookFrom({ idleColor: "#00FF00", idleIcon: "door", idleText: "Porte" })).toEqual({ color: "#00ff00", icon: "door", text: "Porte" });
	});
});

describe("Animator", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("n'envoie une image que si elle a changé", () => {
		const key = handle("k", 0, 0);
		let image = "A";
		const animator = new Animator({ keys: () => [key], render: () => image });
		animator.refresh();
		animator.refresh();
		expect(key.setImage).toHaveBeenCalledTimes(1);
		image = "B";
		animator.refresh();
		expect(key.setImage).toHaveBeenLastCalledWith("B");
		expect(key.setImage).toHaveBeenCalledTimes(2);
	});

	it("redessine une touche qui réapparaît, même avec la même image", () => {
		const key = handle("k", 0, 0);
		const animator = new Animator({ keys: () => [key], render: () => "A" });
		animator.refresh();
		animator.draw(key);
		expect(key.setImage).toHaveBeenCalledTimes(2);
	});

	it("utilise un seul timer à 10 fps et s'arrête sans alerte", async () => {
		const keys = [handle("a", 0, 0), handle("b", 1, 0)];
		const render = vi.fn((key: AlertKeyHandle, now: number) => `${key.id}:${now}`);
		const animator = new Animator({ keys: () => keys, render });
		animator.setAnimating(true);
		await vi.advanceTimersByTimeAsync(1000);
		// Tick immédiat + 10 ticks en une seconde, 2 touches par tick.
		expect(render).toHaveBeenCalledTimes(22);
		animator.setAnimating(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(render).toHaveBeenCalledTimes(22);
	});

	it("ralentit le tick quand il y a beaucoup de touches", () => {
		expect(tickInterval(15)).toBe(MIN_TICK_MS);
		expect(tickInterval(32)).toBe(160);
		expect(tickInterval(64)).toBe(320);
	});

	it("renvoie l'image au tick suivant si setImage échoue", async () => {
		const setImage = vi.fn().mockRejectedValueOnce(new Error("hors ligne")).mockResolvedValue(undefined);
		const key = handle("k", 0, 0, setImage);
		const onError = vi.fn();
		const animator = new Animator({ keys: () => [key], render: () => "A", onError });
		animator.refresh();
		await vi.advanceTimersByTimeAsync(0);
		expect(onError).toHaveBeenCalledOnce();
		animator.refresh();
		expect(setImage).toHaveBeenCalledTimes(2);
	});
});
