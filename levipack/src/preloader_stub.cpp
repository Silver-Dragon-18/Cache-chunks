// Build-time stub of the pl:: runtime.
//
// LeviLauncher injects libpreloader.so into the Minecraft process, so this mod
// only needs to *link* against the pl:: symbols; the launcher's copy is
// resolved at load time from the global symbol scope. The definitions below
// exist so the produced .so has exactly the undefined-symbol surface the
// launcher provides, and so the library can be linked (and smoke tested) on a
// PC build host without the Preloader SDK's runtime.
//
// Keep this list in sync with levipack/src/StasisPivot.cpp.
//
// Logging is the one exception: pl::log::Logger is header-only and pulls in
// libfmt, which is compiled into this library rather than resolved at runtime.
// The mod therefore logs through `__android_log_print` directly and never
// instantiates a Logger.

#include <pl/Mod.hpp>
#include <pl/ModMenu.hpp>
#include <pl/ModMenuConfig.hpp>

#include <string_view>

namespace pl::mod {

NativeMod *NativeMod::current() noexcept { return nullptr; }

} // namespace pl::mod

namespace pl::modmenu {

bool registerModule(const ModuleInfo &) { return false; }

void unregisterModule(std::string_view) {}

void submitDrawCommands(std::string_view, std::span<const DrawCommand>) {}

bool setConfigSchemaJson(std::string_view, std::string_view) { return false; }

void clearConfigSchema(std::string_view) {}

void submitHudEditorElements(std::string_view, std::span<const HudEditorElement>) {}

HudSurfaceSize getHudSurfaceSize() { return {}; }

bool registerFont(std::string_view, std::span<const unsigned char>) { return false; }

bool registerImage(std::string_view, std::span<const unsigned char>, int, int) { return false; }

bool registerButton(const ButtonInfo &) { return false; }

void unregisterButton(std::string_view) {}

void requestOpenMenu() {}

void requestCloseMenu() {}

bool setFloatingMenuButtonVisible(bool) { return false; }

} // namespace pl::modmenu
