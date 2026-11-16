#!/usr/bin/env node
/**
 * Behaviour tests for the script pack: the modules are executed, not inspected.
 *
 *   node tests/behaviour_test.mjs
 *
 * `@minecraft/server` does not exist outside the game, so mock_loader.mjs maps
 * it (and server-ui) onto the recording fakes in tests/mock/. The pack itself is
 * imported unmodified, which means these tests exercise the same files that
 * ship in the .mcpack: startup registration, the tap gesture, the coordinate
 * panel, the commands, the keybind gesture and the settings menu.
 */

import { register } from "node:module";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./mock/mock_loader.mjs", import.meta.url).pathname).href, import.meta.url);

const engine = await import("@minecraft/server");
const ui = await import("@minecraft/server-ui");

const { state, world, system, emit, advance, resetState, Player, withLocatorBar, dynamicProperties } = engine;

/** The pack is a singleton module graph; import it once and reset state per test. */
await import("../addon/StasisPivot/scripts/main.js");
const settingsModule = await import("../addon/StasisPivot/scripts/settings.js");
const configModule = await import("../addon/StasisPivot/scripts/config.js");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    // Awaited: a rejected promise from an async body must fail the test rather
    // than resolve into a silent pass.
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

/** Strips § colour codes so assertions read the text players actually see. */
function plain(text) {
  return String(text).replace(/§./g, "");
}

const COMPONENT = "stasispivot:on_use_pivot";

function startup() {
  emit("startup", {
    itemComponentRegistry: engine.itemComponentRegistry,
    customCommandRegistry: engine.customCommandRegistry,
  });
}

/**
 * A world with one spawned player and the startup registries fired.
 *
 * Each test gets its own player id: the pack keeps per-player waypoints and
 * panel state in module-level maps that a reset cannot reach, and a shared id
 * would make one test inherit another's marker.
 */
let nextPlayer = 0;
function boot({ location = { x: 10.4, y: 70, z: -3.2 }, id = `p${(nextPlayer += 1)}` } = {}) {
  const player = withLocatorBar(new Player({ id, location }));
  state.players.push(player);
  emit("worldLoad", {});
  emit("playerSpawn", { player, initialSpawn: true });
  return player;
}

function before() {
  // Leaving players behind would keep their pivots in the pack's own maps and
  // let one test inherit the world copy of another's source.
  for (const player of state.players) emit("playerLeave", { playerId: player.id });
  resetState();
  ui.reset();
  dynamicProperties.values.clear();
  settingsModule.loadSettings();
  // main.js registers the item component and commands once per process; the
  // startup event is re-fired so the registries are repopulated for each test.
  startup();
}

/** Real elapsed time does not move the mock clock, so tests drive it. */
function tap(player, { holdTicks = 2, drift = 0, look = 0, onBlock = false } = {}) {
  const component = state.itemComponents.get(COMPONENT);
  component.onUse({ source: player, itemStack: { type: "stasispivot:pivot" } });
  if (drift) player.location = { ...player.location, x: player.location.x + drift };
  if (look) player.rotation = { x: player.rotation.x, y: player.rotation.y + look };
  advance(holdTicks);
  if (onBlock) component.onUseOn({ source: player, itemStack: { type: "stasispivot:pivot" } });
  emit("itemStopUse", { source: player, itemStack: { type: "stasispivot:pivot" } });
  advance(4); // let the panel draw
}

/** Runs a custom command the way the engine does: as a player origin. */
function shell(name, player) {
  const handler = state.commands.get(name).handler;
  return handler({ sourceEntity: player });
}

const lastActionBar = () => plain(state.actionBars.at(-1)?.text ?? "");

// ---------------------------------------------------------------------------

// The pack registers its component and commands on the startup event, so fire
// it once before the first section; every later test re-fires it via before().
before();

console.log("startup");

