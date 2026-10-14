import type { KeyPosition } from "./frames";
import type { Grid } from "./text-layout";

/** Rôle d'une Alert key : afficher l'alerte, ou piloter la file (◀ ▶ ✖✖). */
export type KeyRole = "alert" | "prev" | "next" | "clearAll";

/** Contexte d'affichage d'une touche. */
export interface LayoutContext {
	/** L'appareil affiche le profil Alerte. */
	readonly inAlertProfile: boolean;
	/** Nombre d'alertes dans la file. */
	readonly queueSize: number;
}

/**
 * Rôle d'une touche. Dans le profil Alerte, avec au moins 2 alertes et 3 rangées ou plus,
 * la dernière rangée porte ◀ (1re colonne), ▶ (2e colonne) et ✖✖ « tout acquitter » (dernière colonne).
 * Les petits appareils (Mini, Neo, +) n'ont pas de rangée de navigation.
 */
export function keyRole(position: KeyPosition, grid: Grid, context: LayoutContext): KeyRole {
	if (!context.inAlertProfile || context.queueSize < 2 || grid.rows < 3 || grid.columns < 3) return "alert";
	if (position.row !== grid.rows - 1) return "alert";
	if (position.column === 0) return "prev";
	if (position.column === 1) return "next";
	if (position.column === grid.columns - 1) return "clearAll";
	return "alert";
}

/** Vrai si la touche porte le badge « 1/3 » : coin haut-droit du profil Alerte, dès 2 alertes. */
export function hasBadge(position: KeyPosition, grid: Grid, context: LayoutContext): boolean {
	return context.inAlertProfile && context.queueSize >= 2 && position.row === 0 && position.column === grid.columns - 1;
}
