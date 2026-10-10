#!/usr/bin/env bash
# Build the WordCraft WebAssembly module into packages/wordcraft-react/wasm/.
#
# Needs: the wasm32-unknown-unknown target, wasm-bindgen-cli matching the pinned wasm-bindgen
# (cargo install wasm-bindgen-cli --version 0.2.129 --locked) and, optionally, wasm-opt
# (binaryen) for the same -Oz size pass the official web build uses.
#
# Usage: scripts/build-wasm.sh [--dev]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/packages/wordcraft-react/wasm"
PROFILE=release
[ "${1:-}" = "--dev" ] && PROFILE=dev

want=$(grep -A1 'name = "wasm-bindgen"$' "$ROOT/Cargo.lock" | sed -n 's/version = "\(.*\)"/\1/p')
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')
if [ "$want" != "$have" ]; then
  echo "error: wasm-bindgen-cli $want required (found ${have:-none}): cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi

cd "$ROOT"
cargo build --locked --profile "$PROFILE" --target wasm32-unknown-unknown -p wordcraft-embed
dir=$([ "$PROFILE" = dev ] && echo debug || echo release)
rm -rf "$OUT" && mkdir -p "$OUT"
wasm-bindgen --target web --weak-refs --out-dir "$OUT" --out-name wordcraft_embed \
  "$ROOT/target/wasm32-unknown-unknown/$dir/wordcraft_embed.wasm"

if [ "$PROFILE" = release ]; then
  if command -v wasm-opt >/dev/null; then
    wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-reference-types \
      -o "$OUT/wordcraft_embed_bg.wasm.opt" "$OUT/wordcraft_embed_bg.wasm"
    mv -f "$OUT/wordcraft_embed_bg.wasm.opt" "$OUT/wordcraft_embed_bg.wasm"
  else
    echo "note: wasm-opt not found; skipping the size pass (npm i -g binaryen)" >&2
  fi
fi
echo "upstream WordCraft $(cat "$ROOT/UPSTREAM_REV")" > "$OUT/UPSTREAM"
ls -lh "$OUT"
