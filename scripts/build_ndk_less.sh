#!/usr/bin/env bash
# Build the native companion mod (libstasis_pivot.so) WITHOUT the Android NDK.
#
# The official NDK is a ~1 GB download from dl.google.com, which is not
# reachable from every CI runner or sandbox. This script reaches the same
# result with pieces that are on PyPI and GitHub:
#
#   * Zig (PyPI `ziglang`) is the C/C++ compiler: clang + lld, AArch64 target.
#   * bionic headers come from github.com/gubaojian/sysroot (libc, jni.h,
#     android/log.h). Kernel uapi headers are merged in from Zig's own libc.
#   * The standard library is Zig's libc++ (NDK 27 also ships libc++, so the
#     ABI matches: libc++_shared.so / c++_static).
#   * tools/elf_fixup.py turns the result into something bionic can dlopen.
#
# Requirements: python3, curl, tar, ~1.5 GB of scratch space, network access to
# pypi.org, codeload.github.com and files.pythonhosted.org.
#
#   scripts/build_ndk_less.sh                 # -> dist/native/libstasis_pivot.so
#   STASIS_PIVOT_OUT=out/so scripts/build_ndk_less.sh
#
# The result is verified (machine type, exported registration symbol, bionic
# sonames, 16 KiB pages) and is a drop-in for tools/make_levipack.py. It is
# NOT a substitute for testing on a device: CI still does a real NDK build with
# .github/workflows/build.yml when dl.google.com is available.
set -euo pipefail
cd "$(dirname "$0")/.."

# Pinned inputs, so the build is repeatable.
ZIG_VERSION="${ZIG_VERSION:-0.13.0}"          # 0.13 still ships a libc++/libunwind that cross-builds this way
ZIGLANG="${ZIGLANG:-0.17.1}"                  # used for the AArch64 link (its libunwind needs no libc headers)
SYSROOT_REPO="${SYSROOT_REPO:-gubaojian/sysroot}"
SYSROOT_REF="${SYSROOT_REF:-master}"
ANDROID_API="${ANDROID_API:-26}"
OUT_DIR="${STASIS_PIVOT_OUT:-dist/native}"
WORK="${STASIS_PIVOT_WORK:-${TMPDIR:-/tmp}/stasis-pivot-build}"
MODULE=libstasis_pivot.so

say() { printf '  %s\n' "$*"; }
step() { printf '\n== %s ==\n' "$*"; }

step "toolchains"
mkdir -p "$WORK/tc" "$WORK/zig-0.13"
if [ ! -x "$WORK/tc/bin/python" ]; then
  python3 -m venv "$WORK/tc"
  "$WORK/tc/bin/pip" install --quiet --disable-pip-version-check "ziglang==$ZIGLANG" "ziglang==$ZIG_VERSION" 2>/dev/null || {
    # two ziglang versions cannot coexist in one venv: install separately
    python3 -m venv "$WORK/zig-0.13"
    "$WORK/zig-0.13/bin/pip" install --quiet --disable-pip-version-check "ziglang==$ZIG_VERSION"
    "$WORK/tc/bin/pip" install --quiet --disable-pip-version-check "ziglang==$ZIGLANG"
  }
fi
ZIG_CC_PY="$WORK/tc/bin/python"       # ziglang 0.17: link only
ZIG_LIB_PY="${ZIG_LIB_PY:-}"
if [ ! -x "$WORK/zig-0.13/bin/python" ] && [ -x "$WORK/tc/bin/python" ]; then
  ZIG_LIB_PY="$WORK/tc/bin/python"
elif [ -x "$WORK/zig-0.13/bin/python" ]; then
  ZIG_LIB_PY="$WORK/zig-0.13/bin/python"
fi
say "compile+link compiler: $(PYTHONPATH=$("$ZIG_CC_PY" -c 'import site;print(site.getsitepackages()[0])') "$ZIG_CC_PY" -m ziglang version 2>/dev/null || echo '?')"
ZIGLIB_DIR="$("$ZIG_CC_PY" -c 'import ziglang,os;print(os.path.dirname(ziglang.__file__))')"

step "bionic sysroot"
SYS="$WORK/sysroot"
if [ ! -f "$SYS/include/stdio.h" ]; then
  rm -rf "$SYS" "$WORK/sysroot.tar.gz"
  curl -sSL --max-time 300 -o "$WORK/sysroot.tar.gz" \
    "https://codeload.github.com/$SYSROOT_REPO/tar.gz/refs/heads/$SYSROOT_REF"
  mkdir -p "$SYS"
  tar -xzf "$WORK/sysroot.tar.gz" -C "$SYS" --strip-components=1
