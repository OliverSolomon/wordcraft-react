# Patches on upstream WordCraft

`scripts/prepare-upstream.sh` checks out storytold/wordcraft at `UPSTREAM_REV` into `upstream/`
and applies these patches in order before anything is built. They are small, self-contained hooks
that an embedded editor needs and the official web build doesn't, written so they could be offered
upstream as-is. When upstream accepts one, delete it here.

| Patch | Why |
|---|---|
| 0001 | AutoSave on the web when the host keeps documents (upstream greys it out in the browser), and hiding the title bar and the ribbon |
| 0002 | Real-time co-editing: Undo and Redo can be handed to the host (so they take back only your own changes), and the title bar shows who else is editing |
| 0003 | Host controls: which ribbon tabs show, Word's Viewing mode, commands the host turns off, Theme / Recently Used / All Fonts sections and on-demand web fonts in the font box, and clicking a comment to go to its text |

The patches were made against the upstream commit in `BASE`. Every sync rebases them onto the new
upstream with a three-way merge and refreshes them, so they only need a person when both sides
changed the same lines. Then the sync opens an issue: check out the new upstream commit, apply the
patches with `git am --3way`, resolve the conflict, and regenerate them with
`git format-patch <new commit> -o patches/` (and update `BASE`).
