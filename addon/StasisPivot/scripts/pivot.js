/**
 * StasisPivot - the source ("pivot") lifecycle.
 *
 * The pivot is virtual: no block is ever edited, so a world can never collect
 * stray blocks and nothing is lost on a crash. It is mirrored by particles, a
 * locator waypoint and the coordinate panel.
 *
 * Input paths, all funnelling into `place()`:
 *   - the pivot item (mirrors the Levi keybind on touch devices);
 *   - `/stasispivot set` and the script custom command `stasispivot:set`;
 *   - the Levi Mod Menu keybind, forwarded by the native companion mod.
 */

import { world, system } from "@minecraft/server";
import { get } from "./settings.js";
import {
  storedSource,
  storeSource,
  storedSourceMap,
  storeSourceMap,
} from "./settings.js";
import { blockBelow, blockAt } from "./geom.js";
import { feedback, burst } from "./markers.js";

/** Ticks within which an onUse must be followed by its onCompleteUse. */
const TAP_WINDOW_TICKS = 20;

const PLAYER_SOURCE = "stasispivot:p_source";

function normalize(source) {
  return {
    x: Math.floor(source.x),
    y: Math.floor(source.y),
    z: Math.floor(source.z),
    dimension: source.dimension ?? "minecraft:overworld",
  };
}

export class PivotManager {
  constructor() {
    /** @type {Map<string, {x:number,y:number,z:number,dimension:string}>} */
    this.sources = new Map();
    /** @type {Map<string, {armedAt:number}>} */
    this.taps = new Map();
    this.hud = undefined;
  }

  attachHud(hud) {
    this.hud = hud;
  }

  /**
   * Restores the source for the players currently online.
   *
   * Precedence: the player's own saved pivot (survives restarts) wins, then the
   * world-level copy, which is what a freshly installed pack sees so a pivot
   * made in the previous session is not lost.
   */
  load() {
    const worldCopy = storedSource();
    const perDimension = storedSourceMap();

    for (const player of safePlayers()) {
      const own = readPlayerSource(player);
      const dimensionId = player.dimension.id;
      const shared = get("remember_dimension")
        ? perDimension[dimensionId] ?? worldCopy
        : worldCopy ?? perDimension[dimensionId];
      const source = own ?? shared;
      if (source) {
        this.sources.set(
          player.id,
          normalize({ ...source, dimension: source.dimension ?? dimensionId }),
        );
      }
    }
  }

  /**
   * The source for this player in the dimension they are standing in. Each
   * dimension keeps its own pivot when "Per-dimension source" is on, which is
   * what the panel and the waypoint read every tick.
   */
  getActive(player) {
    const own = this.sources.get(player.id);
    const dimensionId = player.dimension.id;
    if (own && own.dimension === dimensionId) return own;
    const perDimension = storedSourceMap()[dimensionId];
    if (get("remember_dimension") && perDimension) return normalize(perDimension);
    return own;
  }

  /** Sets a player's source from a stored value (world load, respawn, reload). */
  restore(player) {
    if (this.sources.has(player.id)) return this.sources.get(player.id);
    const shared = get("remember_dimension")
      ? storedSourceMap()[player.dimension.id] ?? storedSource()
      : storedSource();
    if (!shared) return undefined;
    const source = normalize({ ...shared, dimension: player.dimension.id });
    this.sources.set(player.id, source);
    return source;
  }

  save() {
    const map = {};
    let first;
    for (const source of this.sources.values()) {
      map[source.dimension] = source;
      if (!first) first = source;
    }
    storeSourceMap(map);
    storeSource(first);
  }

  /** Source for this player, or undefined. */
  get(player) {
    return this.sources.get(player.id);
  }


  /**
   * Places or moves the pivot.
   * @param {import("@minecraft/server").Player} player
   * @param {{x:number,y:number,z:number}} location
   * @param {{force?:boolean,forceMove?:boolean,exact?:boolean,silent?:boolean,reason?:string}} options
   */
  place(player, location, options = {}) {
    if (!get("enabled")) {
      if (!options.silent) {
        safe(() =>
          player.sendMessage("§7StasisPivot is off: turn it on in the Levi Mod Menu."),
        );
      }
      return undefined;
    }

    const existing = this.get(player);
    if (existing && !get("pivot_on_every_tap") && !options.force && !options.forceMove) {
      if (!options.silent) {
        safe(() =>
          player.sendMessage(
            "§bStasisPivot§r source already set. Enable §ePlace on every tap§r, or use §fReset source§r first.",
          ),
        );
      }
      return existing;
    }

    const where =
      get("auto_snap") && !options.exact ? blockBelow(location) : blockAt(location);
    const source = normalize({ ...where, dimension: player.dimension.id });

    this.sources.set(player.id, source);
    writePlayerSource(player, source);
    this.save();

    if (!options.silent) {
      burst(player, source);
      feedback(player, source, options.reason ?? (existing ? "Moved" : "Set"));
      if (this.hud) this.hud.lastSignature = "";
    }
    return source;
  }

  /**
   * Places the pivot at the player's own block. A tap or key press always
   * moves the pivot, which is the behaviour the tap gesture promises.
   */
  placeAtPlayer(player, options = {}) {
    return this.place(player, player.location, { ...options, forceMove: true });
  }

  /** Clears this player's pivot. */
  clear(player) {
    this.sources.delete(player.id);
    safe(() => player.setDynamicProperty(PLAYER_SOURCE, undefined));
    this.save();
    if (this.hud) this.hud.clearOverlay();
    return true;
  }

  /**
   * Touch gesture: fired on release of the pivot item so dragging the camera
   * does not move the source. The engine does not expose touch deltas, so the
   * gesture is accepted when the item's use completed, which only happens when
   * the tap was not consumed by the look controls.
   */
  markTap(player) {
    this.taps.set(player.id, { armedAt: system.currentTick });
  }

  /**
   * True when `markTap` armed a tap recently enough to explain a completed use.
   * A stale arm (a use that never completed, or a tap that fell through) must
   * not swallow a later gesture, so the window is short — the same order as one
   * press of the pivot item.
   */
  consumeTap(player) {
    const armed = this.taps.get(player.id);
    if (!armed) return false;
    this.taps.delete(player.id);
    return system.currentTick - armed.armedAt <= TAP_WINDOW_TICKS;
  }

  /** Entry point for the item, the keybind and the commands. */
  trigger(player, reason) {
    return this.placeAtPlayer(player, { reason, exact: false });
  }
}

function readPlayerSource(player) {
  try {
    const raw = player.getDynamicProperty(PLAYER_SOURCE);
    if (typeof raw === "string" && raw.length) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        Number.isFinite(parsed.x) &&
        Number.isFinite(parsed.y) &&
        Number.isFinite(parsed.z)
      ) {
        return parsed;
      }
    }
  } catch {
    // Malformed value: treat as unset.
  }
  return undefined;
}

function writePlayerSource(player, source) {
  if (!get("persist_source")) return;
  try {
    player.setDynamicProperty(PLAYER_SOURCE, JSON.stringify(source));
  } catch {
    // ignore
  }
}

function safePlayers() {
  try {
    return world.getAllPlayers();
  } catch {
    return [];
  }
}

function safe(callback) {
  try {
    return callback();
  } catch {
    return undefined;
  }
}
