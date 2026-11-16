/**
 * StasisPivot - world feedback for the source block.
 *
 * Markers, each behind its own toggle:
 *   - particle beam above and below the source block (the "hologram block"
 *     look without touching real blocks or world save data);
 *   - locator-bar waypoint pinned to the source;
 *   - chat line and click when the source moves.
 */

import { LocationWaypoint, WaypointTexture } from "@minecraft/server";
import { get } from "./settings.js";
import { compactPivot, formatDecimal, offsetFrom, straightLine } from "./geom.js";
import { colorize, parseHex } from "./colors.js";

/** Column of particles rising from the source block. */
export function drawBeam(player, source) {
  if (!get("enabled") || !get("beam_enabled")) return;
  const dimension = player.dimension;
  const location = { x: source.x + 0.5, y: source.y + 0.5, z: source.z + 0.5 };

  for (let dy = -4; dy <= 8; dy += 1.2) {
    safe(() =>
      dimension.spawnParticle("stasispivot:beacon_core", {
        x: location.x,
        y: location.y + dy,
        z: location.z,
      }),
    );
  }

  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
    safe(() =>
      dimension.spawnParticle("stasispivot:beacon_ring", {
        x: location.x + Math.cos(angle) * 0.72,
        y: location.y + 0.06,
        z: location.z + Math.sin(angle) * 0.72,
      }),
    );
  }
}

/** Larger burst used right after the source moves. */
export function burst(player, source) {
  if (!get("enabled")) return;
  const dimension = player.dimension;
  const location = { x: source.x + 0.5, y: source.y + 1, z: source.z + 0.5 };
  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18;
    safe(() =>
      dimension.spawnParticle("stasispivot:beacon_ring", {
        x: location.x + Math.cos(angle) * 0.5,
        y: location.y + (index % 3) * 0.4,
        z: location.z + Math.sin(angle) * 0.5,
      }),
    );
  }
}

/**
 * Locator-bar pin built from LocationWaypoint: a world position, not an
 * entity, so it survives the player walking away. The texture set changes with
 * distance the same way vanilla locator markers do.
 */
export class WaypointMarker {
  constructor() {
    /** One waypoint per player: each player tracks their own source. */
    /** @type {Map<string, {waypoint: import("@minecraft/server").LocationWaypoint, key: string}>} */
    this.entries = new Map();
  }

  sync(player, source) {
    if (!get("enabled") || !get("waypoint_enabled")) {
      this.clearFor(player);
      return;
    }

    const texture = get("waypoint_texture");
    const color = get("waypoint_color");
    const key = `${source.dimension}|${source.x}|${source.y}|${source.z}|${texture}|${color}`;
    const location = {
      dimension: player.dimension,
      x: source.x + 0.5,
      y: source.y + 0.5,
      z: source.z + 0.5,
    };

    const entry = this.entries.get(player.id);
    // Reuse the waypoint while it is valid and unchanged: creating one every
    // tick would churn the locator bar.
    if (entry && entry.key === key && entry.waypoint.isValid) {
      safe(() => entry.waypoint.setDimensionLocation(location));
      return;
    }

    this.clearFor(player);
    try {
      const waypoint = new LocationWaypoint(
        location,
        {
          textureBoundsList: [
            { lowerBound: 0, upperBound: 32, texture: WaypointTexture.SmallSquare },
            { lowerBound: 32, upperBound: 128, texture },
            { lowerBound: 128, upperBound: 384, texture: WaypointTexture.Circle },
            { lowerBound: 384, texture: WaypointTexture.Square },
          ],
        },
        rgbOf(color),
      );
      player.locatorBar.addWaypoint(waypoint);
      this.entries.set(player.id, { waypoint, key });
    } catch {
      this.entries.delete(player.id);
    }
  }

  /** Removes one player's marker (a player walking away from their source). */
  clearFor(player) {
    const entry = this.entries.get(player.id);
    if (!entry) return;
    this.entries.delete(player.id);
    safe(() => entry.waypoint.remove());
  }

  /** Removes every marker, e.g. on world unload. */
  clear() {
    for (const entry of this.entries.values()) safe(() => entry.waypoint.remove());
    this.entries.clear();
  }

  /** Drops a marker without touching the locator bar of a player who left. */
  forget(playerId) {
    this.entries.delete(playerId);
  }
}

function rgbOf(hex) {
  const [red, green, blue] = parseHex(hex);
  return { red: red / 255, green: green / 255, blue: blue / 255 };
}

/** Chat + sound feedback shared by every entry point. */
export function feedback(player, source, reason) {
  if (get("tap_sound")) {
    safe(() =>
      player.playSound("random.orb", {
        location: { x: source.x + 0.5, y: source.y + 0.5, z: source.z + 0.5 },
        volume: 0.5,
        pitch: 1.6,
      }),
    );
  }

  if (!get("chat_feedback")) return;
  const offset = offsetFrom(player.location, {
    x: source.x + 0.5,
    y: source.y + 0.5,
    z: source.z + 0.5,
  });
  const distance = formatDecimal(straightLine(offset), 2);
  const label = reason ? `${reason} ` : "";
  safe(() =>
    player.sendMessage(
      `${colorize("#00E5FF", "StasisPivot")} ${colorize("#AAAAAA", label)}source ${colorize(
        "#FFD700",
        compactPivot(source),
      )} ${colorize("#AAAAAA", "S")} ${colorize("#FFAA00", distance)}`,
    ),
  );
}

function safe(callback) {
  try {
    return callback();
  } catch {
    return undefined;
  }
}
