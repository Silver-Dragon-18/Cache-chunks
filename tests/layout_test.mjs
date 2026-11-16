#!/usr/bin/env node
/**
 * Host tests for the engine-free part of the StasisPivot pack.
 *
 *   node tests/layout_test.mjs
 *
 * Covers the measurement maths (X/Y/Z/S), the panel layout, the action-bar
 * frame and the native overlay command list. No Minecraft runtime needed: the
 * modules under test import nothing from @minecraft/*.
 */

import assert from "node:assert/strict";
import {
  formatCoord,
  formatDecimal,
  formatSigned,
  offsetFrom,
  straightLine,
  horizontalDistance,
  blockBelow,
  blockAt,
  compactPivot,
  describePivot,
} from "../addon/StasisPivot/scripts/geom.js";
import {
  sectionCode,
  parseHex,
  toHex,
  toArgb,
  fromArgb,
  colorize,
} from "../addon/StasisPivot/scripts/colors.js";
import {
  buildLayout,
  hudSettings,
  toActionBar,
  toOverlayCommands,
} from "../addon/StasisPivot/scripts/layout.js";
import {
  DEFAULTS,
  MENU,
  MENU_KEYS,
  COLOR_KEYS,
  KEYBIND_BUTTONS,
  WAYPOINT_TEXTURES,
} from "../addon/StasisPivot/scripts/config.js";

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

function settingsOf(overrides = {}) {
  const values = { ...DEFAULTS, ...overrides };
  return (key) => values[key];
}

console.log("geom");

test("formatCoord drops the fractional part and keeps a bare 0", () => {
  assert.equal(formatCoord(12.9), "13");
  assert.equal(formatCoord(-0.4), "0");
  assert.equal(formatCoord(-12.6), "-13");
});

test("formatDecimal rounds to two places without a negative zero", () => {
  assert.equal(formatDecimal(3.14159, 2), "3.14");
  assert.equal(formatDecimal(-0.001, 2), "0.00");
  assert.equal(formatDecimal(10, 0), "10");
});

test("formatSigned always carries a sign", () => {
  assert.equal(formatSigned(2.5), "+2.50");
  assert.equal(formatSigned(-2.5), "-2.50");
  assert.equal(formatSigned(0), "0.00");
});

test("the source block is the 0/0/0 reference for the offset", () => {
  const offset = offsetFrom({ x: 10, y: 70, z: -4 }, { x: 3, y: 64, z: -9 });
  assert.deepEqual(offset, { x: 7, y: 6, z: 5 });
});

test("S is the straight-line distance from the player to the source", () => {
  // 3-4-12 triangle: 3^2 + 4^2 + 12^2 = 169 -> 13
  assert.equal(straightLine({ x: 3, y: 4, z: 12 }), 13);
  assert.equal(horizontalDistance({ x: 3, y: 40, z: 4 }), 5);
});

test("auto-snap targets the block directly below the player", () => {
  assert.deepEqual(blockBelow({ x: 12.7, y: 64.0, z: -3.2 }), { x: 12, y: 63, z: -4 });
  assert.deepEqual(blockAt({ x: 12.7, y: 64.0, z: -3.2 }), { x: 12, y: 64, z: -4 });
});

test("describePivot reports source coordinates and signed offsets", () => {
  const described = describePivot({ x: 10, y: 66, z: -4 }, { x: 10, y: 64, z: -4 });
  assert.equal(described.x, "10");
  assert.equal(described.y, "64");
  assert.equal(described.z, "-4");
  assert.equal(described.s, "2.00");
  assert.equal(described.dy, "+2.00");
});

test("compactPivot joins the source coordinates", () => {
  assert.equal(compactPivot({ x: 1, y: 2, z: 3 }), "1 / 2 / 3");
});

console.log("colors");

test("hex parsing round-trips", () => {
  assert.deepEqual(parseHex("#00E5FF"), [0, 229, 255]);
  assert.equal(toHex([0, 229, 255]), "#00E5FF");
  assert.deepEqual(parseHex("nonsense"), [255, 255, 255]);
});

