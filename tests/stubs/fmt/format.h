// Host-only stub of libfmt, just enough for pl/Logger.hpp to parse.
#pragma once
#include <string>
#include <string_view>

namespace fmt {
using string_view = std::string_view;

struct format_args {};

template <typename... Args>
format_args make_format_args(Args &&...) { return {}; }

inline std::string vformat(string_view, format_args) { return {}; }
} // namespace fmt
