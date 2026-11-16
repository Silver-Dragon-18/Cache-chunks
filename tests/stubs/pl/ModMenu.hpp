// Host-only stub of the Mod Menu API, mirroring the real signatures.
#pragma once
#include <cstdint>
#include <functional>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace pl::modmenu {

enum class ConfigType { Toggle, SliderInt, SliderFloat, Radio, Color, Keybind, Text, Button };
enum class ButtonBehavior { Click, Hold, Toggle };
enum class ButtonEvent { Click, Down, Up, StateChanged, Scroll };
enum class ButtonStylePreset { Keycap, Accent };
enum class ButtonIconFormat { Auto, Png, Webp, Svg, Resource };
enum class DrawCommandType { Text, Rect, Line, RectFilled, CircleFilled, TriangleFilled, Image };

struct ConfigEntry {
  std::string key;
  std::string displayName;
  ConfigType type{};
  std::string defaultValue;
  std::string minValue;
  std::string maxValue;
  std::string dependsOn;
};

struct ModuleInfo {
  std::string moduleId;
  std::string displayName;
  std::string description;
  std::string modId;
  bool defaultEnabled{};
  bool hideInHudEditor{};
  std::vector<ConfigEntry> configs;
  std::function<void(std::string_view, bool)> onToggle;
  std::function<void(std::string_view, std::string_view, std::string_view)> onConfigChanged;
  std::function<void(std::string_view, std::string_view, bool)> onKeybind;
};

struct DrawCommand {
  DrawCommandType type{};
  float x{};
  float y{};
  float w{};
  float h{};
  float x3{};
  float y3{};
  uint32_t color{};
  float size{};
  std::string text;
  std::string fontId;
  std::string imageId;
};

struct HudEditorElement {
  std::string elementId;
  std::string displayName;
};

struct HudSurfaceSize {
  float width{};
  float height{};
};

bool registerModule(const ModuleInfo &info);
void unregisterModule(std::string_view moduleId);
bool setConfigSchemaJson(std::string_view moduleId, std::string_view schemaJson);
void clearConfigSchema(std::string_view moduleId);
void submitDrawCommands(std::string_view moduleId, std::span<const DrawCommand> commands);
void submitHudEditorElements(std::string_view moduleId, std::span<const HudEditorElement> elements);
HudSurfaceSize getHudSurfaceSize();
bool registerFont(std::string_view fontId, std::span<const unsigned char> ttfData);
bool registerImage(std::string_view imageId, std::span<const unsigned char> imageData, int width, int height);
struct ButtonInfo {};

bool registerButton(const ButtonInfo &info);
void unregisterButton(std::string_view buttonId);
void requestOpenMenu();
void requestCloseMenu();
bool setFloatingMenuButtonVisible(bool visible);

class ModuleBuilder {
public:
  ModuleBuilder(std::string moduleId, std::string displayName) {
    mInfo.moduleId = std::move(moduleId);
    mInfo.displayName = std::move(displayName);
  }

  ModuleBuilder &description(std::string value) { mInfo.description = std::move(value); return *this; }
  ModuleBuilder &modId(std::string value) { mInfo.modId = std::move(value); return *this; }
  ModuleBuilder &defaultEnabled(bool value) { mInfo.defaultEnabled = value; return *this; }
  ModuleBuilder &hideInHudEditor(bool value = true) { mInfo.hideInHudEditor = value; return *this; }

  ModuleBuilder &onToggle(std::function<void(std::string_view, bool)> callback) {
    mInfo.onToggle = std::move(callback);
    return *this;
  }

  ModuleBuilder &onConfigChanged(
      std::function<void(std::string_view, std::string_view, std::string_view)> callback) {
    mInfo.onConfigChanged = std::move(callback);
    return *this;
  }

  ModuleBuilder &onKeybind(std::function<void(std::string_view, std::string_view, bool)> callback) {
    mInfo.onKeybind = std::move(callback);
    return *this;
  }

  ModuleBuilder &config(std::string key, std::string displayName, ConfigType type,
                        std::string defaultValue = {}, std::string minValue = {},
                        std::string maxValue = {}, std::string dependsOn = {}) {
    mInfo.configs.push_back(ConfigEntry{std::move(key), std::move(displayName), type,
                                        std::move(defaultValue), std::move(minValue),
                                        std::move(maxValue), std::move(dependsOn)});
    return *this;
  }

  [[nodiscard]] bool registerModule() const { return pl::modmenu::registerModule(mInfo); }

private:
  ModuleInfo mInfo;
};

} // namespace pl::modmenu
