// Host-only stub of <android/log.h> so the companion mod's C++ can be
// compile-checked with a PC compiler (see scripts/check.sh). The shipped mod
// uses the NDK's real header.
#pragma once
#include <cstdarg>

#define ANDROID_LOG_DEBUG 3
#define ANDROID_LOG_INFO 4
#define ANDROID_LOG_WARN 5
#define ANDROID_LOG_ERROR 6

static inline int __android_log_print(int, const char *, const char *, ...) { return 0; }
static inline int __android_log_vprint(int, const char *, const char *, va_list) { return 0; }
