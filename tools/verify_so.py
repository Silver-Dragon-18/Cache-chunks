"""Verify that an AArch64 `.so` is loadable by Android's linker.

This emulates what bionic actually does, so it catches problems a plain
`readelf` run would not:

* GNU-hash lookup of every exported symbol -- specifically
  ``PLGetModRegistration``, the entry point the Preloader ``dlsym``s. A linker
  can emit a hash table that silently does not cover a symbol, which makes the
  mod look like it has no entry point at all.
* ``DT_NEEDED`` names: desktop sonames such as ``libc.so.6`` do not exist on
  Android.
* Versioned symbols (``DT_VERNEED``/``DT_VERDEF``): bionic exports unversioned
  symbols and refuses to bind a versioned import.
* 16 KiB ``PT_LOAD`` alignment, required for arm64 from Android 15.
* Segment sanity: every dynamic pointer must land inside a mapped segment.

Deliberately section-header free: the loader only reads program headers, and
tools/elf_fixup.py drops the section table.

Usage::

    python3 tools/verify_so.py dist/native/libstasis_pivot.so
    python3 tools/verify_so.py --expect-symbol MyEntry lib.so

Exits non-zero and prints what is wrong when the library would not load.
"""

from __future__ import annotations

import argparse
import struct
import sys

EM_AARCH64 = 183
ET_DYN = 3

PT_LOAD = 1
PT_DYNAMIC = 2
PT_TLS = 7
PT_GNU_RELRO = 0x6474E552

DT_NULL = 0
DT_NEEDED = 1
DT_HASH = 4
DT_STRTAB = 5
DT_SYMTAB = 6
DT_STRSZ = 10
DT_SONAME = 14
DT_VERDEF = 0x6FFFFFFC
DT_VERNEED = 0x6FFFFFFE
DT_GNU_HASH = 0x6FFFFEF5

PAGE = 0x4000
DESKTOP_SONAMES = {"libc.so.6", "libpthread.so.0", "librt.so.1", "libdl.so.2",
                   "libm.so.6", "libstdc++.so.6", "libgcc_s.so.1"}

# Symbol names that exist in glibc but not in bionic. Importing any of them
# makes the library fail to load on Android with an "cannot locate symbol"
# message, so they are checked explicitly.
GLIBC_ONLY = {
    "__xstat", "__xstat64", "__lxstat", "__lxstat64", "__fxstat", "__fxstat64",
    "__isoc99_sscanf", "__isoc99_fscanf", "__isoc99_scanf",
    "__errno_location", "__ctype_get_mb_cur_max", "gnu_get_libc_version",
    "__libc_start_main", "secure_getenv", "__stack_chk_fail_local",
}


