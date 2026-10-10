#!/usr/bin/env python3
"""Move the package to a newer upstream WordCraft commit, keeping dependencies 1:1 with upstream.

Usage: scripts/sync-upstream.py [<commit sha>]     (default: latest storytold/wordcraft main)

What it does:
  1. Rewrites the pinned rev in Cargo.toml and UPSTREAM_REV.
  2. Copies upstream's Cargo.lock, so every shared crate (egui, wgpu, skrifa, ...) resolves to
     exactly the version upstream ships, then lets cargo add only our own entries.
  3. Re-pins egui / eframe / rfd / wasm-bindgen in crates/wordcraft-embed to upstream's versions.

Exits 0 with "unchanged" when already at the target. In GitHub Actions it writes
`changed`, `old` and `new` to $GITHUB_OUTPUT.
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

UPSTREAM = "https://github.com/storytold/wordcraft.git"
ROOT = Path(__file__).resolve().parent.parent
EMBED = ROOT / "crates/wordcraft-embed/Cargo.toml"


def run(*args, cwd=None, capture=False):
    r = subprocess.run(args, cwd=cwd, check=True, text=True, capture_output=capture)
    return r.stdout.strip() if capture else ""


def output(**kv):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as f:
            for k, v in kv.items():
                f.write(f"{k}={v}\n")


def lock_version(lock: str, name: str) -> str | None:
    m = re.search(r'\[\[package\]\]\nname = "' + re.escape(name) + r'"\nversion = "([^"]+)"', lock)
    return m.group(1) if m else None


def workspace_dep_version(toml: str, name: str) -> str | None:
    m = re.search(r'^' + re.escape(name) + r'\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")', toml, re.M)
    return (m.group(1) or m.group(2)) if m else None


def main() -> int:
    old = (ROOT / "UPSTREAM_REV").read_text().strip()
    new = sys.argv[1] if len(sys.argv) > 1 else run("git", "ls-remote", UPSTREAM, "refs/heads/main", capture=True).split()[0]
    if not re.fullmatch(r"[0-9a-f]{40}", new):
        print(f"error: not a full commit sha: {new}", file=sys.stderr)
        return 2
    if new == old:
        print(f"unchanged: already at {old}")
        output(changed="false", old=old, new=new)
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        run("git", "init", "-q", tmp)
        run("git", "-C", tmp, "fetch", "-q", "--depth", "1", UPSTREAM, new)
        up_toml = run("git", "-C", tmp, "show", "FETCH_HEAD:Cargo.toml", capture=True)
        up_lock = run("git", "-C", tmp, "show", "FETCH_HEAD:Cargo.lock", capture=True) + "\n"

    # 1. the pinned rev
    cargo = ROOT / "Cargo.toml"
    cargo.write_text(cargo.read_text().replace(old, new))
    (ROOT / "UPSTREAM_REV").write_text(new + "\n")

    # 3. dependency pins in the embed crate follow upstream
    embed = EMBED.read_text()
    pins = {
        "egui": workspace_dep_version(up_toml, "egui"),
        "eframe": workspace_dep_version(up_toml, "eframe"),
        "rfd": workspace_dep_version(up_toml, "rfd"),
    }
    for name, ver in pins.items():
        if ver:
            embed = re.sub(r'^(' + name + r'\s*=\s*(?:\{\s*version\s*=\s*)?")[^"]+(")', r'\g<1>' + ver + r'\g<2>', embed, count=1, flags=re.M)
    wbg = lock_version(up_lock, "wasm-bindgen")
    if wbg:
        embed = re.sub(r'^(wasm-bindgen\s*=\s*"=)[^"]+(")', r'\g<1>' + wbg + r'\g<2>', embed, count=1, flags=re.M)
    EMBED.write_text(embed)

    # 2. upstream's lockfile as the base; cargo fills in our own crates without touching the rest
    (ROOT / "Cargo.lock").write_text(up_lock)
    run("cargo", "metadata", "--format-version", "1", cwd=ROOT, capture=True)

    print(f"upstream: {old} -> {new}")
    print("pins: " + ", ".join(f"{k} {v}" for k, v in {**pins, "wasm-bindgen": wbg}.items() if v))
    output(changed="true", old=old, new=new)
    return 0


if __name__ == "__main__":
    sys.exit(main())
