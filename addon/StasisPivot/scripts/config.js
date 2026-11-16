/**
 * StasisPivot - configuration schema and defaults.
 *
 * This file is the single source of truth for every setting. The same key
 * names are used by the in-game UI, the LeviLauncher Mod Menu schema and the
 * player's saved dynamic properties, so a value set in one place is visible
 * in the others.
 */

// Human readable in-game name of the item that mirrors the Levi on-screen
// keybind. Keep in sync with addon/StasisPivot/items/stasis_pivot.json.
export const ITEM_ID = "stasispivot:pivot";

/** Every manageable setting, its type and default. */
export const DEFAULTS = Object.freeze({
  enabled: true,

  // Pivot / source block behaviour
  persist_source: true, // remember the source across deaths, reloads and dimension changes
  auto_snap: true, // snap a tapped pivot to the block below the player
  pivot_on_every_tap: false, // move the pivot on every tap instead of only when unset
  remember_dimension: true, // keep a separate pivot per dimension

  // On-screen coordinate panel
  hud_enabled: true,
  hud_always: true, // show the panel even when the pivot is far away
  hud_max_distance: 256,
  hud_scale: 1.0,
  hud_offset_x: 6.0,
  hud_offset_y: 6.0,
  hud_show_delta: true,
  hud_show_distance: true,
  hud_show_header: true,
  hud_actionbar: true, // vanilla action-bar fallback (also the outline-free fallback)
  hud_actionbar_stacked: false, // one line vs three stacked lines

  // Colours, stored as #RRGGBB so Mod Menu colour pickers and the in-game
  // dialog can both edit them.
  hud_color_x: "#55FFFF",
  hud_color_y: "#55FF55",
  hud_color_z: "#FF5555",
  hud_color_s: "#FFAA00",
  hud_color_delta: "#AAAAAA",
  hud_color_text: "#FFFFFF",
  hud_color_header: "#FFD700",
  hud_bg_color: "#101418",
  hud_bg_alpha: 0.62,
  hud_outline_color: "#FFFFFF",
  hud_outline_alpha: 1.0,
  hud_outline_width: 2.0,
  hud_corner_radius: 3.0,

  // World markers
  beam_enabled: true, // particle column above + below the source block
  waypoint_enabled: true, // locator bar marker on the source block
  waypoint_color: "#00E5FF",
  waypoint_texture: "minecraft:small_star",
  chat_feedback: true,
  tap_sound: true,

  // Optional keybind. Two independent paths:
  //   - the script-level button bind below, available on every client;
  //   - the Levi Mod Menu `Keybind` control (keybind_keycode), forwarded by the
  //     native companion when one is installed.
  keybind_enabled: false,
  keybind_button: "Sneak",
  keybind_keycode: 0,
});

/** Colour keys, grouped so the menu and Mod Menu schema stay in sync. */
export const COLOR_GROUPS = Object.freeze({
  x: "hud_color_x",
  y: "hud_color_y",
  z: "hud_color_z",
  s: "hud_color_s",
  delta: "hud_color_delta",
  text: "hud_color_text",
  header: "hud_color_header",
  bg: "hud_bg_color",
  outline: "hud_outline_color",
});

export const PALETTE = Object.freeze([
  { hex: "#FFFFFF", name: "White" },
  { hex: "#AAAAAA", name: "Gray" },
  { hex: "#555555", name: "Dark Gray" },
  { hex: "#000000", name: "Black" },
  { hex: "#55FFFF", name: "Aqua" },
  { hex: "#00AAAA", name: "Dark Aqua" },
  { hex: "#55FF55", name: "Green" },
  { hex: "#00AA00", name: "Dark Green" },
  { hex: "#FF5555", name: "Red" },
  { hex: "#AA0000", name: "Dark Red" },
  { hex: "#FFAA00", name: "Gold" },
  { hex: "#FF55FF", name: "Light Purple" },
  { hex: "#AA00AA", name: "Purple" },
  { hex: "#FFFF55", name: "Yellow" },
  { hex: "#00E5FF", name: "Cyan" },
  { hex: "#FF8C1A", name: "Orange" },
  { hex: "#7CFC00", name: "Lime" },
  { hex: "#1E90FF", name: "Dodger Blue" },
  { hex: "#FF69B4", name: "Hot Pink" },
  { hex: "#8A2BE2", name: "Blue Violet" },
]);