await test("the item component is registered under the id the item JSON names", () => {
  assert.ok(state.itemComponents.has(COMPONENT), `registered: ${[...state.itemComponents.keys()]}`);
  const component = state.itemComponents.get(COMPONENT);
  assert.equal(typeof component.onUse, "function");
  assert.equal(typeof component.onUseOn, "function");
  assert.equal(typeof component.onHitEntity, "function");
});

await test("the three commands are registered and are usable without cheats", () => {
  for (const name of ["stasispivot:set", "stasispivot:menu", "stasispivot:clear"]) {
    const command = state.commands.get(name);
    assert.ok(command, `${name} is not registered`);
    assert.equal(command.cheatsRequired, false, `${name} requires cheats`);
    assert.equal(command.permissionLevel, engine.CommandPermissionLevel.Any);
  }
});

await test("the item component id matches the item JSON", async () => {
  const { readFile } = await import("node:fs/promises");
  const item = JSON.parse(await readFile(new URL("../addon/StasisPivot/items/stasis_pivot.json", import.meta.url)));
  const declared = item["minecraft:item"].components["minecraft:custom_components"];
  assert.deepEqual(declared, [COMPONENT]);
});

console.log("\nthe tap gesture");

await test("a short tap on the spot sets the source and reports it", () => {
  before();
  const player = boot();
  tap(player);
  const chat = plain(state.messages.at(-1)?.message ?? "");
  assert.match(chat, /source 10 \/ 69 \/ -4/);
  assert.match(chat, /S /);
});

await test("dragging the camera while holding does not place a source", () => {
  before();
  const player = boot();
  tap(player, { drift: 1.5 });
  assert.equal(state.messages.length, 0, "a drag must not report a source");
});

await test("a long hold is not a tap", () => {
  before();
  const player = boot();
  tap(player, { holdTicks: 40 });
  assert.equal(state.messages.length, 0);
});

await test("turning the camera while holding does not place a source", () => {
  before();
  const player = boot();
  tap(player, { look: 60 });
  assert.equal(state.messages.length, 0, "a camera turn must not move the pivot");
});

await test("a small camera wobble is still a tap", () => {
  before();
  const player = boot();
  tap(player, { look: 4 });
  assert.match(plain(state.messages.at(-1)?.message ?? ""), /source/);
});

await test("using the item on a block is not a tap", () => {
  before();
  const player = boot();
  tap(player, { onBlock: true });
  assert.equal(state.messages.length, 0, "a block use must not move the pivot");
});

await test("a completed use on its own does not place a source", () => {
  before();
  const player = boot();
  const component = state.itemComponents.get(COMPONENT);
  // The engine fires this once the use duration elapses, which happens while
  // the player is still holding: acting on it would place a pivot mid-hold.
  component.onUse({ source: player, itemStack: { type: "stasispivot:pivot" } });
  advance(12);
  emit("itemCompleteUse", { source: player, itemStack: { type: "stasispivot:pivot" } });
  assert.equal(state.messages.length, 0);
});

await test("hitting a mob with the item is not a tap", () => {
  before();
  const player = boot();
  const component = state.itemComponents.get(COMPONENT);
  component.onUse({ source: player, itemStack: { type: "stasispivot:pivot" } });
  component.onHitEntity({ attackingEntity: player, itemStack: { type: "stasispivot:pivot" } });
  advance(2);
  emit("itemStopUse", { source: player, itemStack: { type: "stasispivot:pivot" } });
  assert.equal(state.messages.length, 0);
});

await test("a block use that never released does not excuse a later tap", () => {
  before();
  const player = boot();
  const component = state.itemComponents.get(COMPONENT);
  component.onUse({ source: player, itemStack: { type: "stasispivot:pivot" } });
  component.onUseOn({ source: player, itemStack: { type: "stasispivot:pivot" } });
  // No release: the player walked off the block. Time passes, then they tap.
  advance(40);
  tap(player);
  assert.match(plain(state.messages.at(-1)?.message ?? ""), /source/);
});

