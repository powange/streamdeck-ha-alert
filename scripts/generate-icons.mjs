// Génère les icônes PNG du plugin (marketplace.png et marketplace@2x.png) sans dépendance :
// une cloche blanche sur un carré arrondi rouge, rastérisée avec suréchantillonnage.
// Usage : npm run icons
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../com.powange.ha-alert.sdPlugin/imgs/plugin/", import.meta.url);
const SAMPLES = 4;

/** Coordonnées normalisées (0..1) : vrai si le point est dans le fond arrondi. */
function inBackground(x, y) {
	const r = 0.18;
	const dx = Math.max(r - x, 0, x - (1 - r));
	const dy = Math.max(r - y, 0, y - (1 - r));
	return dx * dx + dy * dy <= r * r;
}

/** Vrai si le point est dans la cloche (dôme, corps évasé, rebord, battant, anneau). */
function inBell(x, y) {
	const cx = x - 0.5;
	if (y <= 0.42 && cx * cx + (y - 0.42) ** 2 <= 0.2 ** 2) return true;
	if (y > 0.42 && y <= 0.66 && Math.abs(cx) <= 0.2 + ((y - 0.42) / 0.24) * 0.06) return true;
	if (y > 0.66 && y <= 0.71 && Math.abs(cx) <= 0.28) return true;
	if (cx * cx + (y - 0.77) ** 2 <= 0.055 ** 2) return true;
	return cx * cx + (y - 0.205) ** 2 <= 0.035 ** 2;
}

function render(size) {
	const rgba = Buffer.alloc(size * size * 4);
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let bg = 0;
			let bell = 0;
			for (let sy = 0; sy < SAMPLES; sy++) {
				for (let sx = 0; sx < SAMPLES; sx++) {
					const x = (px + (sx + 0.5) / SAMPLES) / size;
					const y = (py + (sy + 0.5) / SAMPLES) / size;
					if (inBackground(x, y)) {
						bg++;
						if (inBell(x, y)) bell++;
					}
				}
			}
			const n = SAMPLES * SAMPLES;
			const t = py / size;
			// Dégradé vertical rouge vif → rouge sombre, cloche blanche par-dessus.
			const base = [Math.round(229 - 90 * t), Math.round(57 - 50 * t), Math.round(53 - 45 * t)];
			const k = bg === 0 ? 0 : bell / bg;
			const i = (py * size + px) * 4;
			rgba[i] = Math.round(base[0] + (255 - base[0]) * k);
			rgba[i + 1] = Math.round(base[1] + (255 - base[1]) * k);
			rgba[i + 2] = Math.round(base[2] + (255 - base[2]) * k);
			rgba[i + 3] = Math.round((255 * bg) / n);
		}
	}
	return encodePng(size, size, rgba);
}

// --- Encodage PNG minimal (RGBA 8 bits, sans filtre) ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // profondeur
	header[9] = 6; // RGBA
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

writeFileSync(new URL("marketplace.png", OUT), render(288));
writeFileSync(new URL("marketplace@2x.png", OUT), render(576));
console.log("Icônes générées dans", OUT.pathname);
