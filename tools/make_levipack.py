#!/usr/bin/env python3
"""Assemble a LeviLauncher `.levipack` from a compiled companion library.

LeviLauncher only loads native mods, so a `.levipack` needs a real `.so`
(see docs/COMPATIBILITY.md). This script copies the manifest, icon and config
schema next to a built library and zips the folder with the exact layout the
launcher expects::

    stasis_pivot/
      manifest.json
      icon.png
      libstasis_pivot.so
      config/config.json
      config/config.schema.json

Usage::

    python3 tools/make_levipack.py path/to/libstasis_pivot.so
    python3 tools/make_levipack.py build/libstasis_pivot.so --out dist/
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEVIPACK = ROOT / "levipack"
DIST = ROOT / "dist"


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("library", type=Path, help="compiled libstasis_pivot.so")
    parser.add_argument("--out", type=Path, default=DIST, help="output directory")
    parser.add_argument("--check", action="store_true", help="validate only")
    args = parser.parse_args(argv)

    library = args.library
    if not library.is_file():
        fail(f"no such library: {library}")
    if library.suffix != ".so":
        fail(f"expected a .so, got {library.name}")

    manifest = json.loads((LEVIPACK / "manifest.json").read_text(encoding="utf-8"))
    mod_id = manifest.get("id", "")
    entry = manifest.get("entry", "")
    if manifest.get("type") != "preload-native":
        fail("levipack/manifest.json must be type preload-native")
    if not mod_id or not entry.endswith(".so"):
        fail("levipack/manifest.json needs an id and a .so entry")
    if entry != library.name:
        fail(f"manifest entry is {entry}, but the library is {library.name}")

    icon = ROOT / "assets" / "icon.png"
    if not icon.is_file():
        fail("assets/icon.png is missing; run tools/make_textures.py")

    contents = [
        (LEVIPACK / "manifest.json", "manifest.json"),
        (icon, "icon.png"),
        (library, entry),
    ]
    for extra in sorted((LEVIPACK / "config").glob("*.json")):
        contents.append((extra, f"config/{extra.name}"))

    target = args.out / f"StasisPivot-{manifest['version']}-{_abi(library)}.levipack"
    print(f"levipack: {len(contents)} files, mod id {mod_id}")
    if args.check:
        print("validation only: nothing written")
        return 0

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source, name in contents:
            archive.write(source, f"{mod_id}/{name}")
    print(f"  {target.relative_to(ROOT) if target.is_relative_to(ROOT) else target} "
          f"({target.stat().st_size / 1024:.1f} KiB)")
    return 0


def _abi(library: Path) -> str:
    """Best effort ABI tag, for the file name only."""
    header = library.read_bytes()[:64]
    machine = {183: "arm64-v8a", 40: "armeabi-v7a", 62: "x86_64", 3: "x86"}.get(
        header[18] if len(header) > 19 else 0
    )
    return machine or "unknown"


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
