# Patches on upstream WordCraft

`scripts/prepare-upstream.sh` checks out storytold/wordcraft at `UPSTREAM_REV` into `upstream/`
and applies these patches in order before anything is built. They are small, self-contained hooks
that an embedded editor needs and the official web build doesn't, written so they could be offered
upstream as-is. When upstream accepts one, delete it here.

| Patch | Why |
|---|---|
| 0001 | An `Embed` struct on `WordApp` for what a host page turns off or takes over, kept apart from the saved preferences; the shell hides the title bar, ribbon and status bar by it; the File page goes when the host hides its tab; AutoSave runs through a host that keeps documents (upstream greys it out in the browser) |
| 0002 | Real-time co-editing: Undo and Redo can be handed to the host (so they take back only your own changes), and the title bar shows who else is editing, in their caret colours |
| 0003 | Host controls: commands the host turns off and Viewing mode (refused everywhere and greyed out), the Editing / Reviewing / Viewing switch (`ui.mode`), hidden ribbon tabs, web fonts the host can fetch listed in the font box (and asked for when picked or rested on), and an AI button beside Comments |
| 0004 | Version History's entry points for a host that keeps versions: the title and File › Info |
| 0005 | Custom theme colours for Design › Colors (`design.themeColors` with `colors`), and the first page's or even pages' header and footer by `kind` (`insert.editHeader`, `insert.editFooter`), for the brand theme and logo placement |
| 0006 | The host owns more of the screen: comments (New Comment asks the host to compose, no empty comment, the pane never opens, balloon clicks go to the host), Share, the File menu item by item (hide, rename, disable with a reason, host actions, sections, each export format), and switches for the context menu, rulers, Navigation pane, zoom and the page-view buttons |

Upstream 0.18 (November 2026) rebuilt its window on the Craft shell and its saving on a host
files layer, so the series was ported rather than rebased then. Upstream's own ribbon collapse,
Recently Used Fonts and comment navigation replaced ours; the older mini toolbar and ruler tweaks
were dropped.

The patches were made against the upstream commit in `BASE`. Every sync rebases them onto the new
upstream with a three-way merge and refreshes them, so they only need a person when both sides
changed the same lines. Then the sync opens an issue: check out the new upstream commit, apply the
patches with `git am --3way`, resolve the conflict, and regenerate them with
`git format-patch <new commit> -o patches/` (and update `BASE`).