test("the closest § code matches Bedrock's palette", () => {
  assert.equal(sectionCode("#55FFFF"), "§b"); // aqua
  assert.equal(sectionCode("#FFFFFF"), "§f"); // white
  assert.equal(sectionCode("#000000"), "§0"); // black
  assert.equal(sectionCode("#FF5555"), "§c"); // red
});

test("colorize resets after the coloured span", () => {
  assert.equal(colorize("#55FF55", "Y 64"), "§aY 64§r");
});

test("ARGB carries alpha in the high byte", () => {
  assert.equal(toArgb("#FF8800", 1), 0xffff8800);
  assert.equal(toArgb("#FF8800", 0.5), 0x80ff8800);
  assert.equal(fromArgb(0xff00e5ff), "#00E5FF");
});

console.log("layout");

test("settings snapshot reads every panel key", () => {
  const cfg = hudSettings(settingsOf());
  for (const key of [
    "hud_bg_color",
    "hud_outline_color",
    "hud_outline_width",
    "hud_corner_radius",
    "hud_color_x",
    "hud_color_y",
    "hud_color_z",
    "hud_color_s",
  ]) {
    assert.ok(cfg[key] !== undefined, `${key} missing from the snapshot`);
  }
});

test("the panel reports the source X Y Z S values", () => {
  const layout = buildLayout({
    source: { x: 120, y: 64, z: -8 },
    playerLocation: { x: 123, y: 68, z: 4 },
    settings: hudSettings(settingsOf()),
  });
  const text = layout.rows.map((row) => row.map((span) => span.text).join("")).join("\n");
  assert.match(text, /X 120/);
  assert.match(text, /Y 64/);
  assert.match(text, /Z -8/);
  // 3^2 + 4^2 + 12^2 = 169 -> S 13.00
  assert.match(text, /S 13\.00/);
});

test("the signed offset row is optional", () => {
  const withDelta = buildLayout({
    source: { x: 0, y: 0, z: 0 },
    playerLocation: { x: 1, y: 2, z: 3 },
    settings: hudSettings(settingsOf({ hud_show_delta: true })),
  });
  const withoutDelta = buildLayout({
    source: { x: 0, y: 0, z: 0 },
    playerLocation: { x: 1, y: 2, z: 3 },
    settings: hudSettings(settingsOf({ hud_show_delta: false })),
  });
  assert.equal(withDelta.rows.length, withoutDelta.rows.length + 1);
  const deltaRow = withDelta.rows.at(-1).map((span) => span.text).join("");
  assert.match(deltaRow, /dX \+1\.00/);
  assert.match(deltaRow, /dZ \+3\.00/);
});

test("the outline box grows with scale", () => {
  const base = { source: { x: 0, y: 0, z: 0 }, playerLocation: { x: 0, y: 0, z: 0 } };
  const small = buildLayout({ ...base, settings: hudSettings(settingsOf({ hud_scale: 1 })) });
  const large = buildLayout({ ...base, settings: hudSettings(settingsOf({ hud_scale: 2 })) });
  assert.ok(large.box.w > small.box.w * 1.8);
  assert.ok(large.box.h > small.box.h * 1.8);
});

test("the draw distance hides the panel when always-show is off", () => {
  const settings = hudSettings(settingsOf({ hud_always: false, hud_max_distance: 32 }));
  const near = buildLayout({ source: { x: 0, y: 0, z: 0 }, playerLocation: { x: 8, y: 0, z: 0 }, settings });
  const far = buildLayout({ source: { x: 0, y: 0, z: 0 }, playerLocation: { x: 64, y: 0, z: 0 }, settings });
  assert.equal(near.visible, true);
  assert.equal(far.visible, false);
});

