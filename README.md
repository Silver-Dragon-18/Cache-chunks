# StasisPivot

A Minecraft **Bedrock 1.26.60+** mod for LeviLauncher that turns any block into a
measurement origin ("the source"). Tap once, and a hologram-style marker is
placed under your feet; from then on a custom outlined coordinate panel shows
the source's **X Y Z** plus **S**, your straight-line distance from it, exactly
like a customised version of the vanilla coordinate readout.

```
┌──────────────────────────────┐
│ STASIS PIVOT   120 64 -8     │
│ X 120   Y 64   Z -8   S 13.00│
│ dX +3.00  dY +4.00  dZ +12.00│
└──────────────────────────────┘
```

Everything in the frame is configurable: outline colour, thickness and corner
radius, background colour and transparency, and the colour of every value.

---

## What you get

| Feature | Where it lives |
| --- | --- |
| Tap-to-place source block, stored per player and per dimension | `addon/StasisPivot/scripts/pivot.js` |
| Custom X Y Z S coordinate panel with a rounded, coloured outline | `scripts/layout.js`, `scripts/hud.js` |
| Particle "hologram" column + locator-bar waypoint on the source | `scripts/markers.js`, `addon/StasisPivotRP/particles/` |
| Full settings menu (toggles, sliders, colour picker, keybind) | `scripts/menu.js`, `scripts/config.js` |
| Mod-hide / master toggle, optional keybind | `config.js` (`enabled`, `keybind_keycode`) |
| LeviLauncher native companion (HUD overlay renderer + keybind) | `levipack/`, `CMakeLists.txt` |

Tap the item, press the keybind, run `/stasispivot set`, or use
**Mod Menu → Stasis Pivot → Set source here** — all four paths place the source
and the panel appears immediately.

---

## Install

### 1. The mod itself (works on any Bedrock 1.26.60+ install)

`dist/StasisPivot.mcaddon` contains both packs. Either open the file (Minecraft
or LeviLauncher can import it), or copy the folders:

```
com.mojang/behavior_packs/StasisPivot/      <- addon/StasisPivot/
com.mojang/resource_packs/StasisPivotRP/    <- addon/StasisPivotRP/
```

Then, **per world**: Settings → Add-Ons → activate **StasisPivot** (the
resource pack comes along as a dependency) and enable **Beta APIs** if your
build asks for it. No other experiment is required.

The pack declares `min_engine_version 1.26.60` and depends on
`@minecraft/server 2.10.0` + `@minecraft/server-ui 2.1.0`, the stable script
versions that ship with 1.26.60. See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)
for the version matrix and for the fallbacks that keep it working on 1.26.43+.

### 2. The Lev Menu integration (LeviLauncher native companion)

`.levipack` packages on LeviLauncher are **native-only**: the launcher accepts a
manifest of `type: "preload-native"` plus exactly one `.so`
(`ModManager.parseDirectoryMod`), so the menu entry, the toggle and the keybind
need a native library. That library is `levipack/src/StasisPivot.cpp`:

* it registers a **Mod Menu module** (`stasispivot_hud`) with
  * a **toggle** that hides/shows the whole mod (the "mod-hide" switch),
  * a **Keybind** control whose captured Android key code is forwarded to the
    pack through the `trigger` file (see below),
  * sliders for panel scale and screen position;
* it converts a panel frame into `pl::modmenu::DrawCommand` primitives and
  submits them, which is the only way to get a **true rounded outline,
  arbitrary `#RRGGBB` colours and alpha** in the Levi HUD instead of the
  §-code approximation.

> **Read this before expecting the overlay.** Bedrock's script API has no
> filesystem access, so the pack cannot hand a frame to a native mod by itself.
> The companion reads `data/overlay.json` and polls `data/trigger` only when a
> **host bridge** writes those files (that is what `scripts/levi.js`'s
> `globalThis.StasisPivotBindOverlay` hook and the mailbox constants describe).
> On a stock Minecraft install nothing writes them, the companion stays idle,
> and the pack's action-bar panel is what you see. The Mod Menu toggle/keybind
> and the overlay renderer are therefore opt-in infrastructure: correct and
> tested, but inert until Minecraft or a launcher exposes a script↔native
> bridge. Everything the mod *promises* — source block, X Y Z S, outlined
> customisable panel, toggle, keybind — works today without it.

Build it (CI does this automatically on every push, see
`.github/workflows/build.yml`):

```bash
export ANDROID_NDK_HOME=/path/to/android-ndk-r28
cmake -B build -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 \
  -DANDROID_STL=c++_shared -DCMAKE_BUILD_TYPE=Release
cmake --build build          # -> build/libstasis_pivot.so
```

Package and install the `.levipack` by zipping the folder exactly as laid out in
`dist/levipack/` (the build step above drops `libstasis_pivot.so` next to
`manifest.json`), then LeviLauncher → Mods → Add Mod → pick the `.levipack`.

> Without the companion the mod is still fully functional: the panel is drawn
> through the action bar and the toggle/keybind live in the in-game menu
> (`/stasispivot menu`). The companion adds the native Mod Menu surface.

---

