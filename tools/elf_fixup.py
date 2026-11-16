"""Make an AArch64 ELF loadable by Android/bionic.

A real NDK build links against bionic and this script is needed only for the
fallback CI path, where the cross-compiler links against a glibc-flavoured libc
stub. Two things Android's loader rejects come out of that link:

* ``DT_NEEDED`` entries naming desktop sonames (``libc.so.6``,
  ``libpthread.so.0``, ``libdl.so.2``, ``libstdc++.so.6`` ...);
* versioned symbols (``.gnu.version_d`` / ``GLIBC_2.17``). bionic exports
  unversioned symbols and will not bind a versioned import.

Android 15 also requires 16 KiB segment alignment for arm64 libraries.

The rewrite is done by copying the segments into a fresh buffer with each one
moved to its own 16 KiB boundary, rather than sliding them around in place, so
no live bytes can be clobbered. The section header table is dropped: loaders do
not read it, and its offsets would be stale.

Usage::

    python3 tools/elf_fixup.py build/libstasis_pivot.so
    python3 tools/elf_fixup.py --check libstasis_pivot.so     # verify only
"""

from __future__ import annotations

import argparse
import struct
import sys

EM_AARCH64 = 183
ET_DYN = 3

SHT_GNU_VERDEF = 0x6FFFFFFD
SHT_GNU_VERNEED = 0x6FFFFFFE
SHT_GNU_VERSYM = 0x6FFFFFFF

PT_LOAD = 1
PT_DYNAMIC = 2
PT_INTERP = 3
PT_PHDR = 6
PT_TLS = 7
PT_GNU_RELRO = 0x6474E552
PT_GNU_EH_FRAME = 0x6474E550
PT_GNU_STACK = 0x6474E551

DT_NULL = 0
DT_NEEDED = 1
DT_STRTAB = 5
DT_VERNEED = 0x6FFFFFFE
DT_VERNEEDNUM = 0x6FFFFFFF

# Desktop sonames -> the bionic library that provides the same symbols.
SONAME_MAP = {
    b"libc.so.6": b"libc.so",
    b"libpthread.so.0": b"libc.so",
    b"librt.so.1": b"libc.so",
    b"libdl.so.2": b"libdl.so",
    b"libm.so.6": b"libm.so",
    b"libstdc++.so.6": b"libc++_shared.so",
    b"libgcc_s.so.1": b"libc++_shared.so",
}
PAGE = 0x4000


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_phdrs(data: bytes):
    (phoff,) = struct.unpack_from("<Q", data, 32)
    (phentsize, phnum) = struct.unpack_from("<HH", data, 54)
    phdrs = []
    for index in range(phnum):
        base = phoff + index * phentsize
        fields = struct.unpack_from("<IIQQQQQQ", data, base)
        phdrs.append(
            {
                "slot": base,
                "p_type": fields[0],
                "p_flags": fields[1],
                "p_offset": fields[2],
                "p_vaddr": fields[3],
                "p_paddr": fields[4],
                "p_filesz": fields[5],
                "p_memsz": fields[6],
                "p_align": fields[7],
            }
        )
    return phdrs