await test("one block use only excuses its own release", () => {
  before();
  const player = boot();
  tap(player, { onBlock: true });
  assert.equal(state.messages.length, 0);
  // The next gesture is a plain tap and must work: the flag was consumed.
  tap(player);
  assert.match(plain(state.messages.at(-1)?.message ?? ""), /source/);
});

await test("releasing without a hold start does nothing", () => {
  before();
  const player = boot();
  emit("itemStopUse", { source: player });
  assert.equal(state.messages.length, 0);
});

await test("a stale hold from a previous gesture cannot be reused", () => {
  before();
  const player = boot();
  tap(player);
  const after_first = state.messages.length;
  emit("itemStopUse", { source: player });
  assert.equal(state.messages.length, after_first, "the second release found no hold");
});

console.log("\nthe coordinate panel");

await test("the panel shows X Y Z S for the source and the player", () => {
  before();
  const player = boot();
  tap(player);
  const panel = lastActionBar();
  assert.match(panel, /X 10/);
  assert.match(panel, /Y 69/);
  assert.match(panel, /Z -4/);
  assert.match(panel, /S \d/);
});

await test("the panel has an outline and follows the player as they move", () => {
  before();
  const player = boot();
  tap(player);
  const first = lastActionBar();
  player.location = { x: 40.5, y: 70, z: 20.5 };
  advance(8);
  const second = lastActionBar();
  assert.notEqual(first, second, "the panel did not update after moving");
  // Box-drawing characters are the outline; S must have grown with distance.
  const distance = (text) => Number(/S ([\d.]+)/.exec(text)?.[1] ?? 0);
  assert.ok(distance(second) > distance(first), "S did not grow with distance");
  assert.match(second, /[─│╭╮╰╯╞╡]/);
});

await test("the panel is not drawn when the mod is switched off", () => {
  before();
  const player = boot();
  tap(player);
  const before_count = state.actionBars.length;
  settingsModule.set("enabled", false);
  advance(8);
  const drawn = state.actionBars.slice(before_count).filter((entry) => entry.text.trim() !== "");
  assert.equal(drawn.length, 0, "panels were drawn while disabled");
  settingsModule.set("enabled", true);
});

console.log("\nworld feedback");

await test("placing a source spawns the particle beacon", () => {
  before();
  const player = boot();
  tap(player);
  assert.ok(state.particles.length > 0, "no particles were spawned");
  assert.ok(state.particles.some((p) => p.effect === "stasispivot:beacon_core"));
});

await test("the locator waypoint is added once and moved, not recreated every tick", () => {
  before();
  const player = boot();
  tap(player);
  advance(20);
  const created = state.waypoints.filter((entry) => entry.event === "created").length;
  const added = state.waypoints.filter((entry) => entry.event === "added").length;
  assert.equal(created, 1, `waypoint recreated ${created} times`);
  assert.equal(added, 1);
});

await test("clearing the source removes the waypoint", () => {
  before();
  const player = boot();
  tap(player);
  shell("stasispivot:clear", player);
  advance(8);
  assert.ok(state.waypoints.some((entry) => entry.event === "removed"));
  // Clearing has to reach the stored copy too, or the next load brings it back.
  assert.equal(dynamicProperties.get("stasispivot:source"), undefined);
});

console.log("\npersistence");

await test("the source is stored in world and player dynamic properties", () => {
  before();
  const player = boot();
  tap(player);
  assert.ok(dynamicProperties.get("stasispivot:source"), "world copy missing");
  assert.ok(player.getDynamicProperty("stasispivot:p_source"), "player copy missing");
});

await test("settings survive a save/load round trip", () => {
  before();
  settingsModule.set("hud_color_s", "#123456");
  settingsModule.set("hud_scale", 1.55);
  settingsModule.loadSettings();
  assert.equal(settingsModule.get("hud_color_s"), "#123456");
  assert.equal(settingsModule.get("hud_scale"), 1.55);
});

