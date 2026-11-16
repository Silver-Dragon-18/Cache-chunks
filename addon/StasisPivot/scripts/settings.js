/**
 * StasisPivot - settings and source persistence.
 *
 * Settings live in world dynamic properties (so they travel with the world and
 * survive reloads) and are mirrored in memory for cheap per-tick reads. Every
 * value is validated on load because the LeviLauncher Mod Menu can write raw
 * strings into the same storage.
 */

import { world } from "@minecraft/server";
import {
  DEFAULTS,
  COLOR_KEYS,
  NUMBER_LIMITS,
  WAYPOINT_TEXTURES,
  menuEntry,
} from "./config.js";

const SETTINGS_KEY = "stasispivot:settings";
const SOURCE_KEY = "stasispivot:source";
const SOURCE_MAP_KEY = "stasispivot:sources";
const STATE_KEY = "stasispivot:state";

/** @type {Record<string, any>} */
let cache = { ...DEFAULTS };
let loaded = false;
const listeners = new Set();

export function isColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeColor(value, fallback) {
  if (isColor(value)) return value.toUpperCase();
  // Accept "0xAARRGGBB" / "AARRGGBB" / "RRGGBB" so Levi color controls round-trip.
  if (typeof value === "string") {
    const hex = value.trim().replace(/^0x/i, "");
    if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(2).toUpperCase()}`;
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const rgb = (value >>> 0) & 0xffffff;
    return `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`;
  }
  return fallback;
}

export function clampNumber(key, value, fallback) {
  const limits = NUMBER_LIMITS[key];
  let number = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  if (limits) {
    number = Math.min(limits.max, Math.max(limits.min, number));
  }
  return number;
}

function coerce(key, value, fallback) {
  if (COLOR_KEYS.includes(key)) return normalizeColor(value, fallback);
  if (key === "waypoint_texture") {
    const match = WAYPOINT_TEXTURES.find((texture) => texture.value === value);
    return match ? match.value : fallback;
  }
  if (typeof fallback === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (["true", "1", "on", "yes"].includes(lowered)) return true;
      if (["false", "0", "off", "no"].includes(lowered)) return false;
    }
    if (typeof value === "number") return value !== 0;
    return fallback;
  }
  if (typeof fallback === "number") {
    const number = clampNumber(key, value, fallback);
    if (key === "keybind_keycode") return Math.round(number);
    return number;
  }
  if (typeof fallback === "string") return typeof value === "string" ? value : fallback;
  return fallback;
}

export function loadSettings() {
  let stored = {};
  try {
    const raw = world.getDynamicProperty(SETTINGS_KEY);
    if (typeof raw === "string" && raw.length) {
      stored = JSON.parse(raw);
    } else if (raw && typeof raw === "object") {
      stored = raw;
    }
  } catch {
    stored = {};
  }

  const next = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (stored && Object.prototype.hasOwnProperty.call(stored, key)) {
      next[key] = coerce(key, stored[key], DEFAULTS[key]);
    }
  }
  cache = next;
  loaded = true;
  return cache;
}

export function settings() {
  if (!loaded) loadSettings();
  return cache;
}

export function get(key) {
  return settings()[key];
}

export function saveSettings() {
  try {
    world.setDynamicProperty(SETTINGS_KEY, JSON.stringify(cache));
  } catch {
    // A full dynamic property store is not fatal: keep the in-memory values.
  }
}

/**
 * Writes one setting. Returns true when the value actually changed so callers
 * can decide whether a redraw is needed.
 */
export function set(key, value, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return false;
  const before = cache[key];
  const after = coerce(key, value, DEFAULTS[key]);
  if (before === after) return false;
  cache[key] = after;
  if (options.persist !== false) saveSettings();
  for (const listener of listeners) {
    try {
      listener(key, after, before);
    } catch {
      // A broken listener must not stop the others.
    }
  }
  return true;
}

export function resetAll() {
  cache = { ...DEFAULTS };
  saveSettings();
  return cache;
}

export function onSettingsChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Source block persistence
// ---------------------------------------------------------------------------

/** @returns {{x:number,y:number,z:number,dimension:string}|undefined} */
export function storedSource() {
  try {
    const raw = world.getDynamicProperty(SOURCE_KEY);
    if (typeof raw === "string" && raw.length) {
      const parsed = JSON.parse(raw);
      if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y) && Number.isFinite(parsed.z)) {
        return {
          x: parsed.x,
          y: parsed.y,
          z: parsed.z,
          dimension: typeof parsed.dimension === "string" ? parsed.dimension : "minecraft:overworld",
        };
      }
    }
  } catch {
    // Corrupt value: fall through and treat as no source.
  }
  return undefined;
}

export function storeSource(source) {
  if (!source) {
    try {
      world.setDynamicProperty(SOURCE_KEY, undefined);
    } catch {
      // ignore
    }
    return;
  }
  try {
    world.setDynamicProperty(
      SOURCE_KEY,
      JSON.stringify({
        x: Math.floor(source.x),
        y: Math.floor(source.y),
        z: Math.floor(source.z),
        dimension: source.dimension,
      }),
    );
  } catch {
    // ignore
  }
}

export function storedSourceMap() {
  try {
    const raw = world.getDynamicProperty(SOURCE_MAP_KEY);
    if (typeof raw === "string" && raw.length) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

export function storeSourceMap(map) {
  try {
    world.setDynamicProperty(SOURCE_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function storedState() {
  try {
    const raw = world.getDynamicProperty(STATE_KEY);
    if (typeof raw === "string" && raw.length) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

export function storeState(state) {
  try {
    world.setDynamicProperty(STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

/** Handy for menus: the number control bounds of one key. */
export function limitsFor(key) {
  const entry = menuEntry(key);
  if (!entry) return NUMBER_LIMITS[key] ?? { min: 0, max: 1 };
  return { min: entry.min ?? 0, max: entry.max ?? 1, step: entry.step ?? 1 };
}
