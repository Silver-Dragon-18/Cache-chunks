# Compatibility and API notes

This file records *why* the pack declares the versions it does, so the next
maintainer can update it without reverse-engineering the whole pack.

## Target

* Minecraft **Bedrock 1.26.60** and newer (`min_engine_version: "1.26.60"`).
* Geometry dash / `1.26.6x` hotfixes: same engine, no changes needed.
* LeviLauncher for Android (native companion, optional).

## Script API versions

`1.26.60` shipped `@minecraft/server 2.11.0` and `@minecraft/server-ui 2.3.0`.
The pack deliberately depends on the **older stable** modules:

| Module | Declared | Why |
| --- | --- | --- |
| `@minecraft/server` | `2.10.0` | Shipped as stable with 1.26.43 and still supported by 1.26.60+. Using the lower stable floor keeps the pack loadable on 1.26.43–1.26.6x instead of only the newest build. |
| `@minecraft/server-ui` | `2.1.0` | Present since 1.26.x; `ActionFormData.divider()`, `header()` and `submitButton()` all exist in 2.1.0–2.3.0, and `2.1.0` is accepted by both. |

Both dependencies were verified against the published typings
(`npm view @minecraft/server versions`, `index.d.ts`) rather than assumed.

## APIs used, and where they came from

| API | Released in | Used for |
| --- | --- | --- |
| `system.beforeEvents.startup` (`itemComponentRegistry`, `customCommandRegistry`) | 1.21.60+ (2.1.0) | item behaviour, `/stasispivot:*` commands |
| `minecraft:custom_components` on items | 1.21.60 | the tap hook |
| `LocationWaypoint` + `player.locatorBar` | 2.8.0 (1.26.21) | the locator-bar pin |
| `Player.onScreenDisplay.setActionBar` | 1.20+ | the panel transport |
| `player.playSound`, `dimension.spawnParticle` | 1.20+ | feedback |
| world/entity dynamic properties | 1.19.80+ | settings and source persistence |

Nothing here is beta-only: with the modules declared above the pack loads
without the "Beta APIs" experiment on a 1.26.60 client.

### Deliberately unused

* **`TextPrimitive` / `world.primitiveShapesManager`** (2.8.0): 3D world text
  with a background plate sounds ideal for the panel, but the API sets its
  alpha and colour as `RGBA` floats, is capped at 128 characters per line and
  renders *in the world*, not as a screen UI element. The coordinate panel needs
  screen-anchored, per-player text, so the action bar + Levi HUD overlay path is
  used instead.
* **`player.playerButtonInput` for arbitrary keys**: the event exists in 2.10.0
  and is *used* (see `scripts/keybind.js`), but `InputButton` has exactly two
  members, `Jump` and `Sneak`. On touch, `Sneak` is released after one tick, so
  the bind is judged by press-to-release timing and movement rather than by
  holding it. A real "any key" binding stays a native (companion) feature.

## LeviLauncher package format

Facts taken from the launcher source (`ModManager.java`, `FileHandler.java`) and
the Preloader SDK headers:

* A mod directory must contain `manifest.json` with `type: "preload-native"`,
  and `entry` must point at a `.so` **inside that directory**. Anything else is
  skipped by `parseDirectoryMod`.
* `.levipack`/`.zip` imports are validated the same way: one manifest, exactly
  one `.so` under the manifest's root folder.
* `minecraft_versions` accepts exact versions and `*` wildcards; an empty list
  means "all versions". This repository declares `["1.26.*"]`.
* Mod Menu modules are registered from C++ through
  `pl::modmenu::registerModule`; the toggle, `Keybind` config and
  `submitDrawCommands` are the three hooks the companion uses.
* Key events reach native mods as **Android key codes** (`PreloaderInput`), which
  is why the keybind setting is a numeric code and not a key name.

Because of the `.so` requirement, the *script* part of this mod cannot be a
`.levipack` on its own. Both halves ship side by side:

```
dist/StasisPivot.mcaddon                            <- behaviour + resource pack
dist/StasisPivot-1.0.0-arm64-v8a.levipack           <- native companion (CI)
```

## Version bumps

When Minecraft moves to a new drop:

1. Check which `@minecraft/server` / `@minecraft/server-ui` versions are stable
   for it (`npm view @minecraft/server dist-tags` and the version's changelog).
2. Raise `min_engine_version` in both manifests **only** if a required API
   moved; otherwise leave the floor low so older builds keep working.
3. Update `SERVER_DEP` / `SERVER_UI_DEP` in `tools/package.py` — validation
   fails if the manifests and the packaging script disagree.
4. Run `./scripts/check.sh`; it validates manifests, script imports, item and
   particle JSON, texture references and the C++ companion in one pass.

## Script ↔ native boundary (why the overlay is opt-in)

Bedrock's scripting API has no filesystem or interop access, and the Preloader
SDK exposes no scripting bridge. The two halves therefore ship as two halves:

| Direction | Mechanism | State |
| --- | --- | --- |
| Pack → companion | `data/overlay.json` + `data/clear` mailbox | implemented and unit-tested (`tests/json_reader_test.cpp`); needs a host that can write the file |
| Companion → pack | `data/trigger` flag file | implemented; the pack polls it every 5 Hz |
| Either, on stock MC | action-bar panel + in-game toggle/keybind | works today |

The action-bar panel and the in-game menu are therefore not a fallback that
should be deleted once the bridge exists: they are the only path that works on
a stock client, and they exercise the same `layout.js` code the overlay does, so
the two cannot drift apart.

## Building the native half without the Android NDK

The official NDK lives on `dl.google.com`, which is not reachable from every
sandbox or CI runner. `scripts/build_ndk_less.sh` produces an equivalent
arm64-v8a library from reachable pieces:

| Piece | Source | Why |
| --- | --- | --- |
| Compiler | PyPI `ziglang` (clang + lld) | Cross-compiles AArch64 from x86-64 |
| bionic headers | `github.com/gubaojian/sysroot` | Real `libc`, `jni.h`, `android/log.h` |
| Kernel uapi headers | Zig's bundled libc | `asm/`, `linux/`, missing from that sysroot |
| C++ runtime | `libc++_shared.so` (undefined at link) | Matches the NDK's `c++_shared`; resolves from the game's own copy |

Four details cost real debugging time and are worth keeping:

1. **Compile as `aarch64-linux-android`, but link as `aarch64-linux-gnu`.**
   Compiling with the android target defines `__ANDROID__`, which makes bionic's
   headers declare `stat`/`sscanf` instead of glibc's `__xstat`/
   `__isoc99_sscanf`. Those two symbols do not exist on Android and a single
   unresolved one makes the loader reject the whole library. Zig 0.17 cannot
   *link* for the android target without bionic stub libraries, hence the split.
2. **Do not link a private libc++.** Zig's own `libc++.a` is built against
   glibc headers and reintroduces exactly those imports. Leaving the `std::`
   symbols undefined against `libc++_shared.so` is both smaller (50 KB vs 8 MB)
   and correct.
3. **The Preloader headers include `<fmt/format.h>`.** A native mod does not
   link fmt, so `levipack/src/fmt_shim/fmt/format.h` provides declarations only
   (never definitions) and is placed first on the include path.
4. **`nm -D` is not enough.** A linker can emit a hash table that omits
   symbols, so `tools/verify_so.py` walks the GNU hash the way `dlsym` does
   before a build is accepted.

The result still needs a device test: this path proves the ELF is well formed
and resolvable, not that the Mod Menu renders.
