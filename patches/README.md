# Patches on upstream WordCraft

`scripts/prepare-upstream.sh` checks out storytold/wordcraft at `UPSTREAM_REV` into `upstream/`
and applies these patches in order before anything is built. They are small, self-contained hooks
that an embedded editor needs and the official web build doesn't, written so they could be offered
upstream as-is. When upstream accepts one, delete it here.

| Patch | Why |
|---|---|
| 0001 | AutoSave on the web (the toggle couldn't turn on without a desktop file path), and hiding the title bar and the ribbon for pages that embed WordCraft |

If the daily upstream sync reports that a patch no longer applies, rebase it: check out the new
upstream commit, apply the patch by hand, fix the conflict, and regenerate it with
`git format-patch -1 -o patches/`.
