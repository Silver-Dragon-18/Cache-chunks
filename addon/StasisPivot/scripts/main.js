/**
 * StasisPivot - entry point for Minecraft Bedrock 1.26.60+.
 *
 * Wiring order matters:
 *   1. register the item custom component inside `system.beforeEvents.startup`
 *      (registries only accept writes in that window);
 *   2. load settings and the persisted source once the world is available;
 *   3. drive the panel and the world markers from one light interval.
 */

import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import { MENU } from "./config.js";
import { get, loadSettings, settings, storeSource } from "./settings.js";
import { HudController } from "./hud.js";
import { PivotManager } from "./pivot.js";
import { WaypointMarker, drawBeam } from "./markers.js";
import { openMainMenu } from "./menu.js";
import { bindOverlay, levi, pollTrigger } from "./levi.js";
import { installKeybind } from "./keybind.js";

const COMPONENT_ID = "stasispivot:on_use_pivot";
const TICK_INTERVAL = 4; // 5 Hz: plenty for coordinates, cheap on a phone

const pivots = new PivotManager();
const waypoint = new WaypointMarker();
const hud = new HudController((player) => pivots.getActive(player));
pivots.attachHud(hud);

// ---------------------------------------------------------------------------
// Startup registries
// ---------------------------------------------------------------------------

system.beforeEvents.startup.subscribe((event) => {
  try {
    event.itemComponentRegistry.registerCustomComponent(COMPONENT_ID, {
      onUse(componentEvent) {
        const player = componentEvent.source;
        if (!(player instanceof Player)) return;
        pivots.markTap(player);
        pivots.trigger(player, "Tapped");
      },
      onCompleteUse(componentEvent) {
        const player = componentEvent.source;
        if (!(player instanceof Player)) return;
        // Hold-to-use taps are already handled by onUse; a completed use with
        // no matching tap is a deliberate second gesture.
        if (pivots.consumeTap(player)) return;
        pivots.trigger(player, "Tapped");
      },
    });
  } catch {
    // A duplicate registration after a script reload is harmless.
  }

  const commands = [
    {
      name: "stasispivot:set",
      description: "Set the StasisPivot source to the block below you",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      run(player) {
        pivots.trigger(player, "Command");
      },
    },
    {
      name: "stasispivot:menu",
      description: "Open the StasisPivot settings menu",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      run(player) {
        openMainMenu(player, pivots);
      },
    },
    {
      name: "stasispivot:clear",
      description: "Forget the StasisPivot source",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      run(player) {
        pivots.clear(player);
        safe(() => player.sendMessage("§7StasisPivot source cleared."));
      },
    },
  ];

  for (const command of commands) {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: command.name,
          description: command.description,
          permissionLevel: command.permissionLevel,
          cheatsRequired: command.cheatsRequired,
        },
        (origin) => {
          const player = origin.sourceEntity;
          if (!(player instanceof Player)) {
            return { status: CustomCommandStatus.Failure, message: "Use this as a player." };
          }
          // Command callbacks run in a read-only context: defer the work.
          system.run(() => command.run(player));
          return { status: CustomCommandStatus.Success };
        },
      );
    } catch {
      // Commands are a convenience; the item path still works without them.
    }
  }
});

// ---------------------------------------------------------------------------
// Shared state for the native companion mod and for other packs
// ---------------------------------------------------------------------------

try {
  globalThis.StasisPivot = {
    version: "1.0.0",
    menu: MENU,
    getSettings: () => ({ ...settings() }),
    getSource: (player) => pivots.getActive(player),
    openMenu: (player) => openMainMenu(player, pivots),
    bindOverlay,
  };
} catch {
  // Some builds freeze the global object; the pack still works without it.
}

// ---------------------------------------------------------------------------
// World lifecycle
// ---------------------------------------------------------------------------

world.afterEvents.worldLoad.subscribe(() => {
  loadSettings();
  pivots.load();
});

// Settings must exist before the keybind reads them, so install it once the
// world (and with it the dynamic properties) is available. `system.run` also
// keeps the listener out of the early-execution phase.
system.run(() => {
  loadSettings();
  installKeybind(pivots);
});

world.afterEvents.playerSpawn.subscribe((event) => {
  loadSettings();
  if (event.initialSpawn) {
    // A fresh join (including a server restart) restores the world copy so a
    // pivot made in the previous session is still there.
    pivots.load();
  } else {
    pivots.restore(event.player);
  }
  hud.lastSignature = "";
  // The frame loop may run before the first player exists; publish the pivot
  // now so the next session can pick it up even without a clean save.
  const source = pivots.getActive(event.player);
  if (source) storeSource(source);
});

world.afterEvents.playerDimensionChange?.subscribe((event) => {
  hud.lastSignature = "";
  // Only this player's marker is stale: a shared clear() would drop the
  // markers of everyone else standing near their own source.
  waypoint.clearFor(event.player);
  pivots.save();
});

world.afterEvents.playerLeave.subscribe((event) => {
  waypoint.forget(event.playerId);
  pivots.save();
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let tick = 0;

system.runInterval(() => {
  tick += TICK_INTERVAL;
  const players = safePlayers();
  if (players.length === 0) return;

  // The native companion buffers a keybind press as a flag file; forward it
  // through the same path as a tap so both entry points behave identically.
  if (get("keybind_enabled") && pollTrigger()) {
    for (const player of players) {
      if (get("enabled")) safe(() => pivots.trigger(player, "keybind"));
    }
  }

  for (const player of players) {
    const source = pivots.getActive(player);
    if (!source) {
      waypoint.clearFor(player);
      continue;
    }
    drawBeam(player, source);
    waypoint.sync(player, source);
  }

  hud.tick(tick);
}, TICK_INTERVAL);

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
    // ignore
  }
}

// Keep the import referenced even when no companion mod is installed.
void levi;
