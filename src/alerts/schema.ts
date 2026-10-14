import { z } from "zod";

/** Couleur normalisée au format `#rrggbb` (minuscules). */
export type Hex = `#${string}`;

/** Icônes intégrées disponibles pour les alertes. */
export const ICONS = ["none", "bell", "door", "warning", "info", "check", "washer"] as const;
export type IconName = (typeof ICONS)[number];

/**
 * Couleur : accepte `#rgb`, `#rrggbb` ou une liste `[r, g, b]`
 * (format renvoyé par le sélecteur `color_rgb` de Home Assistant).
 */
const color = z.preprocess(
	(value) => {
		if (Array.isArray(value) && value.length === 3) {
			return `#${value.map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
		}
		return value;
	},
	z
		.string()
		.trim()
		.regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "couleur attendue : #rrggbb, #rgb ou [r, g, b]")
		.transform((hex): Hex => {
			const h = hex.toLowerCase();
			return (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h) as Hex;
		}),
);

/** Booléen tolérant : `"false"`, `"off"`, `"0"`… (templates Home Assistant) valent `false`. */
const bool = z.preprocess(
	(value) => (typeof value === "string" ? !["", "false", "0", "off", "no", "non"].includes(value.trim().toLowerCase()) : value),
	z.boolean(),
);

const keyIndex = z.coerce.number().int().min(0).max(255);

/**
 * Liste de touches : `[0, 4, 10]`, `["0", "4"]` ou `"0, 4, 10"`
 * (pratique avec les templates et les sélecteurs texte de Home Assistant).
 * Une liste vide ou absente signifie « toutes les touches ».
 */
const keyList = z.preprocess((value) => {
	if (typeof value === "string") {
		const parts = value.split(/[\s,;]+/).filter((p) => p !== "");
		return parts.length > 0 ? parts : undefined;
	}
	if (Array.isArray(value) && value.length === 0) return undefined;
	return value;
}, z.array(keyIndex).optional());

/**
 * Retire les champs `null` ou vides : un script Home Assistant transmet `null` pour un champ
 * optionnel non renseigné, qui doit alors prendre sa valeur par défaut.
 */
function withoutEmptyFields(data: unknown): unknown {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
	return Object.fromEntries(
		Object.entries(data).filter(([, value]) => value !== null && !(typeof value === "string" && value.trim() === "")),
	);
}

/** Schéma de l'événement `streamdeck_alert`. */
export const alertSchema = z.preprocess(
	withoutEmptyFields,
	z
		.object({
			id: z.coerce.string().trim().min(1, "id obligatoire"),
			mode: z.enum(["fullscreen", "keys"]).default("fullscreen"),
			pattern: z.enum(["blink", "pulse", "chase", "solid", "rainbow"]).default("blink"),
			color: color.default("#ff0000"),
			color2: color.default("#000000"),
			keys: keyList,
			key_colors: z.record(z.string().regex(/^\d+$/, "index de touche attendu"), color).default({}),
			text: z.coerce.string().max(200).default(""),
			/** Absent : texte géant (`banner`) en mode `fullscreen`, texte par touche (`key`) en mode `keys`. */
			text_style: z.enum(["key", "banner"]).optional(),
			icon: z.enum(ICONS).default("none"),
			interval_ms: z.coerce.number().int().min(100).max(10_000).default(500),
			duration_s: z.coerce.number().min(0).max(86_400).default(30),
			priority: z.coerce.number().int().min(-1000).max(1000).default(0),
			ack_required: bool.default(false),
		})
		.transform((alert) => ({ ...alert, text_style: alert.text_style ?? (alert.mode === "fullscreen" ? "banner" : "key") })),
);

/** Alerte validée, avec toutes les valeurs par défaut appliquées. */
export type Alert = z.output<typeof alertSchema>;

/** Schéma de l'événement `streamdeck_alert_clear` : sans `id`, tout est effacé. */
export const clearSchema = z.preprocess(
	withoutEmptyFields,
	z.object({
		id: z.coerce.string().trim().min(1).optional(),
	}),
);

export type ClearRequest = z.output<typeof clearSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Valide les données d'un événement `streamdeck_alert`. */
export function parseAlert(data: unknown): ParseResult<Alert> {
	return toResult(alertSchema.safeParse(data));
}

/** Valide les données d'un événement `streamdeck_alert_clear`. */
export function parseClear(data: unknown): ParseResult<ClearRequest> {
	return toResult(clearSchema.safeParse(data ?? {}));
}

function toResult<T>(result: z.ZodSafeParseResult<T>): ParseResult<T> {
	return result.success ? { ok: true, value: result.data } : { ok: false, error: z.prettifyError(result.error) };
}
