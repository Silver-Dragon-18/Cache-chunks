#!/usr/bin/env python3
"""Generates every PNG shipped by the StasisPivot packages.

Everything is drawn procedurally with the standard library (zlib + struct), so
the repository has no binary asset pipeline and every image is reproducible:

    python3 tools/make_textures.py

Outputs
    addon/StasisPivotRP/textures/particle/stasispivot.png   16x16 particle sprite
    addon/StasisPivotRP/textures/items/stasis_pivot.png     32x32 item icon
    assets/icon.png                                        512x512 mod icon
    assets/addon_icon.png                                  256x256 pack icon
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CYAN = (0, 229, 255)
TEAL = (0, 140, 170)
GOLD = (255, 214, 90)
DARK = (12, 16, 22)
WHITE = (255, 255, 255)


def png(path: Path, width: int, height: int, pixel) -> None:
    """Writes an RGBA PNG; `pixel(x, y)` returns (r, g, b, a)."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    print(f"wrote {path.relative_to(ROOT)} ({width}x{height})")


def mix(a, b, t: float):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def soft_disc(x: float, y: float, cx: float, cy: float, radius: float, feather: float = 1.0) -> float:
    distance = math.hypot(x - cx, y - cy)
    return max(0.0, min(1.0, (radius - distance) / max(feather, 1e-6)))


def particle_texture(path: Path) -> None:
    size = 16
    centre = (size - 1) / 2

    def pixel(x, y):
        glow = soft_disc(x, y, centre, centre, 7.5, 1.6)
        core = soft_disc(x, y, centre, centre, 3.2, 1.2)
        ring = abs(math.hypot(x - centre, y - centre) - 5.6)
        ring_alpha = max(0.0, min(1.0, (1.4 - ring) / 1.4))
        alpha = max(glow * 0.55, core, ring_alpha * 0.85)
        if alpha <= 0.02:
            return (0, 0, 0, 0)
        rgb = mix(TEAL, WHITE, core)
        rgb = mix(rgb, CYAN, glow * 0.6)
        return (*rgb, round(alpha * 255))

    png(path, size, size, pixel)


def item_icon(path: Path) -> None:
    size = 32
    centre = (size - 1) / 2

    def pixel(x, y):
        # Dark rounded plate so the icon reads on the hotbar.
        plate = soft_disc(x, y, centre, centre, 14.0, 1.4)
        if plate <= 0.02:
            return (0, 0, 0, 0)
        base = mix(DARK, (24, 34, 44), plate)

        # Outline ring.
        ring_distance = abs(math.hypot(x - centre, y - centre) - 11.5)
        ring = max(0.0, min(1.0, (1.5 - ring_distance) / 1.5))

        # Stasis diamond in the middle.
        diamond = max(0.0, 1.0 - (abs(x - centre) + abs(y - centre)) / 7.0)
        diamond_core = max(0.0, 1.0 - (abs(x - centre) + abs(y - centre)) / 4.2)

        # Small cardinal ticks, like a coordinate marker.
        ticks = 0.0
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            tx, ty = centre + dx * 13.2, centre + dy * 13.2
            ticks = max(ticks, soft_disc(x, y, tx, ty, 1.7, 1.0))

        rgb = base
        rgb = mix(rgb, TEAL, ring * 0.9)
        rgb = mix(rgb, CYAN, diamond * 0.95)
        rgb = mix(rgb, WHITE, diamond_core * 0.9)
        rgb = mix(rgb, GOLD, ticks)
        return (*rgb, round(255 * plate))

    png(path, size, size, pixel)


def mod_icon(path: Path, size: int) -> None:
    centre = (size - 1) / 2

    def pixel(x, y):
        # Radial gradient background.
        distance = math.hypot(x - centre, y - centre) / centre
        background = mix((16, 22, 30), (4, 8, 12), min(1.0, distance))
        rgb = background

        # Outer rounded square frame.
        edge = max(abs(x - centre), abs(y - centre))
        frame = max(0.0, min(1.0, (edge - (centre - size * 0.06)) / max(1.0, size * 0.02)))
        frame_inner = max(0.0, min(1.0, ((centre - size * 0.10) - edge) / max(1.0, size * 0.02)))
        rgb = mix(rgb, CYAN, frame * (1.0 - frame_inner) * 0.9)

        # Concentric pulse rings around the centre.
        for index, radius in enumerate((0.30, 0.42, 0.54)):
            ring_distance = abs(math.hypot(x - centre, y - centre) - radius * size)
            ring = max(0.0, min(1.0, (size * 0.008 - ring_distance) / (size * 0.008)))
            rgb = mix(rgb, CYAN if index != 1 else TEAL, ring * (0.85 - index * 0.22))

        # Crosshair axis lines (the X / Z plane of a coordinate readout).
        arm = size * 0.30
        line = max(0.0, min(1.0, (size * 0.007 - abs(y - centre)) / (size * 0.007))) * (
            1.0 if abs(x - centre) < arm else 0.0
        )
        line += max(0.0, min(1.0, (size * 0.007 - abs(x - centre)) / (size * 0.007))) * (
            1.0 if abs(y - centre) < arm else 0.0
        )
        rgb = mix(rgb, WHITE, min(1.0, line) * 0.35)

        # Gold pivot diamond with a white core.
        diamond = max(0.0, 1.0 - (abs(x - centre) + abs(y - centre)) / (size * 0.14))
        core = max(0.0, 1.0 - (abs(x - centre) + abs(y - centre)) / (size * 0.07))
        rgb = mix(rgb, GOLD, diamond)
        rgb = mix(rgb, WHITE, core)

        # Corner brackets: the "outlined panel" motif.
        bracket_len = size * 0.16
        bracket = 0.0
        for sx in (-1, 1):
            for sy in (-1, 1):
                bx = centre + sx * (centre - size * 0.09)
                by = centre + sy * (centre - size * 0.09)
                horizontal = (abs(y - by) < size * 0.012) and (abs(x - bx) < bracket_len) and (
                    (x - bx) * sx <= 0
                )
                vertical = (abs(x - bx) < size * 0.012) and (abs(y - by) < bracket_len) and (
                    (y - by) * sy <= 0
                )
                if horizontal or vertical:
                    bracket = 1.0
        rgb = mix(rgb, CYAN, bracket)

        return (*rgb, 255)

    png(path, size, size, pixel)


def main() -> None:
    particle_texture(ROOT / "addon/StasisPivotRP/textures/particle/stasispivot.png")
    item_icon(ROOT / "addon/StasisPivotRP/textures/items/stasis_pivot.png")
    mod_icon(ROOT / "assets/icon.png", 512)
    mod_icon(ROOT / "assets/addon_icon.png", 256)
    mod_icon(ROOT / "addon/StasisPivot/pack_icon.png", 256)
    mod_icon(ROOT / "addon/StasisPivotRP/pack_icon.png", 256)


if __name__ == "__main__":
    main()