test("the action bar frame uses box drawing characters and § colours", () => {
  const layout = buildLayout({
    source: { x: 5, y: 6, z: 7 },
    playerLocation: { x: 5, y: 10, z: 7 },
    settings: hudSettings(settingsOf()),
  });
  const stacked = toActionBar(layout, hudSettings(settingsOf({ hud_actionbar_stacked: true })));
  assert.match(stacked, /╭─+╮/);
  assert.match(stacked, /╰─+╯/);
  assert.match(stacked, /§b/);
  const single = toActionBar(layout, hudSettings(settingsOf({ hud_actionbar_stacked: false })));
  assert.equal(single.includes("\n"), false);
});

test("overlay commands describe background, outline and text", () => {
  const layout = buildLayout({
    source: { x: 1, y: 2, z: 3 },
    playerLocation: { x: 1, y: 10, z: 3 },
    settings: hudSettings(settingsOf()),
  });
  const commands = toOverlayCommands(layout, hudSettings(settingsOf()));
  const kinds = new Set(commands.map((command) => command.op));
  assert.ok(kinds.has("rect"), "background rect missing");
  assert.ok(kinds.has("line"), "outline lines missing");
  assert.ok(kinds.has("text"), "text spans missing");
  for (const command of commands) {
    assert.ok(Number.isFinite(command.x) && Number.isFinite(command.y));
    assert.ok(Number.isInteger(command.color), "colour must be packed 0xAARRGGBB");
  }
  // The outline must close: every corner contributes line segments.
  const lines = commands.filter((command) => command.op === "line");
  assert.ok(lines.length >= 4 + 4, "expected four edges and four rounded corners");
});

test("outline width 0 removes the border but keeps the panel", () => {
  const settings = hudSettings(settingsOf({ hud_outline_width: 0 }));
  const layout = buildLayout({
    source: { x: 0, y: 0, z: 0 },
    playerLocation: { x: 0, y: 0, z: 0 },
    settings,
  });
  const commands = toOverlayCommands(layout, settings);
  assert.equal(commands.some((command) => command.op === "line"), false);
  assert.equal(commands.some((command) => command.op === "text"), true);
});

console.log("config");

test("every menu entry resolves to a default", () => {
  for (const entry of MENU_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(DEFAULTS, entry.key), `${entry.key} has no default`);
  }
});

test("every default is reachable from the menu", () => {
  const menuKeys = new Set(MENU_KEYS.map((entry) => entry.key));
  for (const key of Object.keys(DEFAULTS)) {
    assert.ok(menuKeys.has(key), `${key} is not in the menu`);
  }
});

test("colour defaults are valid #RRGGBB values", () => {
  for (const key of COLOR_KEYS) {
    assert.match(DEFAULTS[key], /^#[0-9A-F]{6}$/, `${key} is not #RRGGBB`);
  }
});

test("menu ids are unique", () => {
  const ids = new Set();
  for (const category of MENU) {
    assert.ok(!ids.has(category.id), `duplicate category ${category.id}`);
    ids.add(category.id);
  }
});

test("choice entries offer values that exist in their source list", () => {
  const lists = {
    waypoint_texture: WAYPOINT_TEXTURES.map((texture) => texture.value),
    keybind_button: KEYBIND_BUTTONS.map((button) => button.value),
  };
  for (const entry of MENU_KEYS) {
    if (entry.type !== "choice") continue;
    const known = lists[entry.key];
    assert.ok(known, `${entry.key} has no known value list`);
    assert.ok(entry.choices.length > 0, `${entry.key} has no choices`);
    for (const choice of entry.choices) {
      assert.ok(known.includes(choice.value), `${entry.key}: ${choice.value} is unknown`);
    }
    assert.ok(known.includes(DEFAULTS[entry.key]), `${entry.key} default is not a choice`);
  }
});

test("the keybind defaults to off and to a button Bedrock reports", () => {
  assert.equal(DEFAULTS.keybind_enabled, false);
  const values = KEYBIND_BUTTONS.map((button) => button.value);
  assert.ok(values.includes(DEFAULTS.keybind_button), "default button is not bindable");
  // InputButton in @minecraft/server 2.10.0 has exactly these two members.
  assert.deepEqual([...values].sort(), ["Jump", "Sneak"]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(failure.error);
  process.exit(1);
}