## Using it

1. Craft or grab **Stasis Pivot** (Creative → Items) or run `/give @s stasispivot:pivot`.
2. **Tap** while holding it (or press your keybind / run `/stasispivot set`):
   the source block becomes the block under your feet, and `X Y Z` in the panel
   is that block — it *is* the `0 0 0` of the measurement, so `dX dY dZ` is
   always your offset from it and `S` is the distance.
3. Walk away and watch the panel update 5× per second.
4. Tap again to move the source (or turn off "Set source only once" in the menu
   if you prefer to place once and keep it).

| Command | Permission | Cheats | What it does |
| --- | --- | --- | --- |
| `/stasispivot:set` | any player | not required | set the source to the block below you |
| `/stasispivot:menu` | any player | not required | open the settings menu |
| `/stasispivot:clear` | any player | not required | forget the source |

Minecraft registers the namespaced command and an un-namespaced alias, so
`/stasispivot set` works in chat too.

### Settings

All settings exist in three places and stay in sync (they are one value in the
world's dynamic properties):

* **Levi Mod Menu** (native companion) — toggle, keybind, scale/position.
* **In-game menu** — `/stasispivot menu`, every key below.
* **Dynamic properties** — `stasispivot:settings` (JSON), for backups.

| Group | Keys |
| --- | --- |
| Mod | `enabled`, `persist_source`, `auto_snap`, `pivot_on_every_tap`, `remember_dimension` |
| Panel | `hud_enabled`, `hud_always`, `hud_max_distance`, `hud_scale`, `hud_offset_x`, `hud_offset_y`, `hud_show_header`, `hud_show_distance`, `hud_show_delta`, `hud_outline_width`, `hud_corner_radius`, `hud_actionbar`, `hud_actionbar_stacked` |
| Colours | `hud_outline_color`, `hud_outline_alpha`, `hud_bg_color`, `hud_bg_alpha`, `hud_color_x`, `hud_color_y`, `hud_color_z`, `hud_color_s`, `hud_color_delta`, `hud_color_text`, `hud_color_header` |
| World | `beam_enabled`, `waypoint_enabled`, `waypoint_color`, `waypoint_texture`, `chat_feedback`, `tap_sound` |
| Keybind | `keybind_keycode` (Android key code, `0` = none) |

Colours are stored as `#RRGGBB`, the same format the Levi colour controls and
the in-game hex field use. The panel's §-code fallback is picked automatically
as the closest match.

---

## How the pieces talk

```
 addon/StasisPivot (script pack)                  levipack (native companion)
 ──────────────────────────────                  ────────────────────────────
 pivot.js  ── source ──►  layout.js ── frame ──► data/overlay.json
                            │                        │
                            │                        ▼
                    hud.js (action bar)      StasisPivot.cpp JsonReader
                                                     │
                                                     ▼
                                        pl::modmenu::submitDrawCommands
```

* `layout.js` produces the frame once and both transports consume it: the
  action bar (`toActionBar`, always available) and the overlay command list
  (`toOverlayCommands`). `levi.js` forwards the latter to whatever transport is
  bound, and degrades to a no-op when nothing is.
* The companion implements the mailbox half (`overlay.json`, `clear`,
  `trigger`) for hosts that can write it; see the note above. The pack still
  handles a hardware key through its own `keybind_keycode` setting, so the
  "optional keybind" requirement does not depend on the bridge.

---

## Repository layout

```
addon/StasisPivot/            behaviour pack (manifest, scripts/, items/, texts/)
addon/StasisPivotRP/          resource pack (particles/, textures/, item atlas)
levipack/                     native companion (manifest, config, C++ source)
vendor/preloader-android/     vendored Preloader headers (MIT, LiteLDev)
tools/make_textures.py        procedural PNG generation (stdlib only)
tools/package.py              validation + .mcaddon/.mcpack builds
scripts/check.sh              runs every check in one go
tests/layout_test.mjs         host tests: maths, layout, colours, config
tests/json_reader_test.cpp    host tests: companion overlay JSON reader
```

### Development

```bash
./scripts/check.sh                 # tests + pack validation + packaging
python3 tools/package.py --check   # validation only
node tests/layout_test.mjs         # script maths/layout only
```

Host tests run without Minecraft: the measured maths, panel layout and colour
mapping live in modules with no engine imports, which is what makes them
testable and keeps them from drifting.

---

## Limits worth knowing

* **Bedrock cannot draw rectangles in normal text.** On a vanilla client the
  outline is drawn with box-drawing characters and § colours; the true
  rounded/alpha outline is the Levi overlay renderer in the companion mod.
* **Touch "tap" detection.** The script API does not expose camera deltas, so a
  tap is accepted when the item's use completes (`onUse` → `onCompleteUse`).
  Dragging the camera mid-press cancels the completion, which is the intended
  "look, don't place" behaviour.
* **No blocks are placed.** The source is virtual: nothing is written to the
  world, so it cannot be lost, griefed or left behind.
* **One pivot per player per dimension** while "Per-dimension source" is on.

## License

MIT. Preloader headers under `vendor/` are MIT, © LiteLDev.