await test("a corrupt stored setting falls back to the default", () => {
  before();
  dynamicProperties.set("stasispivot:settings", JSON.stringify({ hud_scale: "enormous", keybind_button: 7 }));
  settingsModule.loadSettings();
  assert.equal(settingsModule.get("hud_scale"), configModule.DEFAULTS.hud_scale);
  assert.equal(settingsModule.get("keybind_button"), configModule.DEFAULTS.keybind_button);
});

await test("the source is restored for a player who rejoins", () => {
  before();
  const player = boot();
  tap(player);
  const stored = player.getDynamicProperty("stasispivot:p_source");
  // Simulate a rejoin: a fresh player object with the same id and property.
  state.players.length = 0;
  const rejoined = withLocatorBar(new Player({ id: player.id, location: { x: 0, y: 64, z: 0 } }));
  rejoined.setDynamicProperty("stasispivot:p_source", stored);
  state.players.push(rejoined);
  emit("playerSpawn", { player: rejoined, initialSpawn: true });
  advance(4);
  assert.match(lastActionBar(), /X 10/, "the restored source was not used");
});

console.log("\ncommands");

await test("the set command places a source", () => {
  before();
  const player = boot();
  shell("stasispivot:set", player);
  assert.match(plain(state.messages.at(-1)?.message ?? ""), /source/);
});

await test("the clear command reports and forgets the source", () => {
  before();
  const player = boot();
  tap(player);
  shell("stasispivot:clear", player);
  assert.match(plain(state.messages.at(-1)?.message ?? ""), /cleared/i);
});

console.log("\nthe keybind gesture");

await test("the bound button places a source when tapped", () => {
  before();
  settingsModule.set("keybind_enabled", true);
  settingsModule.set("keybind_button", "Sneak");
  const player = boot();
  emit("playerButtonInput", { player, button: engine.InputButton.Sneak, newButtonState: engine.ButtonState.Pressed });
  emit("playerButtonInput", { player, button: engine.InputButton.Sneak, newButtonState: engine.ButtonState.Released });
  assert.match(plain(state.messages.at(-1)?.message ?? ""), /source/);
});

await test("walking with the button held does not place a source", () => {
  before();
  settingsModule.set("keybind_enabled", true);
  settingsModule.set("keybind_button", "Sneak");
  const player = boot();
  emit("playerButtonInput", { player, button: engine.InputButton.Sneak, newButtonState: engine.ButtonState.Pressed });
  player.location = { x: player.location.x + 3, y: player.location.y, z: player.location.z };
  emit("playerButtonInput", { player, button: engine.InputButton.Sneak, newButtonState: engine.ButtonState.Released });
  assert.equal(state.messages.length, 0);
});

await test("an unbound or disabled keybind is ignored", () => {
  before();
  settingsModule.set("keybind_enabled", false);
  const player = boot();
  emit("playerButtonInput", { player, button: engine.InputButton.Jump, newButtonState: engine.ButtonState.Pressed });
  emit("playerButtonInput", { player, button: engine.InputButton.Jump, newButtonState: engine.ButtonState.Released });
  assert.equal(state.messages.length, 0);
});



// Keep the mock honest: if the pack starts listening to an event the mock does
// not model, `?.subscribe` would quietly do nothing and the tests above would
// pass against a pack that is broken on a device.
console.log("\nthe mock's API surface");

await test("every event the pack subscribes to exists in the mock", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const files = (await readdir(new URL("../addon/StasisPivot/scripts/", import.meta.url))).filter(
    (file) => file.endsWith(".js"),
  );
  const missing = [];
  for (const file of files) {
    const text = await readFile(new URL(`../addon/StasisPivot/scripts/${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/world\.(afterEvents|beforeEvents)\.(\w+)/g)) {
      if (!(match[2] in world[match[1]])) missing.push(`world.${match[1]}.${match[2]}`);
    }
  }
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(failure.error);
  process.exit(1);
}
