/**
 * A recording stand-in for the Minecraft script engine.
 *
 * `@minecraft/server` cannot be imported outside the game, so the pack's
 * modules are loaded through a small resolve hook that maps it here (see
 * mock_loader.mjs). Everything the pack touches is implemented as a fake that
 * records what happened, which lets the behaviour tests assert on:
 *
 *   - dynamic properties (settings and the persisted source),
 *   - chat / action bar text,
 *   - particles, sounds, waypoints,
 *   - the custom command, item component and input-event registrations,
 *   - the tick loop (advanced by the test, never by a timer).
 *
 * It is deliberately not a simulator: it has no world, no terrain and no
 * physics. It reproduces the *contract* the pack codes against.
 */

/** Mutable engine state, reset between tests. */
export const state = {
  tick: 0,
  players: [],
  /** Chat lines and action bar writes, in order. */
  messages: [],
  actionBars: [],
  particles: [],
  sounds: [],
  waypoints: [],
  intervals: [],
  /** Registries captured from system.beforeEvents.startup. */
  commands: new Map(),
  itemComponents: new Map(),
  /** Event subscriptions, keyed by event name. */
  handlers: new Map(),
};

/**
 * Clears everything a test observes. Subscriptions and the tick loop survive:
 * in game they are created once when the pack loads, so wiping them here would
 * silently unload the pack for the rest of the run.
 */
export function resetState() {
  state.tick = 0;
  state.players = [];
  state.messages = [];
  state.actionBars = [];
  state.particles = [];
  state.sounds = [];
  state.waypoints = [];
  state.commands.clear();
  state.itemComponents.clear();
}

/** Runs every subscribed handler for an event, tolerating absent listeners. */
export function emit(name, event) {
  for (const handler of state.handlers.get(name) ?? []) handler(event);
}

/** Advances the script clock and runs any due `runInterval` callbacks. */
export function advance(ticks) {
  for (let step = 0; step < ticks; step += 1) {
    state.tick += 1;
    for (const interval of state.intervals) {
      if (state.tick % interval.period === 0) interval.callback();
    }
  }
}

