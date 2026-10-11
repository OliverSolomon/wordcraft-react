#!/usr/bin/env bash
# Check out upstream WordCraft at UPSTREAM_REV into ./upstream with ./patches/*.patch on top.
#
# The patches were made against the commit in patches/BASE. They are applied there and then
# rebased onto UPSTREAM_REV, so git merges them three-way: an upstream change near a patch is
# merged, and only a real conflict (both sides changing the same lines) stops the build.
#
# With UPDATE_PATCHES=1 (the upstream sync pipeline sets it), a successful rebase rewrites
# patches/*.patch against UPSTREAM_REV and moves patches/BASE, so they stay fresh.
#
# Usage: scripts/prepare-upstream.sh            (idempotent)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REV="$(tr -d '[:space:]' < "$ROOT/UPSTREAM_REV")"
BASE="$(tr -d '[:space:]' < "$ROOT/patches/BASE" 2>/dev/null || true)"
BASE="${BASE:-$REV}"
DIR="$ROOT/upstream"
STAMP="$DIR/.prepared"
want="$REV $BASE $(cat "$ROOT"/patches/*.patch 2>/dev/null | sha256sum | cut -c1-16)"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$want" ]; then
  exit 0
fi

if [ ! -d "$DIR/.git" ]; then
  rm -rf "$DIR"
  git init -q "$DIR"
  git -C "$DIR" remote add origin https://github.com/storytold/wordcraft.git
fi
g() { git -C "$DIR" -c user.name="wordcraft-react" -c user.email="patches@wordcraft-react.invalid" -c advice.detachedHead=false "$@"; }
g am --abort >/dev/null 2>&1 || true
g rebase --abort >/dev/null 2>&1 || true
g fetch -q --depth 1 origin "$REV"
[ "$BASE" = "$REV" ] || g fetch -q --depth 1 origin "$BASE"
g checkout -q --force "$BASE"
g clean -qfdx -e target -e .prepared

shopt -s nullglob
patches=("$ROOT"/patches/*.patch)
if [ ${#patches[@]} -gt 0 ]; then
  if ! g am -q --keep-cr "${patches[@]}"; then
    g am --abort || true
    echo "error: patches/ don't apply to their base $BASE" >&2
    exit 1
  fi
fi

if [ "$BASE" != "$REV" ]; then
  if ! g rebase -q --onto "$REV" "$BASE"; then
    echo "error: a patch conflicts with upstream $REV:" >&2
    g diff --name-only --diff-filter=U >&2 || true
    g rebase --abort || true
    exit 1
  fi
  echo "rebased ${#patches[@]} patch(es) from $BASE onto $REV"
  if [ "${UPDATE_PATCHES:-0}" = 1 ]; then
    rm -f "$ROOT"/patches/*.patch
    g format-patch -q --no-signature -o "$ROOT/patches" "$REV"
    echo "$REV" > "$ROOT/patches/BASE"
    BASE="$REV"
    want="$REV $BASE $(cat "$ROOT"/patches/*.patch 2>/dev/null | sha256sum | cut -c1-16)"
    echo "patches/ refreshed against $REV"
  fi
fi
for p in "${patches[@]}"; do echo "applied $(basename "$p")"; done
echo "$want" > "$STAMP"
