/**
 * StasisPivot - measurement helpers.
 *
 * A pivot (source block) is the origin of the measurement: its X/Y/Z are both
 * the reported coordinates and the 0/0/0 reference for the player's offset.
 * These functions are deliberately free of engine calls so they can be unit
 * tested on a PC build host (see tests/geom_test.mjs).
 */

/** Distance labels are rendered with a fixed, readable precision. */
export function formatCoord(value) {
  const rounded = Math.round(value);
  return rounded === 0 ? "0" : String(rounded);
}

export function formatDecimal(value, digits = 2) {
  if (!Number.isFinite(value)) return "0";
  const scale = 10 ** digits;
  const rounded = Math.round(value * scale) / scale;
  const text = rounded.toFixed(digits);
  // Avoid "-0.00": a value that rounds away to zero is just zero.
  return /^-0\.?0*$/.test(text) ? (0).toFixed(digits) : text;
}

export function formatSigned(value) {
  const formatted = formatDecimal(Math.abs(value), 2);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

/**
 * Block coordinates of the source are 0,0,0, so the player's offset is the
 * raw difference between the player and the source centre.
 */
export function offsetFrom(playerLocation, source) {
  return {
    x: playerLocation.x - source.x,
    y: playerLocation.y - source.y,
    z: playerLocation.z - source.z,
  };
}

/** Straight-line distance, the S value. */
export function straightLine(offset) {
  return Math.sqrt(offset.x * offset.x + offset.y * offset.y + offset.z * offset.z);
}

/** Horizontal distance, used for the beam fade and draw distance. */
export function horizontalDistance(offset) {
  return Math.sqrt(offset.x * offset.x + offset.z * offset.z);
}

/** Which block face the player is closest to (used for the beam fade). */
export function dominantAxis(offset) {
  const ax = Math.abs(offset.x);
  const ay = Math.abs(offset.y);
  const az = Math.abs(offset.z);
  if (ax >= ay && ax >= az) return "x";
  if (ay >= az) return "y";
  return "z";
}

/**
 * The block the source should snap to when "snap to block below" is on:
 * the block directly under the player's feet, matching the requested
 * "hologram block below my character".
 */
export function blockBelow(playerLocation) {
  return {
    x: Math.floor(playerLocation.x),
    y: Math.floor(playerLocation.y) - 1,
    z: Math.floor(playerLocation.z),
  };
}

/** Block containing a position (no -1), used when snapping is disabled. */
export function blockAt(location) {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

/** Format "X 120  Y 64  Z -8  S 34.42" pieces for menus and chat. */
export function describePivot(playerLocation, source) {
  const offset = offsetFrom(playerLocation, source);
  return {
    x: formatCoord(source.x),
    y: formatCoord(source.y),
    z: formatCoord(source.z),
    s: formatDecimal(straightLine(offset), 2),
    dx: formatSigned(offset.x),
    dy: formatSigned(offset.y),
    dz: formatSigned(offset.z),
  };
}

/** Compact "120 / 64 / -8" string. */
export function compactPivot(source) {
  return `${formatCoord(source.x)} / ${formatCoord(source.y)} / ${formatCoord(source.z)}`;
}