class Library:
    def __init__(self, path: str) -> None:
        self.path = path
        self.data = open(path, "rb").read()
        if self.data[:4] != b"\x7fELF":
            raise SystemExit(f"error: {path} is not an ELF file")
        if self.data[4] != 2 or self.data[5] != 1:
            raise SystemExit(f"error: {path} is not 64-bit little-endian")
        self.e_type, self.e_machine = struct.unpack_from("<HH", self.data, 16)
        phoff, = struct.unpack_from("<Q", self.data, 32)
        phentsize, phnum = struct.unpack_from("<HH", self.data, 54)
        self.phdrs = []
        for index in range(phnum):
            fields = struct.unpack_from("<IIQQQQQQ", self.data, phoff + index * phentsize)
            self.phdrs.append(
                {
                    "type": fields[0],
                    "flags": fields[1],
                    "offset": fields[2],
                    "vaddr": fields[3],
                    "filesz": fields[5],
                    "memsz": fields[6],
                    "align": fields[7],
                }
            )
        dynamic = next(p for p in self.phdrs if p["type"] == PT_DYNAMIC)
        self.dynamic: dict[int, list[int]] = {}
        for step in range(dynamic["filesz"] // 16):
            tag, value = struct.unpack_from("<qQ", self.data, dynamic["offset"] + step * 16)
            if tag == DT_NULL:
                break
            self.dynamic.setdefault(tag, []).append(value)

    def file_offset(self, vaddr: int) -> int | None:
        for segment in self.phdrs:
            if segment["type"] != PT_LOAD:
                continue
            if segment["vaddr"] <= vaddr < segment["vaddr"] + segment["filesz"]:
                return segment["offset"] + (vaddr - segment["vaddr"])
        return None

    def symbol(self, index: int):
        symtab = self.file_offset(self.dynamic[DT_SYMTAB][0])
        strtab = self.file_offset(self.dynamic[DT_STRTAB][0])
        base = symtab + index * 24
        name_offset, _info, _other, shndx, value, size = struct.unpack_from("<IBBHQQ", self.data, base)
        end = self.data.index(b"\x00", strtab + name_offset)
        return {
            "name": self.data[strtab + name_offset : end].decode("latin1"),
            "defined": shndx != 0,
            "value": value,
            "size": size,
        }

    def symbol_count(self) -> int:
        """Highest symbol index the dynamic tables can reach."""
        if DT_HASH in self.dynamic:
            offset = self.file_offset(self.dynamic[DT_HASH][0])
            _nbucket, nchain = struct.unpack_from("<II", self.data, offset)
            return nchain
        hash_offset = self.file_offset(self.dynamic[DT_GNU_HASH][0])
        nbuckets, symoffset, bloom_size, _shift = struct.unpack_from("<IIII", self.data, hash_offset)
        chain = hash_offset + 16 + bloom_size * 8 + nbuckets * 4
        index = symoffset
        while True:
            value = struct.unpack_from("<I", self.data, chain + (index - symoffset) * 4)[0]
            index += 1
            if value & 1:
                return index
        del hash_offset

    def lookup(self, name: str):
        """Resolve a symbol the way bionic's dlsym does (GNU hash preferred)."""
        if DT_GNU_HASH in self.dynamic:
            return self._gnu_lookup(name)
        return self._sysv_lookup(name)

    def _gnu_hash_value(self, name: str) -> int:
        value = 5381
        for byte in name.encode():
            value = (value * 33 + byte) & 0xFFFFFFFF
        return value

    def _gnu_lookup(self, name: str):
        base = self.file_offset(self.dynamic[DT_GNU_HASH][0])
        nbuckets, symoffset, bloom_size, shift = struct.unpack_from("<IIII", self.data, base)
        bloom = base + 16
        buckets = bloom + bloom_size * 8
        chain = buckets + nbuckets * 4
        value = self._gnu_hash_value(name)
        word = struct.unpack_from("<Q", self.data, bloom + ((value >> 6) % bloom_size) * 8)[0]
        if not (word >> (value % 64)) & 1:
            return None
        index = struct.unpack_from("<I", self.data, buckets + (value % nbuckets) * 4)[0]
        if index < symoffset:
            return None
        delete_shift = shift
        del delete_shift
        for _ in range(1 << 16):
            entry = struct.unpack_from("<I", self.data, chain + (index - symoffset) * 4)[0]
            if (entry | 1) == (value | 1):
                symbol = self.symbol(index)
                if symbol["name"] == name:
                    return index, symbol
            if entry & 1:
                return None
            index += 1
        return None

    def _sysv_lookup(self, name: str):
        base = self.file_offset(self.dynamic[DT_HASH][0])
        nbucket, nchain = struct.unpack_from("<II", self.data, base)
        buckets = base + 8
        chains = buckets + nbucket * 4
        value = self._gnu_hash_value(name)
        index = struct.unpack_from("<I", self.data, buckets + (value % nbucket) * 4)[0]
        for _ in range(nchain + 1):
            if index == 0:
                return None
            symbol = self.symbol(index)
            if symbol["name"] == name:
                return index, symbol
            index = struct.unpack_from("<I", self.data, chains + index * 4)[0]
        return None


def verify(path: str, expect: list[str]) -> bool:
    library = Library(path)
    problems: list[str] = []
    notes: list[str] = []

    if (library.e_type, library.e_machine) != (ET_DYN, EM_AARCH64):
        problems.append(f"not an AArch64 shared object (e_type={library.e_type}, e_machine={library.e_machine})")

    needed = []
    for encoded in library.dynamic.get(DT_NEEDED, []):
        offset = library.file_offset(library.dynamic[DT_STRTAB][0]) + encoded
        end = library.data.index(b"\x00", offset)
        name = library.data[offset:end].decode("latin1")
        if name:
            needed.append(name)
    desktop = sorted(set(needed) & DESKTOP_SONAMES)
    if desktop:
        problems.append(f"needs desktop libraries {desktop}; Android has no such sonames")
    notes.append(f"NEEDED: {', '.join(needed) or '(none)'}")

    if DT_VERNEED in library.dynamic or DT_VERDEF in library.dynamic:
        problems.append("has symbol versioning (DT_VERNEED/DT_VERDEF); bionic values are unversioned")

    for segment in library.phdrs:
        if segment["type"] != PT_LOAD:
            continue
        if segment["align"] < PAGE:
            problems.append(f"PT_LOAD align {segment['align']:#x} < 16 KiB (required on Android 15+)")
            break
        if segment["offset"] + segment["filesz"] > len(library.data):
            problems.append("a PT_LOAD segment extends past the end of the file")
            break

    for tag, label in ((DT_SYMTAB, "DT_SYMTAB"), (DT_STRTAB, "DT_STRTAB"), (DT_GNU_HASH, "DT_GNU_HASH")):
        for vaddr in library.dynamic.get(tag, []):
            if library.file_offset(vaddr) is None:
                problems.append(f"{label} at {vaddr:#x} is not inside any mapped segment")

    exports = []
    imports = []
    for index in range(library.symbol_count()):
        symbol = library.symbol(index)
        if not symbol["name"]:
            continue
        if symbol["defined"]:
            exports.append(symbol["name"])
        elif index != 0:
            imports.append(symbol["name"])
    notes.append(f"{len(exports)} exported, {len(imports)} imported symbols")

    foreign = sorted(set(imports) & GLIBC_ONLY)
    if foreign:
        problems.append(f"imports symbols bionic does not provide: {foreign}")

    for name in expect:
        if library.lookup(name) is None:
            problems.append(f"{name} is not reachable through the hash table; dlsym would return null")
        else:
            notes.append(f"dlsym({name}) resolves")

    for line in notes:
        print(f"  {line}")
    if problems:
        for problem in problems:
            print(f"  FAIL {problem}")
        return False
    print("  ok: loadable by Android")
    return True


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("libraries", nargs="+")
    parser.add_argument("--expect-symbol", action="append", default=[], dest="expect")
    args = parser.parse_args(argv)
    expect = args.expect or ["PLGetModRegistration"]
    results = []
    for path in args.libraries:
        print(f"{path}")
        results.append(verify(path, expect))
        print()
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
