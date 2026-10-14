import type { Hex, IconName } from "../alerts/schema";
import { contrastColor, mix, type KeyFrame } from "./frames";
import { iconSvg } from "./icons";
import { canvasSize, fitKeyText, KEY_PX, LINE_HEIGHT, type Grid, type TextBlock } from "./text-layout";

/**
 * Conversion des frames en images SVG (data URL), avec cache.
 * Le SVG reste simple (pas de `paint-order` ni de `dominant-baseline`) pour être
 * correctement rendu par le moteur du logiciel Stream Deck.
 */

const FONT = 'font-family="Arial, Helvetica, sans-serif" font-weight="bold"';

/** Nombre maximal d'images gardées en cache. */
const CACHE_SIZE = 1000;
const cache = new Map<string, string>();

/** Lit ou calcule une image en cache (cache LRU : l'entrée lue est replacée en fin de Map). */
function cached(key: string, build: () => string): string {
	const hit = cache.get(key);
	if (hit !== undefined) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	const url = build();
	cache.set(key, url);
	if (cache.size > CACHE_SIZE) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return url;
}

/** Taille actuelle du cache (pour les tests). */
export function cacheSize(): number {
	return cache.size;
}

export function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function toDataUrl(svg: string): string {
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** Lignes de texte centrées verticalement autour de `centerY`. */
function textLines(block: TextBlock, centerX: number, centerY: number, color: string, outline = false): string {
	const lineHeight = block.fontSize * LINE_HEIGHT;
	return block.lines
		.map((line, i) => {
			// La ligne de base est placée sous le centre visuel de la ligne (≈ 0,35 em pour Arial).
			const y = centerY + (i - (block.lines.length - 1) / 2) * lineHeight + block.fontSize * 0.35;
			return textElement(line, centerX, y, block.fontSize, color, "middle", outline);
		})
		.join("");
}

/**
 * Élément texte. Avec `outline`, le texte est d'abord tracé avec un contour noir épais,
 * puis rempli par-dessus : il reste lisible sur n'importe quel fond.
 */
function textElement(text: string, x: number, y: number, size: number, color: string, anchor: "start" | "middle", outline: boolean): string {
	const attrs = `x="${round(x)}" y="${round(y)}" font-size="${size}" ${FONT} text-anchor="${anchor}"`;
	const value = escapeXml(text);
	const stroke = outline
		? `<text ${attrs} fill="#000000" stroke="#000000" stroke-width="${round(size * 0.12)}" stroke-linejoin="round">${value}</text>`
		: "";
	return `${stroke}<text ${attrs} fill="${color}">${value}</text>`;
}

const round = (n: number): number => Math.round(n * 10) / 10;

function keySvg(content: string, background: string, viewBox = `0 0 ${KEY_PX} ${KEY_PX}`, x = 0, y = 0): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${KEY_PX}" height="${KEY_PX}" viewBox="${viewBox}">` +
		`<rect x="${x}" y="${y}" width="${KEY_PX}" height="${KEY_PX}" fill="${background}"/>${content}</svg>`
	);
}

/** Contenu d'une touche : icône seule, texte seul, ou icône en haut et texte en bas. */
function keyContent(icon: IconName, text: TextBlock | null, color: string): string {
	if (icon === "none") {
		return text ? textLines(text, KEY_PX / 2, KEY_PX / 2, color) : "";
	}
	if (!text) {
		return iconSvg(icon, 22, 22, 100, color);
	}
	return iconSvg(icon, 37, 8, 70, color) + textLines(text, KEY_PX / 2, 112, color);
}

/** Image d'une touche pour une frame d'animation. */
export function renderFrame(frame: KeyFrame, grid: Grid): string {
	return cached(`f:${grid.columns}x${grid.rows}:${JSON.stringify(frame)}`, () => {
		const banner = frame.banner;
		if (!banner) {
			return toDataUrl(keySvg(keyContent(frame.icon, frame.text, frame.foreground), frame.background));
		}

		// Bannière : le SVG décrit tout le panneau, la viewBox n'en montre que la portion de la touche.
		const canvas = canvasSize(grid);
		const { layout } = banner;
		const baseline = (center: number): number => center + layout.fontSize * 0.35;
		const content =
			layout.kind === "static"
				? layout.lines.map((line, i) => textElement(line, canvas.width / 2, baseline(layout.centers[i] ?? canvas.height / 2), layout.fontSize, "#ffffff", "middle", true)).join("")
				: textElement(layout.line, canvas.width - banner.scroll, baseline(layout.center), layout.fontSize, "#ffffff", "start", true);
		const viewBox = `${banner.viewX} ${banner.viewY} ${KEY_PX} ${KEY_PX}`;
		return toDataUrl(keySvg(content, frame.background, viewBox, banner.viewX, banner.viewY));
	});
}

/** Apparence d'une Alert key hors alerte, réglée dans son inspecteur. */
export interface IdleLook {
	readonly color: Hex;
	readonly text: string;
	readonly icon: IconName;
}

/** Image d'une Alert key au repos : couleur de fond, texte et icône atténués. */
export function renderIdle(look: IdleLook): string {
	return cached(`i:${JSON.stringify(look)}`, () => {
		// Texte et icône à 45 % entre le fond et la couleur contrastée : visibles sans attirer l'œil.
		const color = mix(look.color, contrastColor(look.color), 0.45);
		return toDataUrl(keySvg(keyContent(look.icon, fitKeyText(look.text, look.icon !== "none"), color), look.color));
	});
}
