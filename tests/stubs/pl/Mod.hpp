// Host-only stub of the Preloader mod API, with just enough behaviour to test
// the companion's lifecycle (levipack/src/StasisPivot.cpp) on a PC.
//
// The real header needs <jni.h> and libfmt; this one records what the mod does
// so tests can assert on it. See tests/mod_lifecycle_test.cpp.
#pragma once

#include <filesystem>
#include <string>
#include <utility>

#define PL_EXPORT __attribute__((visibility("default")))

namespace pl::mod {

/// Everything the preloader would hand a mod when loading it.
struct ModInfo {
  std::string id;
  std::string displayName;
  std::filesystem::path modRootPath;
};

class NativeMod {
public:
  [[nodiscard]] static NativeMod *current() noexcept;
};

class ModContext {
public:
  ModContext() = default;
  explicit ModContext(std::filesystem::path root) {
    mInfo.modRootPath = std::move(root);
  }

  [[nodiscard]] const ModInfo &info() const noexcept { return mInfo; }
  [[nodiscard]] const std::string &id() const noexcept { return mInfo.id; }
  [[nodiscard]] const std::filesystem::path &modRootPath() const noexcept { return mInfo.modRootPath; }
  [[nodiscard]] std::filesystem::path dataDir() const { return mInfo.modRootPath / "data"; }
  [[nodiscard]] std::filesystem::path configDir() const { return mInfo.modRootPath / "config"; }

  ModInfo mInfo;
};

/// Mirrors pl::mod::ModRegistration: type-erased lifecycle dispatch.
using LifecycleFunction = bool (*)(void *instance, ModContext &context);

struct ModRegistration {
  void *instance{};
  LifecycleFunction load{};
  LifecycleFunction enable{};
  LifecycleFunction disable{};
  LifecycleFunction unload{};
};

} // namespace pl::mod

// The real macro builds the dispatch table from the mod's optional lifecycle
// methods. The stub calls them directly so a test can drive the same sequence
// the preloader would.
#define PL_REGISTER_MOD(TYPE, INSTANCE_EXPR)                                              \
  namespace {                                                                             \
  TYPE &plRegisteredModInstance() {                                                       \
    static TYPE &instance = (INSTANCE_EXPR);                                              \
    return instance;                                                                      \
  }                                                                                       \
  }                                                                                       \
  extern "C" PL_EXPORT ::pl::mod::ModRegistration *PLGetModRegistration() {               \
    static ::pl::mod::ModRegistration registration{                                       \
        .instance = &plRegisteredModInstance(),                                           \
        .load = [](void *i, ::pl::mod::ModContext &c) {                                   \
          return static_cast<TYPE *>(i)->load(c);                                         \
        },                                                                                \
        .enable = [](void *i, ::pl::mod::ModContext &c) {                                 \
          return static_cast<TYPE *>(i)->enable(c);                                       \
        },                                                                                \
        .disable = [](void *i, ::pl::mod::ModContext &) {                                 \
          return static_cast<TYPE *>(i)->disable();                                       \
        },                                                                                \
        .unload = [](void *i, ::pl::mod::ModContext &) {                                  \
          return static_cast<TYPE *>(i)->unload();                                        \
        },                                                                                \
    };                                                                                    \
    return &registration;                                                                 \
  }
