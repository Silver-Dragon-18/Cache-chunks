/**
 * StasisPivot - in-game menu.
 *
 * Every setting from config.js is editable here, in the same tree the
 * LeviLauncher Mod Menu shows for this mod, so a player can configure it
 * without leaving the game.
 */

import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { MENU, PALETTE } from "./config.js";
import { get, set, resetAll, limitsFor } from "./settings.js";
import { compactPivot, formatDecimal, offsetFrom, straightLine } from "./geom.js";
import { colorize } from "./colors.js";

const ICONS = {
  mod: "textures/ui/settings_glyph_color_2x",
  hud: "textures/ui/achievements",
  colors: "textures/ui/color_picker",
  world: "textures/ui/dressing_room_customization",
  keybind: "textures/ui/keyboard",
};

function onOff(value) {
  return value ? "§aON" : "§cOFF";
}

function formatValue(entry) {
  const value = get(entry.key);
  if (typeof value === "boolean") return onOff(value);
  if (entry.key === "keybind_keycode") return value ? `§e${value}` : "§7none";
  if (entry.type === "choice") {
    const match = (entry.choices ?? []).find((choice) => choice.value === value);
    return `§e${match ? match.label : value}`;
  }
  if (typeof value === "number") {
    const digits = Number.isInteger(entry.step ?? 1) ? 0 : 2;
    return `§e${value.toFixed(digits)}${entry.unit ? ` ${entry.unit}` : ""}`;
  }
  if (typeof value === "string" && value.startsWith("#")) {
    return `${colorize(value, "██████")} §8${value}`;
  }
  return `§e${value}`;
}

export async function openMainMenu(player, pivots) {
  const form = new ActionFormData().title("§bStasis Pivot§r §8settings");
  const source = pivots.getActive(player);

  if (source) {
    const offset = offsetFrom(player.location, {
      x: source.x + 0.5,
      y: source.y + 0.5,
      z: source.z + 0.5,
    });
    form.body(
      `§7Source §f${compactPivot(source)}§7 in §f${source.dimension.replace("minecraft:", "")}\n` +
        `§7Distance §f${formatDecimal(straightLine(offset), 2)}`,
    );
  } else {
    form.body("§7No source yet. Tap the pivot item, press the keybind, or use §f/stasispivot set§7.");
  }

  const actions = [];
  for (const category of MENU) {
    form.button(`§f${category.title}\n§8${category.description}`, ICONS[category.id]);
    actions.push(() => openCategory(player, pivots, category.id));
  }

  form.divider();
  form.button("§eSet source here\n§8Block below your feet", "textures/items/compass_item");
  actions.push(() => {
    pivots.placeAtPlayer(player);
  });

  form.button("§cReset source\n§8Forget the source block", "textures/ui/trash");
  actions.push(() => {
    pivots.clear(player);
    safe(() => player.sendMessage("§7StasisPivot source cleared."));
  });

  form.button("§cReset all settings", "textures/ui/refresh");
  actions.push(() => {
    resetAll();
    safe(() => player.sendMessage("§7StasisPivot settings restored to defaults."));
  });

  const selection = await show(player, form);
  if (selection === undefined) return;
  const action = actions[selection];
  if (action) await action();
}

async function openCategory(player, pivots, categoryId) {
  const category = MENU.find((item) => item.id === categoryId);
  if (!category) return openMainMenu(player, pivots);

  const form = new ActionFormData().title(`§b${category.title}`).body(`§7${category.description}`);
  const actions = [];

  for (const entry of category.entries) {
    if (entry.type === "text") {
      form.button(`§7${entry.title}\n§8${entry.description}`, "textures/ui/infobulb");
      actions.push(() => openCategory(player, pivots, categoryId));
      continue;
    }
    form.button(`§f${entry.title}\n${formatValue(entry)}`);
    actions.push(() => openEntry(player, pivots, categoryId, entry));
  }

  form.divider();
  form.button("§7Back", "textures/ui/arrow_left");
  actions.push(() => openMainMenu(player, pivots));

  const selection = await show(player, form);
  if (selection === undefined) return;
  const action = actions[selection];
  if (action) await action();
}

