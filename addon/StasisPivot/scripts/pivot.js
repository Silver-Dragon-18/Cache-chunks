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

/** Longest hold, in ticks, still counted as a tap. 20 ticks = 1 second. */
const TAP_TICKS = 12;

/** Blocks the player may drift while tapping before it is a drag. */
const TAP_DRIFT = 0.35;

/**
 * Degrees the camera may turn while tapping before it counts as a look.
 *
 * `onUse` cannot tell a tap from the touch that drags the camera, so the
 * gesture has to measure the look itself: this is the only check that
 * separates "poked the item" from "turned around while holding the item".
 */
const TAP_LOOK_DEGREES = 12;

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
    /** Active hold starts, keyed by player id. */
    /** @type {Map<string, {at:number, from:{x:number,y:number,z:number}, look?:{x:number,y:number}}>} */
    this.holds = new Map();
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

  /**
   * Drops a player who left the world.
   *
   * The stored copies stay, so the pivot is still there when they come back;
   * what must not stay is the in-memory entry, or a world that sees a stream of
   * visitors grows without bound and `save()` keeps re-publishing the pivots of
   * players who have gone.
   */
  forget(playerId) {
    this.sources.delete(playerId);
    this.holds.delete(playerId);
    this.save();
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

  /**
   * Publishes the live sources to the world copies.
   *
   * Clearing one player's source must also clear these, or the next `load()`
   * hands the pivot straight back: they are what a rejoin reads.
   */
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

  /** Clears this player's pivot, in memory and in every stored copy. */
  clear(player) {
    this.sources.delete(player.id);
    safe(() => player.setDynamicProperty(PLAYER_SOURCE, undefined));
    this.save();
    if (this.sources.size === 0) {
      // `save()` publishes the *live* sources; with none left there is nothing
      // to publish, so the world copies have to be forgotten explicitly.
      storeSourceMap({});
      storeSource(undefined);
    }
    if (this.hud) this.hud.clearOverlay();
    return true;
  }

  /**
   * Touch gesture, part one: `onUse` fires whenever the player uses the item,
   * including the touch that turns the camera, so nothing is decided here. The
   * position, the view and the tick are recorded and `endHold` judges them.
   *
   * The hold is timed here rather than from the release event's `useDuration`:
   * that field counts down how much of a charge is *left*, which is only
   * meaningful for chargeable items and is `0` for an ordinary one.
   */
  beginHold(player) {
    this.holds.set(player.id, {
      at: system.currentTick,
      from: { ...player.location },
      look: rotationOf(player),
    });
  }

  /**
   * Touch gesture, part two: answers whether the gesture was a tap.
   *
   * A tap is short, stays on the block it started on, and leaves the camera
   * alone. Dragging the screen to look around is a look, not a tap, which is
   * the "look, don't place" behaviour players expect from a pivot item.
   *
   * @param {import("@minecraft/server").Player} player
   * @param {{usedBlock?: boolean}} [gesture] what else the same gesture did
   * @returns {boolean}
   */
  endHold(player, gesture = {}) {
    const start = this.holds.get(player.id);
    this.holds.delete(player.id);
    if (!start) return false;
    if (gesture && gesture.usedBlock) return false;
    if (system.currentTick - start.at > TAP_TICKS) return false;
    const moved = Math.abs(player.location.x - start.from.x) > TAP_DRIFT;
    const sank = Math.abs(player.location.y - start.from.y) > TAP_DRIFT;
    const drifted = Math.abs(player.location.z - start.from.z) > TAP_DRIFT;
    if (moved || sank || drifted) return false;
    if (lookedAway(start.look, rotationOf(player))) return false;
    return true;
  }

  /** True while a player is holding the item. */
  isHolding(player) {
    return this.holds.has(player.id);
  }

  /** Entry point for the item, the keybind and the commands. */
  trigger(player, reason) {
    return this.placeAtPlayer(player, { reason, exact: false });
  }
}

/** The camera direction in degrees, or undefined where it cannot be read. */
function rotationOf(player) {
  try {
    const rotation = player.getRotation();
    return { x: rotation.x, y: rotation.y };
  } catch {
    // An entity that left the world, or a build without getRotation.
    return undefined;
  }
}

/**
 * Whether the camera turned more than a tap's worth between two samples.
 * A yaw of 359° and 1° are two degrees apart, not 358.
 */
function lookedAway(from, to) {
  if (!from || !to) return false;
  const pitch = Math.abs(to.x - from.x);
  const yaw = Math.abs(((to.y - from.y + 540) % 360) - 180);
  return pitch > TAP_LOOK_DEGREES || yaw > TAP_LOOK_DEGREES;
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
