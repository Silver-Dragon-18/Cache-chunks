#!/usr/bin/env bash
# Runs every check in this repository:
#   * host unit tests for the script pack's maths/layout (node)
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
else
  echo "no C++ compiler ($CXX): skipping the companion checks" >&2
fi

echo
echo "all checks passed"
