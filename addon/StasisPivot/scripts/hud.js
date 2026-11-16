/**
 * StasisPivot - panel controller.
 *
 * Renders the panel built by layout.js through two transports:
 *   - the action bar (always available);
 *   - the Levi HUD overlay, when a native companion mod binds a renderer
 *     through scripts/levi.js.
 */

import { world } from "@minecraft/server";
import { get } from "./settings.js";
import { buildLayout, hudSettings, toActionBar, toOverlayCommands } from "./layout.js";
import { levi } from "./levi.js";

/** Drives both renderers from the main loop. */
export class HudController {
  /** @param {(player: import("@minecraft/server").Player) => ({x:number,y:number,z:number,dimension:string}|undefined)} getSource */
  constructor(getSource) {
    this.getSource = getSource;
    this.lastActionBarTick = -100;
    this.lastSignature = "";
    this.overlayActive = false;
    this.overlayOwner = "";
    this.overlayCommands = [];
  }

  tick(tick) {
    const players = safePlayers();
    if (players.length === 0) {
      if (this.overlayActive) this.clearOverlay();
      return;
    }

    const cfg = hudSettings(get);
    const enabled = get("enabled") && get("hud_enabled");

    // --- action bar ------------------------------------------------------
    if (!enabled || !cfg.hud_actionbar) {
      this.lastSignature = "";
    } else if (tick - this.lastActionBarTick >= 4) {
      this.lastActionBarTick = tick;
      const parts = [];
      for (const player of players) {
        const source = this.getSource(player);
        if (!source) continue;
        const layout = buildLayout({ source, playerLocation: player.location, settings: cfg });
        if (!layout.visible) {
          safe(() => player.onScreenDisplay.setActionBar(" "));
          continue;
        }
        const text = toActionBar(layout, cfg);
        parts.push(`${player.id}|${text}`);
        if (!cfg.hud_actionbar_stacked && this.lastSignature === `${player.id}|${text}`) continue;
        safe(() => player.onScreenDisplay.setActionBar(text));
      }
      this.lastSignature = parts.length === 1 ? parts[0] : "";
    }

    // --- native overlay --------------------------------------------------
    if (!enabled || !levi.available) {
      if (this.overlayActive) this.clearOverlay();
      return;
    }

    // The HUD overlay is a single device-local surface, so it follows one
    // player. On a phone (the LeviLauncher case) that is the only player; on a
    // world with several, showing someone else's coordinates would be worse
    // than showing nothing, so the frame is only drawn for the first player and
    // cleared otherwise.
    const owner = players[0];
    const source = owner ? this.getSource(owner) : undefined;
    if (!owner || !source) {
      if (this.overlayActive) this.clearOverlay();
      return;
    }

    const layout = buildLayout({ source, playerLocation: owner.location, settings: cfg });
    if (!layout.visible) {
      if (this.overlayActive) this.clearOverlay();
      return;
    }

    const commands = toOverlayCommands(layout, cfg);
    // Only push when something actually changed: the overlay bridge diffs the
    // list, but skipping the call keeps the per-tick cost near zero.
    if (this.overlayActive && this.overlayOwner === owner.id && sameCommands(this.overlayCommands, commands)) {
      return;
    }
    this.overlayActive = levi.draw(commands) === true;
    this.overlayOwner = owner.id;
    this.overlayCommands = commands;
  }

  clearOverlay() {
    this.overlayActive = false;
    this.overlayOwner = "";
    this.overlayCommands = [];
    levi.clear();
  }
}

function sameCommands(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.op !== b.op || a.x !== b.x || a.y !== b.y || a.color !== b.color || a.text !== b.text) {
      return false;
    }
  }
  return true;
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
    callback();
  } catch {
    // The player may have left between the snapshot and the write.
  }
}