export const WAYPOINT_TEXTURES = Object.freeze([
  { value: "minecraft:small_star", name: "Small Star" },
  { value: "minecraft:small_square", name: "Small Square" },
  { value: "minecraft:square", name: "Square" },
  { value: "minecraft:circle", name: "Circle" },
]);

/** Keys whose value is a colour, for quick validation. */
export const COLOR_KEYS = Object.freeze([
  ...Object.values(COLOR_GROUPS),
  "waypoint_color",
]);

export const NUMBER_LIMITS = Object.freeze({
  hud_max_distance: { min: 16, max: 20000 },
  hud_scale: { min: 0.5, max: 2.5 },
  hud_offset_x: { min: 0, max: 400 },
  hud_offset_y: { min: 0, max: 400 },
  hud_bg_alpha: { min: 0, max: 1 },
  hud_outline_alpha: { min: 0, max: 1 },
  hud_outline_width: { min: 0, max: 8 },
  hud_corner_radius: { min: 0, max: 16 },
  keybind_keycode: { min: 0, max: 1000 },
});

/** Buttons Bedrock scripting can observe (InputButton members). */
export const KEYBIND_BUTTONS = Object.freeze([
  { value: "Sneak", name: "Sneak / Shift" },
  { value: "Jump", name: "Jump" },
]);

/**
 * The same menu tree is rendered in game (ActionFormData) and dumped as a
 * LeviLauncher Mod Menu v2 schema. Entries are either
 *   { type: "toggle" | "slider" | "color" | "action", ... } or
 *   { type: "text" } for a read-only informational row.
 */
