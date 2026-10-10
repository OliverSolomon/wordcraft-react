#!/usr/bin/env bash
# Check out upstream WordCraft at UPSTREAM_REV into ./upstream and apply ./patches/*.patch.
#
# The patches are small embedding hooks (see patches/README.md) meant to be offered upstream.
# If one no longer applies after an upstream change, this fails loudly so the sync pipeline
# opens an issue instead of publishing.
#
# Usage: scripts/prepare-upstream.sh            (idempotent; re-applies when rev or patches change)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REV="$(tr -d '[:space:]' < "$ROOT/UPSTREAM_REV")"
DIR="$ROOT/upstream"
STAMP="$DIR/.prepared"
want="$REV $(cat "$ROOT"/patches/*.patch 2>/dev/null | sha256sum | cut -c1-16)"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$want" ]; then
  exit 0
fi

if [ ! -d "$DIR/.git" ]; then
  rm -rf "$DIR"
  git init -q "$DIR"
  git -C "$DIR" remote add origin https://github.com/storytold/wordcraft.git
fi
git -C "$DIR" fetch -q --depth 1 origin "$REV"
git -C "$DIR" checkout -q --force FETCH_HEAD
git -C "$DIR" clean -qfdx -e target
for p in "$ROOT"/patches/*.patch; do
  [ -e "$p" ] || continue
  if ! git -C "$DIR" apply --whitespace=nowarn "$p"; then
    echo "error: patch $(basename "$p") no longer applies to upstream $REV" >&2
    exit 1
  fi
  echo "applied $(basename "$p")"
done
echo "$want" > "$STAMP"
