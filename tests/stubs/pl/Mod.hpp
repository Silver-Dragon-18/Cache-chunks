// Host-only stub of the Preloader mod API (the real header needs <jni.h> and
// libfmt). Only the surface used by levipack/src/StasisPivot.cpp.
#pragma once
#include <filesystem>
#include <string>

#define PL_EXPORT __attribute__((visibility("default")))

namespace pl::mod {

struct ModRegistration {
  void *instance{};
};

class NativeMod {
public:
  [[nodiscard]] static NativeMod *current() noexcept;
};

struct ModContext {
  [[nodiscard]] const std::filesystem::path &dataDir() const { return mData; }
  [[nodiscard]] const std::string &id() const { return mId; }

  std::filesystem::path mData;
  std::string mId;
};

} // namespace pl::mod

#define PL_REGISTER_MOD(TYPE, INSTANCE_EXPR)                                          \
  extern "C" PL_EXPORT ::pl::mod::ModRegistration *PLGetModRegistration() {           \
    static ::pl::mod::ModRegistration registration{};                                 \
    (void)sizeof(TYPE);                                                               \
    return &registration;                                                             \
  }
