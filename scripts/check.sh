#!/usr/bin/env bash
# Runs every check in this repository:
#   * host unit tests for the script pack's maths/layout (node)
#   * behaviour tests that execute the pack against a recording mock engine
#   * pack validation + packaging (python)
#   * host compile check of the native companion mod (g++)
#   * host unit tests of the companion's overlay JSON reader
#
#   ./scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null; then
  echo "node is required for the script tests" >&2
  exit 1
fi

echo "== script pack tests =="
node tests/layout_test.mjs

echo
echo "== behaviour tests (the pack runs against a mock engine) =="
node tests/behaviour_test.mjs

echo
echo "== pack validation and packaging =="
python3 tools/make_textures.py >/dev/null
python3 tools/package.py

echo
echo "== native companion =="
BUILD_DIR="${TMPDIR:-/tmp}/stasis-pivot-check"
mkdir -p "$BUILD_DIR"

CXX="${CXX:-g++}"
if command -v "$CXX" >/dev/null; then
  CXXFLAGS=(-std=c++20 -O1 -Wall -Wextra -Werror -I tests/stubs -pthread)
  "$CXX" "${CXXFLAGS[@]}" -fsyntax-only levipack/src/StasisPivot.cpp
  "$CXX" "${CXXFLAGS[@]}" levipack/src/preloader_stub.cpp -c -o "$BUILD_DIR/preloader_stub.o"
  "$CXX" "${CXXFLAGS[@]}" tests/json_reader_test.cpp -o "$BUILD_DIR/json_reader_test"
  "$BUILD_DIR/json_reader_test"

  echo
  echo "   lifecycle (runs the mod against a stubbed Mod Menu)"
  "$CXX" "${CXXFLAGS[@]}" tests/mod_lifecycle_test.cpp \
    tests/stubs/pl/ModMenu_stub.cpp -o "$BUILD_DIR/mod_lifecycle_test"
  "$BUILD_DIR/mod_lifecycle_test"

  # The mod polls files on its own thread, so a data race is a real defect and
  # worth a second build with ThreadSanitizer when it is available.
  if "$CXX" -std=c++20 -O1 -g -fsanitize=thread -I tests/stubs -pthread \
      tests/mod_lifecycle_test.cpp tests/stubs/pl/ModMenu_stub.cpp \
      -o "$BUILD_DIR/mod_lifecycle_tsan" 2>/dev/null; then
    echo
    echo "   lifecycle under ThreadSanitizer"
    "$BUILD_DIR/mod_lifecycle_tsan" | tail -1
  else
    echo "   (ThreadSanitizer unavailable, skipped)"
  fi
else
  echo "no C++ compiler ($CXX): skipping the companion checks" >&2
fi

echo
echo "all checks passed"
