import type { IconName } from "../alerts/schema";

/**
 * Icônes intégrées : tracés au trait dans une grille 28 × 28, colorés par `stroke`.
 * Les petits points sont pleins (`fill`), d'où le marqueur `DOT` remplacé au rendu.
 */
const DOT = "{fg}";

const ICON_PATHS: Record<Exclude<IconName, "none">, string> = {
	bell:
		'<path d="M14 4.5c-3.6 0-6 2.6-6 6v4.2L6 18.5h16l-2-3.8v-4.2c0-3.4-2.4-6-6-6Z"/>' +
		'<path d="M11.8 21a2.3 2.3 0 0 0 4.4 0"/>',
	door: `<path d="M8 25V4h12v21"/><path d="M5 25h18"/><circle cx="16.5" cy="15" r="1" fill="${DOT}"/>`,
	warning: `<path d="M14 4 25 23H3Z"/><path d="M14 11v6"/><circle cx="14" cy="20" r="0.8" fill="${DOT}"/>`,
	info: `<circle cx="14" cy="14" r="10"/><path d="M14 13v7"/><circle cx="14" cy="9" r="0.8" fill="${DOT}"/>`,
	check: '<circle cx="14" cy="14" r="10"/><path d="m9 14 3.5 3.5L19 11"/>',
	washer:
		'<rect x="5" y="3.5" width="18" height="21" rx="2"/><path d="M5 8h18"/><circle cx="14" cy="16" r="5"/>' +
		`<circle cx="8.5" cy="5.8" r="0.6" fill="${DOT}"/>`,
};

/**
 * Icône positionnée dans la touche : coin haut-gauche (`x`, `y`) et côté `size` (px).
 * Renvoie une chaîne vide pour `none`.
 */
export function iconSvg(name: IconName, x: number, y: number, size: number, color: string): string {
	if (name === "none") return "";
	const scale = size / 28;
	return (
		`<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2" ` +
		`stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name].replaceAll(DOT, color)}</g>`
	);
}