def dynamic_entries(data: bytes, phdrs):
    for phdr in phdrs:
        if phdr["p_type"] != PT_DYNAMIC:
            continue
        for step in range(phdr["p_filesz"] // 16):
            base = phdr["p_offset"] + step * 16
            tag, value = struct.unpack_from("<qQ", data, base)
            if tag == DT_NULL:
                return
            yield base, tag, value


def vaddr_to_offset(phdrs, vaddr: int) -> int:
    for phdr in phdrs:
        if phdr["p_type"] != PT_LOAD:
            continue
        start = phdr["p_vaddr"]
        if start <= vaddr < start + phdr["p_filesz"]:
            return phdr["p_offset"] + (vaddr - start)
    fail(f"virtual address {vaddr:#x} is not mapped by a PT_LOAD")


def needed_libraries(data: bytes, phdrs):
    string_table = None
    for _base, tag, value in dynamic_entries(data, phdrs):
        if tag == DT_STRTAB:
            string_table = vaddr_to_offset(phdrs, value)
    if string_table is None:
        return []
    names = []
    for _base, tag, value in dynamic_entries(data, phdrs):
        if tag == DT_NEEDED:
            start = string_table + value
            names.append(bytes(data[start : data.index(b"\x00", start)]))
    return names


def check(path: str) -> bool:
    data = open(path, "rb").read()
    (e_type, e_machine) = struct.unpack_from("<HH", data, 16)
    if e_machine != EM_AARCH64:
        fail(f"{path}: expected AArch64 (183), found {e_machine}")
    if e_type != ET_DYN:
        fail(f"{path}: not a shared object (e_type={e_type})")

    phdrs = parse_phdrs(data)
    problems = []
    if any(tag in (DT_VERNEED, DT_VERNEEDNUM) for _b, tag, _v in dynamic_entries(data, phdrs)):
        problems.append("versioned symbols (.gnu.version_r present)")
    desktop = [name for name in needed_libraries(data, phdrs) if name in SONAME_MAP]
    if desktop:
        problems.append(f"desktop sonames: {[n.decode() for n in desktop]}")
    if any(phdr["p_type"] == PT_LOAD and phdr["p_align"] < PAGE for phdr in phdrs):
        problems.append("PT_LOAD alignment below 16 KiB")

    if problems:
        for problem in problems:
            print(f"  {problem}")
        return False
    names = ", ".join(name.decode() for name in needed_libraries(data, phdrs) if name) or "(static)"
    print(f"  ok: AArch64 shared object, NEEDED {names}")
    return True


def repair(path: str) -> None:
    """Re-align file offsets only: virtual addresses never move.

    Keeping ``p_vaddr`` untouched means every pointer in the dynamic table
    (``DT_STRTAB``, ``DT_SYMTAB``, ``DT_RELA`` ...) stays valid, which is what
    makes this safe. Each ``PT_LOAD`` is moved to the first file offset that is
    both past the previous segment and congruent to its virtual address modulo
    16 KiB, so ``p_offset % PAGE == p_vaddr % PAGE`` holds and no other header
    field has to change.
    """
    data = bytearray(open(path, "rb").read())
    phdrs = parse_phdrs(bytes(data))
    (phentsize, phnum) = struct.unpack_from("<HH", data, 54)
    header_end = max(phdr["p_offset"] + phdr["p_filesz"] for phdr in phdrs if phdr["p_type"] == PT_PHDR)

    # --- 1. Sonames and versioning, patched where they currently live.
    string_table = None
    for _base, tag, value in dynamic_entries(bytes(data), phdrs):
        if tag == DT_STRTAB:
            string_table = vaddr_to_offset(phdrs, value)
    if string_table is None:
        fail("no dynamic string table")

    for base, tag, _value in dynamic_entries(bytes(data), phdrs):
        if tag in (DT_VERNEED, DT_VERNEEDNUM):
            struct.pack_into("<q", data, base, DT_NULL)
            struct.pack_into("<Q", data, base + 8, 0)

    # libpthread/librt/libm are all part of bionic's libc.so, so several
    # DT_NEEDED entries collapse onto one name. Blank the duplicates instead of
    # listing libc.so three times.
    seen_targets = set()
    for _base, tag, value in dynamic_entries(bytes(data), phdrs):
        if tag != DT_NEEDED:
            continue
        start = string_table + value
        end = data.index(b"\x00", start)
        name = bytes(data[start:end])
        target = SONAME_MAP.get(name)
        if target is None:
            continue
        if target in seen_targets:
            target = b""
        else:
            seen_targets.add(target)
        if len(target) > len(name):
            fail(f"{target.decode()} does not fit in {name.decode()}")
        data[start : start + len(target)] = target
        for blank in range(start + len(target), end):
            data[blank] = 0

    # --- 2. New file offsets, virtual addresses unchanged.
    out = bytearray(len(data) + PAGE * 8)
    out[:len(data)] = data
    cursor = header_end
    shifts = {}
    loads = [phdr for phdr in phdrs if phdr["p_type"] == PT_LOAD]
    for phdr in loads:
        if phdr["p_offset"] == 0:
            # The first segment has to start at file offset 0 so that the ELF
            # header and program headers are mapped by it.
            new_offset = 0
        else:
            base = max(cursor, (cursor + PAGE - 1) & ~(PAGE - 1))
            new_offset = base + ((phdr["p_vaddr"] - base) % PAGE)
        shifts[phdr["slot"]] = new_offset - phdr["p_offset"]
        cursor = new_offset + phdr["p_filesz"]

    # --- 3. Copy every segment body to its new home, in dependency order.
    ordered = sorted(phdrs, key=lambda phdr: (phdr["p_type"] != PT_LOAD, phdr["p_offset"]))
    originals = {phdr["slot"]: bytes(data[phdr["p_offset"] : phdr["p_offset"] + phdr["p_filesz"]]) for phdr in phdrs}
    for phdr in ordered:
        if phdr["p_type"] not in (PT_LOAD, PT_TLS, PT_GNU_RELRO, PT_GNU_EH_FRAME, PT_DYNAMIC):
            continue
        if phdr["p_type"] == PT_LOAD:
            shift = shifts[phdr["slot"]]
        else:
            shift = 0
            for load in loads:
                if load["p_vaddr"] <= phdr["p_vaddr"] < load["p_vaddr"] + load["p_memsz"]:
                    shift = shifts[load["slot"]]
                    break
        target_offset = phdr["p_offset"] + shift
        body = originals[phdr["slot"]]
        need = target_offset + len(body)
        if need > len(out):
            out.extend(b"\x00" * (need - len(out)))
        out[target_offset : target_offset + len(body)] = body
        phdr["p_offset"] = target_offset
        phdr["p_align"] = PAGE if phdr["p_type"] in (PT_LOAD, PT_GNU_RELRO) else phdr["p_align"]

    for phdr in phdrs:
        struct.pack_into(
            "<IIQQQQQQ", out, phdr["slot"], phdr["p_type"], phdr["p_flags"], phdr["p_offset"],
            phdr["p_vaddr"], phdr["p_paddr"], phdr["p_filesz"], phdr["p_memsz"], phdr["p_align"],
        )

    # --- 4. Drop the section header table: its offsets are stale and loaders
    #        never read it.
    struct.pack_into("<Q", out, 40, 0)
    struct.pack_into("<HH", out, 58, 0, 0)

    # Trim trailing zero padding so the file is not mostly holes.
    used = max(phdr["p_offset"] + phdr["p_filesz"] for phdr in phdrs if phdr["p_type"] == PT_LOAD)
    open(path, "wb").write(bytes(out[:used]))
    print(f"  repaired {path}: bionic sonames, versioning dropped, 16 KiB pages")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("library")
    parser.add_argument("--check", action="store_true", help="verify only, change nothing")
    args = parser.parse_args(argv)

    if args.check:
        return 0 if check(args.library) else 1
    repair(args.library)
    return 0 if check(args.library) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
