/**
 * Module resolve hook that maps `@minecraft/server` and
 * `@minecraft/server-ui` onto the recording mocks in this directory.
 *
 * Usage (see tests/behaviour_test.mjs):
 *
 *   import { register } from "node:module";
 *   register("./mock_loader.mjs", import.meta.url);
 *
 * Registered this way it also covers dynamic imports, so the pack's own
 * `import "./config.js"` chain resolves normally.
 */

// The URL the test imports directly must be the *same* module instance the pack
// gets, otherwise the pack records into a different `state` object than the one
// the test reads. Import mocks through the bare specifier only.
const MOCKS = {
  "@minecraft/server": new URL("./engine.mjs", import.meta.url).href,
  "@minecraft/server-ui": new URL("./server_ui.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier in MOCKS) {
    return { url: MOCKS[specifier], shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
