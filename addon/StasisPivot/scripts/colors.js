/**
 * StasisPivot - colour conversion plus the Bedrock text-colour map.
 *
 * Bedrock ignores hex colours in normal text, so the HUD keeps two values for
 * every configured colour:
 *   - the exact #RRGGBB value, used by the LeviLauncher HUD overlay renderer
 *     and shown in the in-game colour picker;
 *   - the closest §-code, used by the action-bar fallback renderer, so the
 *     panel still looks right on a vanilla client.
 */

const SECTION_PALETTE = [
  { code: "0", rgb: [0, 0, 0] },
  { code: "1", rgb: [0, 0, 170] },
  { code: "2", rgb: [0, 170, 0] },
  { code: "3", rgb: [0, 170, 170] },
  { code: "4", rgb: [170, 0, 0] },
  { code: "5", rgb: [170, 0, 170] },
  { code: "6", rgb: [255, 170, 0] },
  { code: "7", rgb: [170, 170, 170] },
  { code: "8", rgb: [85, 85, 85] },
  { code: "9", rgb: [85, 85, 255] },
  { code: "a", rgb: [85, 255, 85] },
  { code: "b", rgb: [85, 255, 255] },
  { code: "c", rgb: [255, 85, 85] },
  { code: "d", rgb: [255, 85, 255] },
  { code: "e", rgb: [255, 255, 85] },
  { code: "f", rgb: [255, 255, 255] },
  { code: "g", rgb: [221, 214, 5] }, // minecoin gold
];

export function parseHex(hex, fallback = [255, 255, 255]) {
  if (typeof hex !== "string") return fallback;
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return fallback;
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

export function toHex(rgb) {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Closest Bedrock § colour code for a hex value. */
export function sectionCode(hex) {
  const [r, g, b] = parseHex(hex);
  let best = SECTION_PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of SECTION_PALETTE) {
    const [cr, cg, cb] = candidate.rgb;
    // Weighted euclidean distance approximates perceived colour difference.
    const distance =
      2 * (r - cr) ** 2 + 4 * (g - cg) ** 2 + 3 * (b - cb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return `§${best.code}`;
}

export function colorize(hex, text) {
  return `${sectionCode(hex)}${text}§r`;
}

/** "#RRGGBB" + alpha in [0,1] -> "AARRGGBB" for the Levi HUD renderer. */
export function toArgb(hex, alpha = 1) {
  const [r, g, b] = parseHex(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return (
    (((Math.round(a * 255) & 0xff) << 24) |
      ((r & 0xff) << 16) |
      ((g & 0xff) << 8) |
      (b & 0xff)) >>>
    0
  );
}

/** "AARRGGBB" or "#RRGGBB" -> "#RRGGBB". */
export function fromArgb(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `#${((value >>> 0) & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
  }
  return toHex(parseHex(String(value ?? "")));
}

export function mix(a, b, t) {
  const left = parseHex(a);
  const right = parseHex(b);
  const clamped = Math.max(0, Math.min(1, t));
  return toHex(left.map((channel, index) => channel + (right[index] - channel) * clamped));
}

export function brightness(hex) {
  const [r, g, b] = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
