#!/usr/bin/env python3
"""CHANGELOG.md helpers for the release workflows.

  changelog.py notes VERSION            print VERSION's section (the GitHub release notes)
  changelog.py sync VERSION SHORT URL   add a section for an automatic upstream sync
"""
import datetime
import pathlib
import re
import sys

PATH = pathlib.Path(__file__).resolve().parent.parent / "CHANGELOG.md"


def section(text: str, version: str) -> str:
    m = re.search(r"^## " + re.escape(version) + r"\b.*?\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1).strip() if m else ""


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    text = PATH.read_text() if PATH.exists() else "# Changelog\n"
    if cmd == "notes" and len(sys.argv) == 3:
        print(section(text, sys.argv[2]) or "See the commits in this release.")
    elif cmd == "sync" and len(sys.argv) == 5:
        version, short, url = sys.argv[2:]
        if section(text, version):
            return
        today = datetime.date.today().isoformat()
        entry = f"## {version} ({today})\n\n- **Upstream:** synced to WordCraft `{short}` ([changes]({url})).\n\n"
        m = re.search(r"^## ", text, re.M)
        text = text[: m.start()] + entry + text[m.start():] if m else text.rstrip() + "\n\n" + entry
        PATH.write_text(text)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
