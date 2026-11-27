#!/usr/bin/env python3
"""Drop a wasm module's `name` section (function names for stack traces) in place.

WordCraft's module is large enough that wasm-bindgen needs more memory than small build machines
have while the names are in; nothing at run time reads them. Usage: strip-wasm-names.py FILE.wasm
"""
import sys


def leb(data: bytes, i: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        b = data[i]
        i += 1
        value |= (b & 0x7F) << shift
        shift += 7
        if b < 0x80:
            return value, i


def main(path: str) -> int:
    data = open(path, "rb").read()
    if data[:4] != b"\0asm":
        print(f"error: {path} is not a wasm module", file=sys.stderr)
        return 1
    out = bytearray(data[:8])
    i, dropped = 8, 0
    while i < len(data):
        start = i
        sid = data[i]
        size, body = leb(data, i + 1)
        end = body + size
        if sid == 0:
            n, j = leb(data, body)
            if data[j:j + n] == b"name":
                dropped += end - start
                i = end
                continue
        out += data[start:end]
        i = end
    open(path, "wb").write(out)
    print(f"stripped {dropped / 1e6:.1f} MB of names from {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