fi
INC="$WORK/include"
rm -rf "$INC"; mkdir -p "$INC"
cp -r "$SYS/usr/include/." "$INC/"
# Kernel uapi headers (asm/, linux/, asm-generic/) are not part of this sysroot.
cp -rn "$ZIGLIB_DIR/lib/libc/include/any-linux-any/." "$INC/" 2>/dev/null || true
cp -rn "$ZIGLIB_DIR/lib/libc/include/aarch64-linux-any/." "$INC/" 2>/dev/null || true
say "headers: $(ls "$INC" | wc -l) entries, jni.h=$(test -f "$INC/jni.h" && echo yes)"

# bionic added pthread_cond_clockwait in API 30; the extracted headers are older
# and libc++'s <condition_variable> cannot compile without the declaration.
cat > "$INC/stasispivot_ndk_compat.h" <<'EOF'
#pragma once
/* Build-only shim: see scripts/build_ndk_less.sh. Declared, never defined;
   the symbol is resolved from the device's libc.so at load time. */
#if defined(__ANDROID__) && !defined(_PTHREAD_COND_CLOCKWAIT_DECLARED)
#define _PTHREAD_COND_CLOCKWAIT_DECLARED 1
#include <time.h>
#ifdef __cplusplus
extern "C" {
#endif
int pthread_cond_clockwait(pthread_cond_t *__cond, pthread_mutex_t *__mutex,
                           clockid_t __clock, const struct timespec *__abstime);
#ifdef __cplusplus
}
#endif
#endif
EOF
python3 - "$INC/pthread.h" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
if "stasispivot_ndk_compat" not in s:
    p.write_text(s.replace("#include <sys/cdefs.h>",
                           "#include <sys/cdefs.h>\n#include <stasispivot_ndk_compat.h>", 1))
PY

step "compile"
# Compiling must use the *android* target even though the link uses gnu: the
# target sets __ANDROID__, which makes the bionic headers emit plain `stat` /
# `sscanf` instead of glibc's `__xstat` / `__isoc99_sscanf`. Those two do not
# exist in bionic and would make the library fail to load.
CFLAGS=(
  -target aarch64-linux-android
  -D__ANDROID_API__="$ANDROID_API"
  -std=c++20 -O2 -fPIC -fvisibility=hidden -fvisibility-inlines-hidden
  -fstack-protector-strong -ffunction-sections -fdata-sections
  -I levipack/src/fmt_shim
  -isystem "$INC"
  -I vendor/preloader-android/include
)
OBJ="$WORK/obj"; rm -rf "$OBJ"; mkdir -p "$OBJ"
for source in levipack/src/StasisPivot.cpp levipack/src/preloader_stub.cpp; do
  obj="$OBJ/$(basename "${source%.cpp}").o"
  "$ZIG_CC_PY" -m ziglang c++ "${CFLAGS[@]}" -c "$source" -o "$obj"
  say "compiled $source -> $(basename "$obj") ($(stat -c%s "$obj") bytes)"
done

step "link"
mkdir -p "$OUT_DIR" "$WORK/stublib"
# Match the NDK's cxx_shared model: leave the libc++ symbols undefined and let
# Android resolve them from the libc++_shared.so that LeviLauncher/Minecraft
# already ship. Linking a private copy of libc++ instead drags in glibc-only
# imports (__xstat, __isoc99_sscanf) that bionic does not have, and the loader
# rejects the whole library over one missing symbol. A stub with the right
# SONAME is enough to link against.
cat > "$WORK/stub.cpp" <<'EOF'
extern "C" int __stasis_pivot_anchor(void) { return 0; }
EOF
if [ ! -f "$WORK/stublib/libc++_shared.so" ]; then
  "$ZIG_CC_PY" -m ziglang c++ -target aarch64-linux-gnu -shared -fPIC -nostdlib++ \
    -Wl,-soname,libc++_shared.so -o "$WORK/stublib/libc++_shared.so" "$WORK/stub.cpp"
fi

# -Wl,-z,max-page-size: 16 KiB segments, required for arm64 on Android 15+.
"$ZIG_CC_PY" -m ziglang c++ -target aarch64-linux-gnu -shared -O2 -s -nostdlib++ \
  -Wl,--no-as-needed -L"$WORK/stublib" -lc++_shared \
  -Wl,--gc-sections -Wl,-soname,"$MODULE" -Wl,-z,now -Wl,-z,relro \
  -Wl,-z,max-page-size=16384 \
  -o "$OUT_DIR/$MODULE" "$OBJ"/*.o
say "linked $OUT_DIR/$MODULE ($(stat -c%s "$OUT_DIR/$MODULE") bytes)"

step "make it bionic-loadable"
python3 tools/elf_fixup.py "$OUT_DIR/$MODULE"

step "verify"
# Emulates bionic's dlsym, which is stricter than readelf: a linker can emit a
# GNU hash table that does not cover every export, and then the Preloader's
# dlsym(PLGetModRegistration) silently returns null.
python3 tools/verify_so.py "$OUT_DIR/$MODULE"

step "done"
say "$OUT_DIR/$MODULE"
say "package it with: python3 tools/make_levipack.py $OUT_DIR/$MODULE"
