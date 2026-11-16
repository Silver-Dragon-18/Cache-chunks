// Host test of the companion mod's lifecycle, end to end.
//
// This is the only place the native mod is *executed* rather than compiled: it
// drives the same sequence the Preloader uses (load -> enable -> toggle ->
// keybind -> disable -> unload) and asserts on what the mod hands to the Mod
// Menu API, plus what it does with the mailbox files the script pack writes.
//
// scripts/check.sh runs this; to build it by hand, compile
// tests/mod_lifecycle_test.cpp together with tests/stubs/pl/ModMenu_stub.cpp and
// link -pthread.

#include <chrono>
#include <functional>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>

#include <pl/Mod.hpp>
#include <pl/ModMenu.hpp>

// The mod has no header of its own: it is a self-contained translation unit, so
// the test compiles it in with its own export-table macro disabled.
#define STASIS_PIVOT_HOST_TEST 1
#include "../levipack/src/StasisPivot.cpp"

namespace fs = std::filesystem;
namespace menu_test = pl::modmenu::test;

namespace {

int g_failures = 0;

void expect(bool condition, const std::string &what) {
  if (condition) {
    std::printf("  ok   %s\n", what.c_str());
  } else {
    std::printf("  FAIL %s\n", what.c_str());
    ++g_failures;
  }
}

/// Waits for the mod's worker thread to observe a file change. Polling is 40 ms,
/// so this is generous without making a failing case slow.
bool wait_for(const std::function<bool()> &condition, int timeout_ms = 2000) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
  while (std::chrono::steady_clock::now() < deadline) {
    if (condition()) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  return condition();
}

void write_file(const fs::path &path, const std::string &contents) {
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  stream << contents;
}

/// A frame as the script pack's layout.js serialises it.
std::string frame_json() {
  return R"({"version":1,"commands":[)"
         R"({"op":"rect","x":6,"y":6,"w":150,"h":30,"color":2415919352},)"
         R"({"op":"line","x":6,"y":6,"x3":156,"y3":6,"color":4294967295,"size":2},)"
         R"({"op":"text","x":10,"y":9,"text":"X 120  Y 64  Z -8  S 13.16","color":4278255615,"size":1})"
         R"(]})";
}

} // namespace

