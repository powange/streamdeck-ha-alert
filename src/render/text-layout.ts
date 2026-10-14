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
 * Paragraphes d'un texte : les retours à la ligne saisis par l'utilisateur, sans lignes vides.
 * La séquence `\n` tapée littéralement (champ texte d'une ligne dans HA) compte aussi.
 */
export function paragraphs(text: string): string[] {
	return text
		.replace(/\\n/g, "\n")
		.split(/\r?\n/)
		.map((p) => p.trim())
		.filter((p) => p !== "");
}

/**
 * Découpe un texte en lignes de largeur maximale `maxWidth` : chaque retour à la ligne saisi
 * commence une nouvelle ligne, puis les paragraphes trop longs sont coupés entre les mots
 * (un mot plus large que la ligne est coupé lui aussi).
 */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
	return paragraphs(text).flatMap((paragraph) => wrapParagraph(paragraph, fontSize, maxWidth));
}

function wrapParagraph(text: string, fontSize: number, maxWidth: number): string[] {
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
	| {
			readonly kind: "static";
			readonly lines: readonly string[];
			readonly fontSize: number;
			/** Ordonnée du centre de chaque ligne dans le panneau (px). */
			readonly centers: readonly number[];
	  }
	| {
			readonly kind: "scroll";
			readonly line: string;
			readonly fontSize: number;
			readonly textWidth: number;
			/** Ordonnée du centre de la ligne dans le panneau (px). */
			readonly center: number;
	  };

/** En dessous de cette taille, on préfère faire défiler le texte plutôt que le réduire. */
const BANNER_MIN_STATIC = KEY_PX * 0.75;
/** Taille d'une ligne alignée sur une rangée de touches : 80 % de la hauteur d'une touche. */
const ROW_FONT_SIZE = Math.floor(KEY_PX * 0.8);

/** Ordonnée du centre de la rangée `row` dans le panneau. */
function rowCenter(row: number): number {
	return row * (KEY_PX + GAP_PX) + KEY_PX / 2;
}

/**
 * Texte géant étalé sur toute la grille, par ordre de préférence :
 * 1. une seule ligne, aussi grande que possible (jusqu'aux 3/4 de la hauteur) ;
 * 2. plusieurs lignes, chacune centrée sur une rangée de touches pour que les espaces
 *    entre rangées ne coupent pas les lettres ;
 * 3. une ligne défilante, alignée sur la rangée du milieu.
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
	const width = canvas.width * 0.94;

	const single = fitText(text, { width, height: canvas.height * 0.94 }, {
		maxLines: 1,
		max: Math.floor(canvas.height * 0.75),
		min: Math.floor(BANNER_MIN_STATIC),
	});
	if (single) {
		return { kind: "static", ...single, centers: [canvas.height / 2] };
	}

	if (grid.rows > 1) {
		const multi = fitText(text, { width, height: Number.POSITIVE_INFINITY }, {
			maxLines: grid.rows,
			max: ROW_FONT_SIZE,
			min: Math.floor(BANNER_MIN_STATIC),
		});
		if (multi) {
			const first = Math.floor((grid.rows - multi.lines.length) / 2);
			return { kind: "static", ...multi, centers: multi.lines.map((_, i) => rowCenter(first + i)) };
		}
	}

	// Une seule ligne défilante : les retours à la ligne deviennent des séparateurs.
	const line = paragraphs(text)
		.map((p) => p.replace(/\s+/g, " "))
		.join(" · ");
	return {
		kind: "scroll",
		line,
		fontSize: ROW_FONT_SIZE,
		textWidth: estimateTextWidth(line, ROW_FONT_SIZE),
		center: rowCenter(Math.floor((grid.rows - 1) / 2)),
	};
}
