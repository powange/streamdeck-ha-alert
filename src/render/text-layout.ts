/**
 * Mise en page du texte sans moteur de police : la largeur des caractères est estimée
 * par classes (étroits, larges, majuscules…) pour une police sans-serif en gras.
 * L'estimation est volontairement un peu large pour éviter les débordements.
 */

/** Taille d'une touche dans les SVG générés (px). */
export const KEY_PX = 144;
/** Espace physique entre deux touches, à l'échelle de KEY_PX (px). */
export const GAP_PX = 36;
/** Interligne, en multiple de la taille de police. */
export const LINE_HEIGHT = 1.15;

const NARROW = new Set("iljtfrI.,;:!'|() ");
const WIDE = new Set("MWmw@%&");

/** Largeur estimée d'un caractère, en fraction de la taille de police. */
function charWidth(ch: string): number {
	if (NARROW.has(ch)) return 0.34;
	if (WIDE.has(ch)) return 0.92;
	if (/[0-9]/.test(ch)) return 0.58;
	if (ch !== ch.toLowerCase()) return 0.7;
	return 0.6;
}

/** Largeur estimée d'un texte (px) pour une taille de police donnée. */
export function estimateTextWidth(text: string, fontSize: number): number {
	let width = 0;
	for (const ch of text) width += charWidth(ch);
	return width * fontSize;
}

/**
 * Découpe un texte en lignes de largeur maximale `maxWidth` (retour à la ligne par mots ;
 * un mot trop long est coupé).
 */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter((w) => w !== "")) {
		const candidate = line === "" ? word : `${line} ${word}`;
		if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
			line = candidate;
			continue;
		}
		if (line !== "") lines.push(line);
		line = "";
		// Mot plus large que la ligne : on le coupe caractère par caractère.
		for (const ch of word) {
			if (line !== "" && estimateTextWidth(line + ch, fontSize) > maxWidth) {
				lines.push(line);
				line = "";
			}
			line += ch;
		}
	}
	if (line !== "") lines.push(line);
	return lines;
}

/** Bloc de texte prêt à dessiner. */
export interface TextBlock {
	readonly lines: readonly string[];
	readonly fontSize: number;
}

/**
 * Cherche la plus grande taille de police (entre `max` et `min`) pour laquelle le texte tient
 * dans la zone en `maxLines` lignes au plus. Renvoie `null` si rien ne tient, même à `min`.
 */
export function fitText(
	text: string,
	area: { width: number; height: number },
	options: { maxLines: number; max: number; min: number },
): TextBlock | null {
	const words = text.split(/\s+/).filter((w) => w !== "");
	// Premier passage sans couper de mot ; la coupure n'est qu'un dernier recours.
	for (const allowBreak of [false, true]) {
		for (let fontSize = options.max; fontSize >= options.min; fontSize -= 2) {
			if (!allowBreak && words.some((w) => estimateTextWidth(w, fontSize) > area.width)) continue;
			const lines = wrapText(text, fontSize, area.width);
			if (lines.length <= options.maxLines && lines.length * fontSize * LINE_HEIGHT <= area.height) {
				return { lines, fontSize };
			}
		}
	}
	return null;
}

/** Ajoute « … » en raccourcissant la ligne jusqu'à ce qu'elle tienne. */
function ellipsize(line: string, fontSize: number, maxWidth: number): string {
	let result = line;
	while (result.length > 0 && estimateTextWidth(`${result}…`, fontSize) > maxWidth) {
		result = result.slice(0, -1);
	}
	return `${result.trimEnd()}…`;
}

/** Zone utile d'une touche (marges comprises). */
const KEY_PADDING = 10;

/**
 * Texte d'une touche (style `key`) : jusqu'à 3 lignes, taille ajustée.
 * Si une icône est affichée, le texte occupe le tiers bas de la touche.
 * Au-delà de la taille minimale, la dernière ligne est tronquée avec « … ».
 */
export function fitKeyText(text: string, withIcon: boolean): TextBlock | null {
	if (text.trim() === "") return null;
	const width = KEY_PX - 2 * KEY_PADDING;
	const height = withIcon ? KEY_PX * 0.36 : KEY_PX - 2 * KEY_PADDING;
	const maxLines = withIcon ? 1 : 3;
	const fitted = fitText(text, { width, height }, { maxLines, max: withIcon ? 34 : 52, min: 16 });
	if (fitted) return fitted;

	const fontSize = 16;
	const lines = wrapText(text, fontSize, width);
	const kept = lines.slice(0, maxLines);
	kept[kept.length - 1] = ellipsize(kept[kept.length - 1] ?? "", fontSize, width);
	return { lines: kept, fontSize };
}

/** Dimensions de la grille d'un appareil, en touches. */
export interface Grid {
	readonly columns: number;
	readonly rows: number;
}

/** Taille (px) du « panneau » formé par toute la grille, espaces entre touches compris. */
export function canvasSize(grid: Grid): { width: number; height: number } {
	return {
		width: grid.columns * KEY_PX + (grid.columns - 1) * GAP_PX,
		height: grid.rows * KEY_PX + (grid.rows - 1) * GAP_PX,
	};
}

/** Mise en page d'un texte géant étalé sur toute la grille (style `banner`). */
export type BannerLayout =
	| { readonly kind: "static"; readonly lines: readonly string[]; readonly fontSize: number }
	| { readonly kind: "scroll"; readonly line: string; readonly fontSize: number; readonly textWidth: number };

/** En dessous de cette taille, on préfère faire défiler le texte plutôt que le réduire. */
const BANNER_MIN_STATIC = KEY_PX * 0.75;

/**
 * Texte géant : affiché fixe et centré s'il tient sur `rows` lignes au plus avec une taille
 * suffisante, sinon défilant sur une ligne (environ 7 caractères visibles à la fois).
 */
export function layoutBanner(text: string, grid: Grid): BannerLayout {
	const key = `${grid.columns}x${grid.rows}:${text}`;
	let layout = bannerCache.get(key);
	if (!layout) {
		layout = computeBannerLayout(text, grid);
		// Cache borné : peu de textes différents sont affichés en même temps.
		if (bannerCache.size >= 64) bannerCache.clear();
		bannerCache.set(key, layout);
	}
	return layout;
}

/** Mises en page déjà calculées : `layoutBanner` est appelée pour chaque touche à chaque tick. */
const bannerCache = new Map<string, BannerLayout>();

function computeBannerLayout(text: string, grid: Grid): BannerLayout {
	const canvas = canvasSize(grid);
	const area = { width: canvas.width * 0.94, height: canvas.height * 0.94 };
	const fitted = fitText(text, area, {
		maxLines: grid.rows,
		max: Math.floor(canvas.height * 0.75),
		min: Math.floor(BANNER_MIN_STATIC),
	});
	if (fitted) {
		return { kind: "static", ...fitted };
	}
	const line = text.replace(/\s+/g, " ").trim();
	const fontSize = Math.floor(Math.min(canvas.height * 0.75, canvas.width / 7 / 0.6));
	return { kind: "scroll", line, fontSize, textWidth: estimateTextWidth(line, fontSize) };
}