int main() {
  using namespace stasis_pivot;

  const fs::path root = fs::temp_directory_path() / "stasis-pivot-lifecycle";
  fs::remove_all(root);
  fs::create_directories(root / "data");

  pl::mod::ModContext context(root);

  // ---- registration and load -------------------------------------------------
  std::printf("lifecycle\n");
  auto &mod = StasisPivotCompanion::instance();

  expect(mod.load(context), "load() succeeds");
  expect(fs::exists(root / "data"), "load() created the data directory");

  // ---- enable: the module the Mod Menu will show ----------------------------
  expect(mod.enable(context), "enable() succeeds");
  const auto rec = menu_test::snapshot();
  expect(rec.moduleRegistered, "enable() registered a Mod Menu module");
  expect(rec.moduleId == "stasispivot_hud", "module id is stasispivot_hud");
  expect(rec.moduleModId == "stasis_pivot", "module is attributed to the mod id");
  expect(rec.moduleName == "Stasis Pivot", "module has a display name");
  expect(rec.defaultEnabled, "module defaults to enabled");

  bool has_scale = false;
  bool has_keybind = false;
  for (const auto &config : rec.configs) {
    if (config.key == "hudScale" && config.type == pl::modmenu::ConfigType::SliderFloat) has_scale = true;
    if (config.key == "hudX" && config.type == pl::modmenu::ConfigType::SliderInt) has_scale = true;
    if (config.key == "hudY" && config.type == pl::modmenu::ConfigType::SliderInt) has_scale = true;
    if (config.key == "triggerKey" && config.type == pl::modmenu::ConfigType::Keybind) has_keybind = true;
  }
  expect(rec.configs.size() == 4, "module exposes 4 configs (3 sliders + keybind)");
  expect(has_scale, "scale and position sliders are registered");
  expect(has_keybind, "a Keybind control is registered");

  // ---- overlay frames -------------------------------------------------------
  write_file(root / "data" / "overlay.json", frame_json());
  expect(wait_for([] { return menu_test::snapshot().submittedFrames > 0; }),
         "a written overlay.json is picked up by the worker");
  // Re-read after the wait: `rec` was captured before the worker ran.
  const auto frame = menu_test::snapshot().lastFrame;
  expect(frame.size() == 3, "the frame's three commands are forwarded");
  const bool three = frame.size() == 3;
  expect(three && frame[0].type == pl::modmenu::DrawCommandType::RectFilled,
         "a rect becomes RectFilled (the panel background)");
  expect(three && frame[1].type == pl::modmenu::DrawCommandType::Line,
         "a line becomes Line (the outline)");
  expect(three && frame[2].type == pl::modmenu::DrawCommandType::Text,
         "text becomes Text (the coordinate row)");
  expect(three && frame[2].text == "X 120  Y 64  Z -8  S 13.16",
         "the coordinate text reaches the overlay unchanged");
  expect(three && frame[2].color == 0xFF00FFFFu, "colours keep their alpha and RGB");

  // ---- malformed frames are rejected, not drawn ----------------------------
  const auto frames_before = menu_test::snapshot().submittedFrames;
  const auto last_kept = menu_test::snapshot().lastFrame.size();
  write_file(root / "data" / "overlay.json", R"({"version":1,"commands":[{"op":"rect",)"
                                             R"("x":1e300,"y":0,"color":1}]})");
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  expect(menu_test::snapshot().submittedFrames == frames_before,
         "an absurd coordinate is discarded instead of drawn");
  expect(menu_test::snapshot().lastFrame.size() == last_kept,
         "the previous good frame is not replaced by a bad one");

  // ---- the clear flag -------------------------------------------------------
  {
    std::ofstream flag(root / "data" / "clear", std::ios::trunc);
    flag << "1";
  }
  expect(wait_for([] { return menu_test::snapshot().lastFrame.empty(); }),
         "the clear flag blanks the overlay");
  expect(!fs::exists(root / "data" / "clear"), "the clear flag is consumed");

  // ---- toggle: the "mod-hide" switch ---------------------------------------
  write_file(root / "data" / "overlay.json", frame_json());
  expect(wait_for([] { return !menu_test::snapshot().lastFrame.empty(); }), "frame drawn again");
  expect(menu_test::fireToggle(false), "the toggle callback is wired");
  expect(wait_for([] { return menu_test::snapshot().lastFrame.empty(); }),
         "turning the module off clears the overlay");
  write_file(root / "data" / "overlay.json", frame_json());
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  expect(menu_test::snapshot().lastFrame.empty(),
         "while disabled, new frames are ignored");

  expect(menu_test::fireToggle(true), "the toggle can turn it back on");
  write_file(root / "data" / "overlay.json", frame_json());
  expect(wait_for([] { return !menu_test::snapshot().lastFrame.empty(); }),
         "re-enabling resumes drawing");

  // ---- keybind: forwards to the pack through the trigger flag ---------------
  expect(fs::exists(root / "data" / "overlay.json"), "mailbox lives in the data dir");
  fs::remove(root / "data" / "trigger");
  expect(menu_test::fireKeybind("KEYCODE_F", true), "the keybind callback is wired");
  expect(fs::exists(root / "data" / "trigger"),
         "a keybind press writes the trigger flag the pack polls");
  fs::remove(root / "data" / "trigger");
  menu_test::fireKeybind("KEYCODE_F", false);
  expect(!fs::exists(root / "data" / "trigger"),
         "a key release does not write the trigger flag");

  // ---- disable / unload -----------------------------------------------------
  expect(mod.disable(), "disable() succeeds");
  expect(wait_for([] { return menu_test::snapshot().lastFrame.empty(); }),
         "disable() clears the overlay");
  expect(mod.unload(), "unload() succeeds");
  expect(menu_test::snapshot().moduleUnregistered, "unload() unregisters the module");

  // A second load/enable cycle must work: the preloader can toggle a mod off and
  // on within one session, and a stale worker thread would break that.
  menu_test::reset();
  expect(mod.load(context) && mod.enable(context), "the mod can be loaded again");
  write_file(root / "data" / "overlay.json", frame_json());
  expect(wait_for([] { return menu_test::snapshot().submittedFrames > 0; }),
         "the worker restarts cleanly after a reload");
  mod.disable();
  mod.unload();

  fs::remove_all(root);

  if (g_failures == 0) {
    std::printf("\nall lifecycle tests passed\n");
    return 0;
  }
  std::printf("\n%d lifecycle tests failed\n", g_failures);
  return 1;
}
