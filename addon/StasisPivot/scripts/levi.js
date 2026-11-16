/**
 * StasisPivot - optional LeviLauncher bridge.
 *
 * Bedrock scripting cannot call libpreloader.so, so the panel is drawn through
 * the action bar by default. The native companion (`levipack/`) watches a small
 * mailbox in its own data directory:
 *
 *   overlay.json   {"version":1,"commands":[...]}   last frame, re-read every 40 ms
 *   clear          presence blanks the overlay
 *   trigger        presence means "the keybind was pressed"
 *
 * This module owns the script half of that mailbox: it serialises the layout to
 * commands, and drains the `trigger` flag so a hardware key places the source
 * exactly like a tap. Every function degrades to a no-op when the companion is
 * absent, so the pack behaves identically with or without it.
 *
 * Bedrock scripts cannot write files, so the mailbox is handed over through a
 * `globalThis` hook when one is available (and through `writeFile` when the
 * runtime exposes it); the renderer itself is registered by the companion.
 */

/** @typedef {{op:"rect"|"line"|"text", x:number, y:number, w?:number, h?:number, x3?:number, y3?:number, color:number, size?:number, text?:string}} OverlayCommand */

/** @typedef {(commands: OverlayCommand[]) => boolean} OverlayRenderer */

/** @typedef {{frame: (commands: OverlayCommand[]) => void, clear: () => void, consumeTrigger: () => boolean}} OverlayTransport */

import { toArgb } from "./colors.js";

/** The companion's mailbox file, relative to its data directory. */
export const MAILBOX = Object.freeze({
  frame: "overlay.json",
  clear: "clear",
  trigger: "trigger",
});

/** @type {OverlayTransport | null} */
let transport = null;

export const levi = {
  /** True once a transport or renderer is bound. */
  available: false,

  /**
   * "#RRGGBB" + alpha -> 0xAARRGGBB, the layout the HUD overlay expects.
   * @param {string} hex
   * @param {number} [alpha]
   */
  argb: toArgb,

  /**
   * Submit overlay draw commands.
   * @type {OverlayRenderer}
   */
  draw(commands) {
    if (!transport) return false;
    try {
      transport.frame(commands);
      return true;
    } catch {
      return false;
    }
  },

  /** Clear the overlay. */
  clear() {
    try {
      transport?.clear();
    } catch {
      // ignore
    }
  },
};

/**
 * True when the user pressed the companion's keybind since the last call.
 * Returns false (and stays cheap) when no companion is installed.
 */
export function pollTrigger() {
  if (!transport) return false;
  try {
    return transport.consumeTrigger();
  } catch {
    return false;
  }
}

/**
 * Binds a transport (or a bare renderer, for hosts that support one).
 * @param {OverlayTransport | OverlayRenderer} candidate
 */
export function bindOverlay(candidate) {
  if (typeof candidate === "function") {
    transport = {
      frame: (commands) => {
        candidate(commands);
      },
      clear: () => {
        candidate([]);
      },
      consumeTrigger: () => false,
    };
  } else if (candidate && typeof candidate.frame === "function") {
    transport = candidate;
  } else {
    return false;
  }
  levi.available = true;
  return true;
}

/** Detach the transport (used by tests and by menu toggles). */
export function unbindOverlay() {
  transport = null;
  levi.available = false;
}

try {
  // The companion (or a host shell) can hand over its transport here, and gets
  // the serialised frame back through the same object.
  globalThis.StasisPivotBindOverlay = bindOverlay;
} catch {
  // Some builds freeze the global object; the pack still works without it.
}
