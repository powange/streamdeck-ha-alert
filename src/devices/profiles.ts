import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Profils « Alerte » déclarés dans le manifest, par type d'appareil.
 * Le nom (chemin du fichier sans extension) est aussi celui attendu par `switchToProfile`.
 */
export type ProfileMap = ReadonlyMap<number, string>;

/** Extrait les profils du manifest (le premier profil déclaré pour un type d'appareil l'emporte). */
export function profilesFromManifest(manifest: unknown): ProfileMap {
	const profiles = new Map<number, string>();
	const entries = (manifest as { Profiles?: unknown } | null)?.Profiles;
	if (!Array.isArray(entries)) return profiles;
	for (const entry of entries as { Name?: unknown; DeviceType?: unknown }[]) {
		if (typeof entry?.Name === "string" && typeof entry.DeviceType === "number" && !profiles.has(entry.DeviceType)) {
			profiles.set(entry.DeviceType, entry.Name);
		}
	}
	return profiles;
}

/** Lit les profils du manifest du plugin (le dossier courant est celui du plugin). */
export function loadProfiles(): ProfileMap {
	try {
		return profilesFromManifest(JSON.parse(readFileSync(join(process.cwd(), "manifest.json"), "utf8")));
	} catch {
		return new Map();
	}
}
