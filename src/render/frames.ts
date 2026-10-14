import type { Alert, Hex, IconName } from "../alerts/schema";
import { fitKeyText, GAP_PX, KEY_PX, layoutBanner, type BannerLayout, type Grid, type TextBlock } from "./text-layout";

/**
 * Calcul des frames d'animation : fonctions pures qui donnent l'apparence d'une touche
 * pour une alerte à un instant donné. Les valeurs sont quantifiées (niveaux de luminosité,
 * pas de teinte, pas de défilement) pour que le cache SVG soit efficace.
 */

/** Position d'une touche sur l'appareil. */
export interface KeyPosition {
	readonly column: number;
	readonly row: number;
}

/** Portion de la bannière visible sur une touche. */
export interface BannerSlice {
	readonly layout: BannerLayout;
	/** Coin haut-gauche de la touche dans le panneau (px). */
	readonly viewX: number;
	readonly viewY: number;
	/** Décalage du défilement (px), 0 pour un texte fixe. */
	readonly scroll: number;
}

/** Apparence d'une touche, convertie en SVG par `svg.ts`. */
export interface KeyFrame {
	readonly background: Hex;
	/** Couleur du texte et de l'icône, contrastée avec le fond. */
	readonly foreground: Hex;
	readonly icon: IconName;
	readonly text: TextBlock | null;
	readonly banner: BannerSlice | null;
}

/** Nombre de niveaux de luminosité du motif `pulse`. */
export const PULSE_LEVELS = 8;
/** Pas de teinte du motif `rainbow` (degrés). */
export const RAINBOW_HUE_STEP = 15;
/** Pas de défilement de la bannière (px). */
export const SCROLL_STEP = 8;
/** Durée pour faire défiler la largeur d'un caractère moyen (ms). */
const SCROLL_MS_PER_CHAR = 180;

/** Index d'une touche, comme dans le champ `keys` : ligne × colonnes + colonne. */
export function keyIndexOf(position: KeyPosition, grid: Grid): number {
	return position.row * grid.columns + position.column;
}

/** Vrai si l'alerte concerne cette touche (`keys` absent = toutes les touches). */
export function isTargeted(alert: Alert, index: number): boolean {
	return alert.keys === undefined || alert.keys.includes(index);
}

/** Apparence d'une touche à `elapsedMs` du début de l'affichage, ou `null` si elle n'est pas concernée. */
export function computeKeyFrame(alert: Alert, position: KeyPosition, grid: Grid, elapsedMs: number): KeyFrame | null {
	const index = keyIndexOf(position, grid);
	if (!isTargeted(alert, index)) return null;

	const background = patternColor(alert, position, grid, elapsedMs);
	const foreground = contrastColor(background);
	if (alert.text_style === "banner" && alert.text.trim() !== "") {
		return { background, foreground, icon: "none", text: null, banner: bannerSlice(alert.text, position, grid, elapsedMs) };
	}
	return { background, foreground, icon: alert.icon, text: fitKeyText(alert.text, alert.icon !== "none"), banner: null };
}

/** Couleur de fond d'une touche selon le motif de l'alerte. */
export function patternColor(alert: Alert, position: KeyPosition, grid: Grid, elapsedMs: number): Hex {
	const index = keyIndexOf(position, grid);
	const primary = alert.key_colors[String(index)] ?? alert.color;
	const t = Math.max(0, elapsedMs);
	const step = Math.floor(t / alert.interval_ms);

	switch (alert.pattern) {
		case "solid":
			return primary;
		case "blink":
			return step % 2 === 0 ? primary : alert.color2;
		case "pulse": {
			// Sinusoïde de période 2 × interval, quantifiée en PULSE_LEVELS niveaux.
			const phase = (t % (2 * alert.interval_ms)) / (2 * alert.interval_ms);
			const intensity = (1 - Math.cos(2 * Math.PI * phase)) / 2;
			const level = Math.round(intensity * (PULSE_LEVELS - 1)) / (PULSE_LEVELS - 1);
			return mix(alert.color2, primary, level);
		}
		case "chase": {
			// Une tête lumineuse suivie d'une traîne parcourt les touches concernées en serpentin.
			const order = chaseOrder(alert, grid);
			const own = order.indexOf(index);
			if (own < 0) return alert.color2;
			const distance = (((step - own) % order.length) + order.length) % order.length;
			if (distance === 0) return primary;
			if (distance === 1 && order.length > 2) return mix(alert.color2, primary, 0.35);
			return alert.color2;
		}
		case "rainbow": {
			// La teinte avance d'un pas par intervalle, décalée selon la position de la touche.
			const hue = (step * RAINBOW_HUE_STEP + (position.column + position.row) * 2 * RAINBOW_HUE_STEP) % 360;
			return hslToHex(hue, 1, 0.5);
		}
	}
}

/** Index serpentin : ligne 0 de gauche à droite, ligne 1 de droite à gauche, etc. */
export function snakeIndex(index: number, grid: Grid): number {
	const row = Math.floor(index / grid.columns);
	const column = index % grid.columns;
	return row * grid.columns + (row % 2 === 0 ? column : grid.columns - 1 - column);
}

/** Ordre de passage du motif `chase` : touches concernées, triées en serpentin. */
export function chaseOrder(alert: Alert, grid: Grid): number[] {
	const total = grid.columns * grid.rows;
	const indexes = alert.keys ? [...new Set(alert.keys)].filter((i) => i < total) : [...Array(total).keys()];
	return indexes.sort((a, b) => snakeIndex(a, grid) - snakeIndex(b, grid));
}

/** Portion de la bannière visible sur une touche. */
export function bannerSlice(text: string, position: KeyPosition, grid: Grid, elapsedMs: number): BannerSlice {
	const layout = layoutBanner(text, grid);
	let scroll = 0;
	if (layout.kind === "scroll") {
		const width = grid.columns * KEY_PX + (grid.columns - 1) * GAP_PX;
		const speed = (0.6 * layout.fontSize) / SCROLL_MS_PER_CHAR;
		const travel = width + layout.textWidth;
		scroll = Math.floor(((Math.max(0, elapsedMs) * speed) % travel) / SCROLL_STEP) * SCROLL_STEP;
	}
	return {
		layout,
		viewX: position.column * (KEY_PX + GAP_PX),
		viewY: position.row * (KEY_PX + GAP_PX),
		scroll,
	};
}

// --- Couleurs ---

function toRgb(hex: Hex): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex(r: number, g: number, b: number): Hex {
	const clamp = (c: number): number => Math.max(0, Math.min(255, Math.round(c)));
	return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

/** Mélange linéaire : `t = 0` donne `a`, `t = 1` donne `b`. */
export function mix(a: Hex, b: Hex, t: number): Hex {
	const [ar, ag, ab] = toRgb(a);
	const [br, bg, bb] = toRgb(b);
	return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Noir ou blanc, selon ce qui contraste le mieux avec le fond (luminance relative). */
export function contrastColor(background: Hex): Hex {
	const [r, g, b] = toRgb(background).map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance > 0.4 ? "#000000" : "#ffffff";
}

/** Conversion HSL → hexadécimal (`h` en degrés, `s` et `l` entre 0 et 1). */
export function hslToHex(h: number, s: number, l: number): Hex {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number): number => {
		const k = (n + h / 30) % 12;
		return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
	};
	return toHex(f(0), f(8), f(4));
}
