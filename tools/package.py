#!/usr/bin/env python3
"""Packages StasisPivot for Minecraft Bedrock 1.26.60+.

    python3 tools/package.py            # build every artefact into dist/
    python3 tools/package.py --check    # validate packs only, build nothing

Artefacts
    dist/StasisPivot.mcaddon                 behaviour + resource pack in one file
    dist/StasisPivot-BP.mcpack               behaviour pack only (dev installs)
    dist/StasisPivot-RP.mcpack               resource pack only
    dist/levipack/                           contents of a LeviLauncher native
                                             companion mod (see README: it needs
                                             a compiled .so, which is built by
                                             .github/workflows/build.yml and
                                             zipped by tools/make_levipack.py)

Every pack is validated before it is written: manifests parse, UUIDs are
unique and version 4, script entries exist, the script dependency versions are
ones that ship with 1.26.60+, item/particle JSON is valid and every texture the
packs reference is present.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADDON = ROOT / "addon"
BP = ADDON / "StasisPivot"
RP = ADDON / "StasisPivotRP"
DIST = ROOT / "dist"

# Script APIs that ship with 1.26.60 (see docs/COMPATIBILITY.md).
MIN_ENGINE = "1.26.60"
SERVER_DEP = "2.10.0"
SERVER_UI_DEP = "2.1.0"

SKIP_NAMES = {".DS_Store", "Thumbs.db", ".gitkeep"}
SKIP_SUFFIXES = {".pyc", ".zip", ".mcpack", ".mcaddon", ".levipack"}


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def warn(message: str) -> None:
    print(f"warning: {message}")


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing {path.relative_to(ROOT)}")
    except json.JSONDecodeError as error:
        fail(f"{path.relative_to(ROOT)} is not valid JSON: {error}")


def iter_files(root: Path):
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.name in SKIP_NAMES or path.suffix in SKIP_SUFFIXES:
            continue
        yield path


def is_uuid4(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", value))


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def check_manifest(pack_dir: Path, module_types: set[str]) -> dict:
    manifest = read_json(pack_dir / "manifest.json")
    header = manifest.get("header", {})
    if manifest.get("format_version") not in (2, 3):
        fail(f"{pack_dir.name}: manifest format_version must be 2 or 3")
    if str(header.get("min_engine_version", "")) != MIN_ENGINE and header.get("min_engine_version") != [
        int(part) for part in MIN_ENGINE.split(".")
    ]:
        fail(f"{pack_dir.name}: min_engine_version must be {MIN_ENGINE}")
    if not is_uuid4(str(header.get("uuid", ""))):
        fail(f"{pack_dir.name}: header uuid must be a version 4 UUID")

    seen = {header["uuid"]}
    types = set()
    for module in manifest.get("modules", []):
        module_uuid = str(module.get("uuid", ""))
        if not is_uuid4(module_uuid):
            fail(f"{pack_dir.name}: module uuid {module_uuid!r} is not a version 4 UUID")
        if module_uuid in seen:
            fail(f"{pack_dir.name}: duplicate uuid {module_uuid}")
        seen.add(module_uuid)
        types.add(module.get("type"))

        if module.get("type") == "script":
            entry = pack_dir / str(module.get("entry", ""))
            if not entry.is_file():
                fail(f"{pack_dir.name}: script entry {module.get('entry')} does not exist")
            if module.get("language") != "javascript":
                fail(f"{pack_dir.name}: script language must be javascript")

    missing = module_types - types
    if missing:
        fail(f"{pack_dir.name}: missing module types {sorted(missing)}")
    return manifest


def check_script_dependencies(bp_manifest: dict) -> None:
    deps = {dep.get("module_name"): str(dep.get("version")) for dep in bp_manifest.get("dependencies", []) if dep.get("module_name")}
    expected = {"@minecraft/server": SERVER_DEP, "@minecraft/server-ui": SERVER_UI_DEP}
    for name, version in expected.items():
        if deps.get(name) != version:
            fail(f"behaviour pack must depend on {name} {version} (found {deps.get(name)!r})")
    if not any(dep.get("uuid") for dep in bp_manifest.get("dependencies", [])):
        fail("behaviour pack must depend on the resource pack by UUID")


def check_script_imports() -> None:
    """Every relative import must resolve, and no engine module may be missing."""
    scripts = BP / "scripts"
    files = sorted(scripts.glob("*.js"))
    if not files:
        fail("no scripts found")
    for path in files:
        source = path.read_text(encoding="utf-8")
        for match in re.finditer(r'from\s+"(\./[^"]+)"', source):
            target = (path.parent / match.group(1)).resolve()
            if not target.is_file():
                fail(f"{path.name} imports missing {match.group(1)}")
        for match in re.finditer(r'from\s+"(@minecraft/[^"]+)"', source):
            if match.group(1) not in ("@minecraft/server", "@minecraft/server-ui"):
                fail(f"{path.name} imports unsupported module {match.group(1)}")
        # A syntax slip in a script only shows up in game, so let node parse
        # every file here as well.
        try:
            subprocess.run(
                ["node", "--input-type=module", "--check"],
                input=source.encode("utf-8"),
                check=True,
                capture_output=True,
            )
        except FileNotFoundError:
            pass
        except subprocess.CalledProcessError as error:
            fail(f"{path.name} does not parse: {error.stderr.decode('utf-8', 'replace').strip()}")


def check_items() -> None:
    items_dir = BP / "items"
    if not items_dir.is_dir():
        fail("behaviour pack has no items/ folder")
    for path in sorted(items_dir.glob("*.json")):
        data = read_json(path)
        item = data.get("minecraft:item")
        if not item:
            fail(f"{path.name}: missing minecraft:item")
        description = item.get("description", {})
        identifier = str(description.get("identifier", ""))
        if not re.fullmatch(r"[a-z0-9_]+:[a-z0-9_]+", identifier):
            fail(f"{path.name}: identifier {identifier!r} must be namespace:name")
        if "components" not in item:
            fail(f"{path.name}: components object is required")
        components = item.get("components", {})
        custom = components.get("minecraft:custom_components")
        if not custom:
            fail(f"{path.name}: minecraft:custom_components is required for a scripted item")
        icon = components.get("minecraft:icon")
        if icon is not None:
            texture = RP / "textures" / "item_texture.json"
            atlas = read_json(texture)
            if icon not in atlas.get("texture_data", {}):
                fail(f"{path.name}: icon {icon!r} is not in item_texture.json")
            image = RP / f"{atlas['texture_data'][icon]['textures']}.png"
            if not image.is_file():
                fail(f"{path.name}: icon texture {image.name} is missing")


def check_particles() -> None:
    particles_dir = RP / "particles"
    if not particles_dir.is_dir():
        fail("resource pack has no particles/ folder")
    identifiers = set()
    for path in sorted(particles_dir.glob("*.json")):
        data = read_json(path)
        effect = data.get("particle_effect", {})
        identifier = str(effect.get("description", {}).get("identifier", ""))
        if not re.fullmatch(r"[a-z0-9_]+:[a-z0-9_]+", identifier):
            fail(f"{path.name}: identifier {identifier!r} must be namespace:name")
        identifiers.add(identifier)
        texture = str(effect.get("description", {}).get("basic_render_parameters", {}).get("texture", ""))
        if texture and not (RP / f"{texture}.png").is_file():
            fail(f"{path.name}: texture {texture}.png is missing")
        if "components" not in effect:
            fail(f"{path.name}: components are required")

    scripts = "\n".join(path.read_text(encoding="utf-8") for path in (BP / "scripts").glob("*.js"))
    for match in re.finditer(r'spawnParticle\(\s*"([^"]+)"', scripts):
        if match.group(1) not in identifiers:
            fail(f"script spawns unknown particle {match.group(1)}")


def check_lang() -> None:
    for pack in (BP, RP):
        lang = pack / "texts" / "en_US.lang"
        if not lang.is_file():
            fail(f"{pack.name}: texts/en_US.lang is missing")
        entries = dict(
            line.split("=", 1) for line in lang.read_text(encoding="utf-8").splitlines() if "=" in line
        )
        for key in ("name", "description"):
            pack_key = f"pack.{'stasispivotrp' if pack is RP else 'stasispivot'}.{key}"
            if pack_key not in entries:
                fail(f"{pack.name}: {pack_key} missing from en_US.lang")

    # Item display name key must exist for the item identifier.
    item_lang = (BP / "texts" / "en_US.lang").read_text(encoding="utf-8")
    if "item.stasispivot:pivot=" not in item_lang:
        fail("behaviour pack en_US.lang must define item.stasispivot:pivot")


def check_shared_uuids() -> None:
    """The BP must depend on the RP that actually ships next to it."""
    bp_manifest = read_json(BP / "manifest.json")
    rp_manifest = read_json(RP / "manifest.json")
    rp_uuid = rp_manifest["header"]["uuid"]
    if not any(dep.get("uuid") == rp_uuid for dep in bp_manifest.get("dependencies", [])):
        fail("behaviour pack dependency UUID does not match the resource pack header UUID")

    all_uuids = [bp_manifest["header"]["uuid"], rp_manifest["header"]["uuid"]]
    all_uuids += [module["uuid"] for module in bp_manifest["modules"]]
    all_uuids += [module["uuid"] for module in rp_manifest["modules"]]
    if len(set(all_uuids)) != len(all_uuids):
        fail("UUIDs must be unique across both packs")


def validate() -> None:
    print("validating packs…")
    bp_manifest = check_manifest(BP, {"data", "script"})
    check_manifest(RP, {"resources"})
    check_script_dependencies(bp_manifest)
    check_script_imports()
    check_items()
    check_particles()
    check_lang()
    check_shared_uuids()
    check_levipack_manifest()
    print("  manifests, scripts, items, particles, lang: ok")


def check_levipack_manifest() -> None:
    """The native manifest has to agree with what CMake and the docs produce."""
    manifest = read_json(ROOT / "levipack" / "manifest.json")
    if manifest.get("type") != "preload-native":
        fail("levipack/manifest.json: type must be preload-native")
    if manifest.get("schema_version") != 1:
        fail("levipack/manifest.json: schema_version must be 1")
    mod_id = manifest.get("id", "")
    if not mod_id or not re.fullmatch(r"[a-z0-9_]+", mod_id):
        fail("levipack/manifest.json: id must be lowercase letters, digits or _")
    # CMake builds lib<id>.so from target stasis_pivot (OUTPUT_NAME stasis_pivot),
    # so the entry name is fixed by the build, not by preference.
    if manifest.get("entry") != f"lib{mod_id}.so":
        fail(f"levipack/manifest.json: entry must be lib{mod_id}.so")
    if not manifest.get("minecraft_versions"):
        fail("levipack/manifest.json: minecraft_versions must not be empty")
    for extra in ("config/config.json", "config/config.schema.json"):
        if not (ROOT / "levipack" / extra).is_file():
            fail(f"levipack/{extra} is missing")


# ---------------------------------------------------------------------------
# Packaging
# ---------------------------------------------------------------------------


def write_zip(target: Path, entries) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source, name in entries:
            archive.write(source, name)
    size = target.stat().st_size
    print(f"  {target.relative_to(ROOT)} ({size / 1024:.1f} KiB)")


def pack_pack(pack_dir: Path, target: Path, root: str | None = None) -> None:
    entries = []
    for path in iter_files(pack_dir):
        relative = path.relative_to(pack_dir).as_posix()
        entries.append((path, f"{root}/{relative}" if root else relative))
    write_zip(target, entries)


def package() -> None:
    DIST.mkdir(exist_ok=True)
    print("building…")

    pack_pack(BP, DIST / "StasisPivot-BP.mcpack")
    pack_pack(RP, DIST / "StasisPivot-RP.mcpack")

    entries = []
    for pack_dir, folder in ((BP, "StasisPivot"), (RP, "StasisPivotRP")):
        for path in iter_files(pack_dir):
            entries.append((path, f"{folder}/{path.relative_to(pack_dir).as_posix()}"))
    write_zip(DIST / "StasisPivot.mcaddon", entries)

    # Contents of the LeviLauncher native companion package. The .so itself is
    # produced by the Android build; this mirrors the documented layout so the
    # manifest can be reviewed before an .levipack is assembled.
    levipack = DIST / "levipack"
    levipack.mkdir(exist_ok=True)
    manifest = read_json(ROOT / "levipack" / "manifest.json")
    (levipack / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    icon = ROOT / "assets" / "icon.png"
    if icon.is_file():
        (levipack / "icon.png").write_bytes(icon.read_bytes())
    (levipack / "README.txt").write_text(
        "Drop libstasis_pivot.so built by .github/workflows/build.yml next to this\n"
        "manifest.json, then zip the folder as StasisPivot-<version>-arm64-v8a.levipack.\n",
        encoding="utf-8",
    )
    print(f"  {levipack.relative_to(ROOT)}/manifest.json")


def main(argv: list[str]) -> int:
    validate()
    if "--check" in argv:
        print("validation only: nothing written")
        return 0
    package()
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