function signal(name) {
  return {
    subscribe(handler) {
      const list = state.handlers.get(name) ?? [];
      list.push(handler);
      state.handlers.set(name, list);
      const subscription = {
        unsubscribe() {
          state.handlers.set(name, (state.handlers.get(name) ?? []).filter((h) => h !== handler));
        },
      };
      // Event objects are frozen in game, so the handle is what you unsubscribe with.
      return subscription;
    },
    unsubscribe(handler) {
      const list = state.handlers.get(name) ?? [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
  };
}

/** The property bag backing world and player dynamic properties. */
class PropertyBag {
  constructor() {
    this.values = new Map();
  }
  get(key) {
    return this.values.get(key);
  }
  set(key, value) {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
    return value;
  }
}

export const world = {
  getDynamicProperty: (key) => dynamicProperties.get(key),
  setDynamicProperty: (key, value) => dynamicProperties.set(key, value),
  getAllPlayers: () => state.players,
  sendMessage: (message) => state.messages.push({ scope: "world", message }),
  afterEvents: {
    worldLoad: signal("worldLoad"),
    playerSpawn: signal("playerSpawn"),
    playerLeave: signal("playerLeave"),
    playerDimensionChange: signal("playerDimensionChange"),
    playerButtonInput: signal("playerButtonInput"),
    // Exactly the item events world.afterEvents exposes in 2.10.0. Anything
    // the pack reaches for that is not here is a typo, and `?.subscribe` on it
    // would silently do nothing -- which is what this mock exists to prevent.
    itemUse: signal("itemUse"),
    itemStartUse: signal("itemStartUse"),
    itemStartUseOn: signal("itemStartUseOn"),
    itemStopUse: signal("itemStopUse"),
    itemStopUseOn: signal("itemStopUseOn"),
    itemCompleteUse: signal("itemCompleteUse"),
  },
  beforeEvents: {
    startup: signal("startup"),
    itemUse: signal("itemUseBefore"),
  },
};

export const dynamicProperties = new PropertyBag();

export const system = {
  get currentTick() {
    return state.tick;
  },
  run(callback) {
    callback();
  },
  runInterval(callback, period) {
    const handle = { callback, period };
    state.intervals.push(handle);
    return handle;
  },
  clearRun(handle) {
    const index = state.intervals.indexOf(handle);
    if (index >= 0) state.intervals.splice(index, 1);
  },
  beforeEvents: {
    startup: {
      subscribe(handler) {
        const list = state.handlers.get("startup") ?? [];
        list.push(handler);
        state.handlers.set("startup", list);
        return handler;
      },
    },
  },
};

export const itemComponentRegistry = {
  registerCustomComponent(identifier, definition) {
    state.itemComponents.set(identifier, definition);
  },
};

export const customCommandRegistry = {
  registerCommand(definition, handler) {
    const name = typeof definition === "string" ? definition : definition.name;
    // Mirrors CustomCommandRegistry.registerCommand: the definition is one
    // argument and the callback is another, so keeping only the first would
    // make every command silently unrunnable.
    state.commands.set(name, { ...definition, name, handler });
    return { name };
  },
  registerEnum(definition) {
    return definition;
  },
};

/** Marks a player object as a Player, which main.js checks with instanceof. */
export class Player {
  constructor({ id = "player-1", name = "Tester", location, dimension } = {}) {
    this.id = id;
    this.name = name;
    this.location = location ?? { x: 0.5, y: 64, z: 0.5 };
    this.dimension = dimension ?? makeDimension("minecraft:overworld");
    this.properties = new PropertyBag();
    /** Camera direction in degrees, as getRotation() reports it. */
    this.rotation = { x: 0, y: 0 };
    this.onScreenDisplay = {
      setActionBar: (text) => state.actionBars.push({ playerId: this.id, text }),
    };
  }

  getRotation() {
    return { ...this.rotation };
  }

  getDynamicProperty(key) {
    return this.properties.get(key);
  }

  setDynamicProperty(key, value) {
    return this.properties.set(key, value);
  }

  sendMessage(message) {
    state.messages.push({ scope: this.id, message });
  }

  playSound(soundId, options) {
    state.sounds.push({ playerId: this.id, soundId, options });
  }
}

function makeDimension(id) {
  return {
    id,
    spawnParticle(effect, location) {
      state.particles.push({ dimension: id, effect, location });
    },
  };
}

export const LocationWaypoint = class {
  constructor(dimensionLocation, textureSelector, color) {
    this.dimensionLocation = dimensionLocation;
    this.textureSelector = textureSelector;
    this.color = color;
    this.isValid = true;
    this.removed = false;
    state.waypoints.push({ waypoint: this, event: "created" });
  }

  setDimensionLocation(location) {
    this.dimensionLocation = location;
    state.waypoints.push({ waypoint: this, event: "moved" });
  }

  remove() {
    this.isValid = false;
    this.removed = true;
    state.waypoints.push({ waypoint: this, event: "removed" });
  }
};

export const WaypointTexture = {
  Circle: "minecraft:circle",
  SmallSquare: "minecraft:small_square",
  SmallStar: "minecraft:small_star",
  Square: "minecraft:square",
};

export const InputButton = { Jump: "Jump", Sneak: "Sneak" };
export const ButtonState = { Pressed: "Pressed", Released: "Released" };

/** Attaches a locator bar to a player, as the engine does. */
export function withLocatorBar(player) {
  player.locatorBar = {
    addWaypoint(waypoint) {
      state.waypoints.push({ waypoint, event: "added", playerId: player.id });
    },
  };
  return player;
}

// ---------------------------------------------------------------------------
// Enums the pack imports. Values mirror @minecraft/server 2.10.0; only the
// member names matter to the code, but keeping the shapes close means a
// membership check in the pack behaves the same way here.
// ---------------------------------------------------------------------------

export const CustomCommandStatus = {
  Success: 0,
  Failure: 1,
};

export const CommandPermissionLevel = {
  Any: 0,
  GameDirectors: 1,
  Admin: 2,
  Host: 3,
  Owner: 4,
};

export const CustomCommandParamType = {
  Boolean: "Boolean",
  Integer: "Integer",
  Float: "Float",
  String: "String",
  EntitySelector: "EntitySelector",
  PlayerSelector: "PlayerSelector",
  Location: "Location",
  BlockType: "BlockType",
  ItemType: "ItemType",
  Enum: "Enum",
};

export const CustomCommandOriginType = { Player: "Player", Server: "Server" };

/** Thrown by engine calls the mock does not implement, so tests fail loudly
 *  instead of silently passing over a code path the pack relies on. */
export class NotImplementedError extends Error {}