async function openEntry(player, pivots, categoryId, entry) {
  if (entry.type === "toggle") {
    set(entry.key, !get(entry.key));
    return openCategory(player, pivots, categoryId);
  }
  if (entry.type === "color") {
    return openColor(player, pivots, categoryId, entry);
  }
  if (entry.type === "choice") {
    // Action forms have no dropdown: tapping the row cycles through the values,
    // which keeps the menu usable on touch without a second screen.
    const choices = entry.choices ?? [];
    if (choices.length === 0) return openCategory(player, pivots, categoryId);
    const index = Math.max(0, choices.findIndex((choice) => choice.value === get(entry.key)));
    set(entry.key, choices[(index + 1) % choices.length].value);
    return openCategory(player, pivots, categoryId);
  }

  const limits = limitsFor(entry.key);
  const form = new ModalFormData().title(`§b${entry.title}`);
  if (typeof get(entry.key) === "number") {
    form.slider(`${entry.title}\n§8${entry.description}`, limits.min, limits.max, {
      valueStep: limits.step ?? 1,
      defaultValue: get(entry.key),
    });
  } else {
    form.textField(`${entry.title}\n§8${entry.description}`, "value", {
      defaultValue: String(get(entry.key)),
    });
  }
  form.submitButton("§aApply");

  const values = await show(player, form);
  if (!Array.isArray(values)) return openCategory(player, pivots, categoryId);
  set(entry.key, values[0]);
  return openCategory(player, pivots, categoryId);
}

async function openColor(player, pivots, categoryId, entry) {
  const current = get(entry.key);
  const form = new ActionFormData()
    .title(`§b${entry.title}`)
    .body(`§7Current ${colorize(current, "██████")} §f${current}\n§8${entry.description}`);

  const actions = [];
  form.button("§fEnter hex…\n§8#RRGGBB", "textures/ui/color_picker");
  actions.push(async () => {
    const modal = new ModalFormData()
      .title("§bHex colour")
      .textField("§f#RRGGBB", "#FFFFFF", { defaultValue: current })
      .submitButton("§aApply");
    const values = await show(player, modal);
    if (Array.isArray(values) && typeof values[0] === "string") set(entry.key, values[0]);
    return openCategory(player, pivots, categoryId);
  });

  for (const swatch of PALETTE) {
    form.button(`${colorize(swatch.hex, "██████")} §f${swatch.name}`);
    actions.push(() => {
      set(entry.key, swatch.hex);
      return openCategory(player, pivots, categoryId);
    });
  }

  form.divider();
  form.button("§7Back", "textures/ui/arrow_left");
  actions.push(() => openCategory(player, pivots, categoryId));

  const selection = await show(player, form);
  if (selection === undefined) return;
  const action = actions[selection];
  if (action) await action();
}

/**
 * Form wrapper: Form UI can fail while the player is loading, dead or has
 * another screen open, so it retries briefly before giving up.
 */
async function show(player, form) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await form.show(player);
      if (response.canceled) return undefined;
      return "formValues" in response && response.formValues !== undefined
        ? response.formValues
        : response.selection;
    } catch {
      await sleep(60);
    }
  }
  return undefined;
}

/** Small delay between Form UI retries; the engine backs this with setTimeout. */
function sleep(ticks) {
  // @ts-ignore -- host timer, not part of the TypeScript lib for scripts
  const timer = typeof setTimeout === "function" ? setTimeout : undefined;
  if (!timer) return Promise.resolve();
  return new Promise((resolve) => timer(resolve, ticks * 50));
}

function safe(callback) {
  try {
    callback();
  } catch {
    // ignore
  }
}
