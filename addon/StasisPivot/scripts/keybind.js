/**
 * StasisPivot - optional keybind for clients without the native companion.
 *
 * Bedrock scripting exposes exactly two input buttons (`InputButton.Jump` and
 * `InputButton.Sneak`) through `world.afterEvents.playerButtonInput`. That is
 * not a general keybinding API, but it is a real key/button on every platform:
 *
 *   - Jump  -> tap the jump button/key (the natural "poke the pivot" gesture)
 *   - Sneak -> shift on a keyboard
 *
 * The gesture is deliberately strict so it never fires while playing normally:
 * the button must be pressed **and released** within `TAP_MS`, and the player
 * must not have moved while holding it. Walking (which presses Jump), sprinting
 * or crouch-walking therefore cancel the gesture instead of placing a pivot.
 *
 * With the native companion installed, `levi.js`'s keybind can additionally
 * fire `pollTrigger()`; both paths funnel into `PivotManager.trigger`.
 */

import { world } from "@minecraft/server";
import { get } from "./settings.js";

const TAP_MS = 600;
const MOVE_TOLERANCE = 0.35;

/** @typedef {"Jump"|"Sneak"} BindButton */

/**
 * @param {import("@minecraft/server").Player} player
 */
function positionOf(player) {
  try {
    const { x, y, z } = player.location;
    return { x, y, z };
  } catch {
    return undefined;
  }
}

function movedTooFar(from, to) {
  if (!from || !to) return false;
  return (
    Math.abs(from.x - to.x) > MOVE_TOLERANCE ||
    Math.abs(from.y - to.y) > MOVE_TOLERANCE ||
    Math.abs(from.z - to.z) > MOVE_TOLERANCE
  );
}

/**
 * Installs the button listeners. Call once, from main.js: the setting is read
 * per event, so enabling the bind later takes effect without a reload.
 */
export function installKeybind(pivots) {
  /** @type {Map<string, {at: number, from: {x:number,y:number,z:number}|undefined, button: string}>} */
  const pending = new Map();

  try {
    world.afterEvents.playerButtonInput.subscribe((event) => {
      if (!get("enabled") || !get("keybind_enabled")) {
        pending.clear();
        return;
      }

      const player = event.player;
      const button = event.button;
      if (!matchesBind(button)) return;

      const now = Date.now();
      if (event.newButtonState === "Pressed") {
        pending.set(player.id, { at: now, from: positionOf(player), button });
        return;
      }

      const start = pending.get(player.id);
      pending.delete(player.id);
      if (!start || start.button !== button) return;
      if (now - start.at > TAP_MS) return;
      if (movedTooFar(start.from, positionOf(player))) {
        // A held-and-walked button is ordinary movement, not a pivot request.
        if (get("chat_feedback")) {
          try {
            player.onScreenDisplay.setActionBar("§7StasisPivot: hold still to place.");
          } catch {
            // ignore
          }
        }
        return;
      }

      try {
        pivots.trigger(player, "keybind");
      } catch {
        // A failed trigger must never break the input pipeline.
      }
    });
  } catch {
    // Older builds without playerButtonInput: the item and commands still work.
  }
}

/**
 * @param {string} button
 */
function matchesBind(button) {
  const bind = get("keybind_button");
  if (bind === "Jump") return button === "Jump";
  if (bind === "Sneak") return button === "Sneak";
  return false;
}