export const MENU = Object.freeze([
  {
    id: "mod",
    title: "Mod",
    description: "Master switch and core behaviour",
    entries: [
      { type: "toggle", key: "enabled", title: "Enable StasisPivot", description: "Master switch. When off nothing is placed or drawn." },
      { type: "toggle", key: "persist_source", title: "Persist source", description: "Remember the source block across deaths, reloads and dimension changes." },
      { type: "toggle", key: "auto_snap", title: "Snap to block below", description: "On place, snap the source to the block you are standing on." },
      { type: "toggle", key: "pivot_on_every_tap", title: "Place on every tap", description: "Move the source on every tap instead of only when it is unset." },
      { type: "toggle", key: "remember_dimension", title: "Per-dimension source", description: "Keep a separate source block for every dimension." },
      { type: "text", title: "Tap input", description: "The pivot item mirrors the Levi keybind: press and release in the world without moving the camera." },
    ],
  },
  {
    id: "hud",
    title: "Coordinates UI",
    description: "Custom coordinate panel",
    entries: [
      { type: "toggle", key: "hud_enabled", title: "Show coordinate panel", description: "Draw the outlined X Y Z S panel." },
      { type: "toggle", key: "hud_always", title: "Always show", description: "Draw the panel even when the source block is far away." },
      { type: "slider", key: "hud_max_distance", title: "Max draw distance", description: "Hide the panel beyond this distance.", min: 16, max: 20000, step: 16, unit: "m" },
      { type: "slider", key: "hud_scale", title: "Scale", description: "Panel text and box scale.", min: 0.5, max: 2.5, step: 0.05 },
      { type: "slider", key: "hud_offset_x", title: "Offset X", description: "Horizontal anchor in screen pixels.", min: 0, max: 400, step: 1, unit: "px" },
      { type: "slider", key: "hud_offset_y", title: "Offset Y", description: "Vertical anchor in screen pixels.", min: 0, max: 400, step: 1, unit: "px" },
      { type: "toggle", key: "hud_show_header", title: "Show header", description: "Shows the STASIS PIVOT caption." },
      { type: "toggle", key: "hud_show_distance", title: "Show straight-line S", description: "S is the straight-line distance to the source." },
      { type: "toggle", key: "hud_show_delta", title: "Show +/- offset", description: "Third line with signed X Y Z offset from the source." },
      { type: "slider", key: "hud_outline_width", title: "Outline width", description: "Thickness of the rounded outline.", min: 0, max: 8, step: 0.5, unit: "px" },
      { type: "slider", key: "hud_corner_radius", title: "Corner radius", description: "Corner rounding of the outline.", min: 0, max: 16, step: 1, unit: "px" },
      { type: "toggle", key: "hud_actionbar", title: "Action-bar fallback", description: "Also print the panel through the vanilla action bar." },
      { type: "toggle", key: "hud_actionbar_stacked", title: "Stacked fallback", description: "Print the fallback as three lines instead of one." },
    ],
  },
  {
    id: "colors",
    title: "Colors",
    description: "Outline and label colours",
    entries: [
      { type: "color", key: "hud_outline_color", title: "Outline color", description: "Colour of the panel border." },
      { type: "slider", key: "hud_outline_alpha", title: "Outline alpha", description: "Outline transparency.", min: 0, max: 1, step: 0.05 },
      { type: "color", key: "hud_bg_color", title: "Background color", description: "Colour of the panel background." },
      { type: "slider", key: "hud_bg_alpha", title: "Background alpha", description: "Background transparency.", min: 0, max: 1, step: 0.05 },
      { type: "color", key: "hud_color_x", title: "X label color", description: "Colour of the X value." },
      { type: "color", key: "hud_color_y", title: "Y label color", description: "Colour of the Y value." },
      { type: "color", key: "hud_color_z", title: "Z label color", description: "Colour of the Z value." },
      { type: "color", key: "hud_color_s", title: "S label color", description: "Colour of the S distance value." },
      { type: "color", key: "hud_color_delta", title: "Offset color", description: "Colour of the +/- offset line." },
      { type: "color", key: "hud_color_text", title: "Text color", description: "Colour of labels and brackets." },
      { type: "color", key: "hud_color_header", title: "Header color", description: "Colour of the panel caption." },
    ],
  },
  {
    id: "world",
    title: "World markers",
    description: "Particles, waypoint and feedback",
    entries: [
      { type: "toggle", key: "beam_enabled", title: "Source beam", description: "Particle column above and below the source block." },
      { type: "toggle", key: "waypoint_enabled", title: "Locator waypoint", description: "Pins the source block on the locator bar." },
      { type: "color", key: "waypoint_color", title: "Waypoint color", description: "Colour of the locator marker." },
      { type: "toggle", key: "chat_feedback", title: "Chat feedback", description: "Print source changes to chat." },
      { type: "toggle", key: "tap_sound", title: "Tap sound", description: "Play a click when the source is placed." },
      { type: "choice", key: "waypoint_texture", title: "Waypoint texture", description: "Locator icon used for the source block.", choices: WAYPOINT_TEXTURES.map((texture) => ({ value: texture.value, label: texture.name })) },
    ],
  },
  {
    id: "keybind",
    title: "Keybind",
    description: "Optional hardware key",
    entries: [
      {
        type: "toggle",
        key: "keybind_enabled",
        title: "Enable button bind",
        description: "Press and release the bound button without moving to set the source. Works on every client.",
      },
      {
        type: "choice",
        key: "keybind_button",
        title: "Bound button",
        description: "Sneak is Shift on a keyboard. Jump is the jump key or button.",
        choices: KEYBIND_BUTTONS.map((button) => ({ value: button.value, label: button.name })),
      },
      { type: "slider", key: "keybind_keycode", title: "Android key code", description: "0 disables. Set the same value in the Levi Mod Menu Keybind control to bind a hardware key through the native companion.", min: 0, max: 1000, step: 1 },
    ],
  },
]);

/**
 * Flattened list of every manageable key: used for validation and to build
 * the Levi Mod Menu schema.
 */
export const MENU_KEYS = Object.freeze(
  MENU.flatMap((category) => category.entries.filter((entry) => entry.key).map((entry) => entry)),
);

export function menuEntry(key) {
  return MENU_KEYS.find((entry) => entry.key === key);
}
