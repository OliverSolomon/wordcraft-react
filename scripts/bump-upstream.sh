#!/usr/bin/env bash
# Point the package at a newer upstream WordCraft commit.
# Usage: scripts/bump-upstream.sh [<commit sha>]   (default: latest storytold/wordcraft main)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REV="${1:-$(git ls-remote https://github.com/storytold/wordcraft.git refs/heads/main | cut -f1)}"
OLD="$(cat "$ROOT/UPSTREAM_REV")"
[ "$REV" = "$OLD" ] && { echo "already at $REV"; exit 0; }
sed -i.bak "s/$OLD/$REV/g" "$ROOT/Cargo.toml" && rm -f "$ROOT/Cargo.toml.bak"
echo "$REV" > "$ROOT/UPSTREAM_REV"
(cd "$ROOT" && cargo update -p wordcraft-engine -p wordcraft-ui-egui -p wordcraft-doc)
echo "upstream: $OLD -> $REV"
echo "next: scripts/build-wasm.sh, try the example, then bump packages/wordcraft-react/package.json"
