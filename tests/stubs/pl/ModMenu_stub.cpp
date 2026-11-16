// Host-only implementation of the Mod Menu stub: records every call the mod
// makes instead of talking to a real Preloader.

#include <pl/Mod.hpp>
#include <pl/ModMenu.hpp>

#include <mutex>

namespace pl::modmenu::test {

Recorder &mutableRecorder() {
  static Recorder instance;
  return instance;
}

std::mutex &recorderMutex() {
  static std::mutex instance;
  return instance;
}

Recorder &recorder() { return mutableRecorder(); }

Recorder snapshot() {
  std::lock_guard<std::mutex> lock(test::recorderMutex());
  return mutableRecorder();
}

void reset() {
  std::lock_guard<std::mutex> lock(test::recorderMutex());
  mutableRecorder() = Recorder{};
}

ModuleInfo g_held;

bool fireToggle(bool enabled) {
  if (g_held.moduleId.empty() || !g_held.onToggle) return false;
  g_held.onToggle(g_held.moduleId, enabled);
  return true;
}

bool fireKeybind(const std::string &key, bool isDown) {
  if (g_held.moduleId.empty() || !g_held.onKeybind) return false;
  g_held.onKeybind(g_held.moduleId, key, isDown);
  return true;
}

} // namespace pl::modmenu::test

namespace pl::modmenu {

bool registerModule(const ModuleInfo &info) {
  std::lock_guard<std::mutex> lock(test::recorderMutex());
  auto &rec = test::recorder();
  rec.moduleRegistered = true;
  rec.moduleId = info.moduleId;
  rec.moduleName = info.displayName;
  rec.moduleModId = info.modId;
  rec.defaultEnabled = info.defaultEnabled;
  rec.configs = info.configs;
  test::g_held = info;
  return true;
}

void unregisterModule(std::string_view) {
  std::lock_guard<std::mutex> lock(test::recorderMutex());
  test::recorder().moduleUnregistered = true;
  test::g_held = ModuleInfo{};
}

void submitDrawCommands(std::string_view, std::span<const DrawCommand> commands) {
  std::lock_guard<std::mutex> lock(test::recorderMutex());
  auto &rec = test::recorder();
  rec.lastFrame.assign(commands.begin(), commands.end());
  ++rec.submittedFrames;
}

bool setConfigSchemaJson(std::string_view, std::string_view) { return true; }
void clearConfigSchema(std::string_view) {}
void submitHudEditorElements(std::string_view, std::span<const HudEditorElement>) {}
HudSurfaceSize getHudSurfaceSize() { return {1920.0f, 1080.0f}; }
bool registerFont(std::string_view, std::span<const unsigned char>) { return true; }
bool registerImage(std::string_view, std::span<const unsigned char>, int, int) { return true; }
bool registerButton(const ButtonInfo &) { return true; }
void unregisterButton(std::string_view) {}
void requestOpenMenu() {}
void requestCloseMenu() {}
bool setFloatingMenuButtonVisible(bool) { return true; }

} // namespace pl::modmenu

namespace pl::mod {

NativeMod *NativeMod::current() noexcept { return nullptr; }

} // namespace pl::mod
