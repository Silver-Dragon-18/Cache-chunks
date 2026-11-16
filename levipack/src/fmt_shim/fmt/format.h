#pragma once

// Minimal stand-in for libfmt, for the Preloader SDK headers only.
//
// Why this exists
// ---------------
// Every Preloader header pulls in <pl/Logger.hpp> (through <pl/Mod.hpp>), and
// that header calls fmt::vformat / fmt::string_view / fmt::make_format_args
// inside a *template*. The templates are never instantiated by this mod -- it
// logs through <android/log.h> -- but they must still *parse*, which means the
// names have to exist.
//
// The Preloader links fmt 11.2.0 into libpreloader.so. A native mod is a
// separate shared library and does not get that dependency, and pulling the
// real fmt into the .so would duplicate the formatter for no reason. So this
// file declares the three names the SDK header uses and nothing else.
//
// Rules
// -----
// * Never define fmt::format / vformat here. Calling them must stay a link
//   error, so this shim can never silently become "the fmt implementation".
// * If a future change actually needs formatting (e.g. pl::log::Logger), build
//   against real fmt instead: see STASIS_PIVOT_WITH_FMT in CMakeLists.txt.
// * Keep this file dependency-free: it is parsed before every other header.

#include <string>
#include <string_view>

namespace fmt {

using string_view = std::string_view;

/// Opaque stand-in for fmt::format_args.
struct format_args {};

/// Opaque stand-in for fmt::make_format_args. Declared, never defined: it is
/// only ever named inside uninstantiated templates.
template <typename... Args> format_args make_format_args(Args &&...args);

/// Opaque stand-in for fmt::vformat. Declared, never defined, on purpose.
std::string vformat(string_view format, format_args args);

} // namespace fmt
