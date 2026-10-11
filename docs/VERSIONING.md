# Versioning

This rule applies to every package we publish under `@gamine` (`@gamine/wordcraft-react` now, and `@gamine/gridcraft-react` when it ships).

1. **Each release bumps the patch number.** 0.3.0 is followed by 0.3.1, 0.3.2, 0.3.3 and so on, whatever the release contains: new features, fixes or an upstream sync.
2. **The minor number moves only when a version is declared stable.** When the owner declares the current line stable, the next release is 0.4.0, and patch releases continue from there (0.4.1, 0.4.2…).
3. **1.0.0 marks the first version we commit to keeping compatible.** Until then, any release may change the API, and the changelog says how.
4. **Every release has a changelog entry.** [CHANGELOG.md](../CHANGELOG.md) gets a section per version saying what changed, with Extras marked ✦. The release workflow publishes that section as the GitHub release notes.

## How releases happen

- **By hand:** bump the patch version in `packages/wordcraft-react/package.json` (`npm version patch --no-git-tag-version`), add the CHANGELOG section, and push to `main`. The Release workflow sees the new version, runs every check, tags it, publishes to npm and creates the GitHub release.
- **Upstream syncs:** every two hours the Upstream sync workflow checks storytold/wordcraft. When upstream has moved and everything passes, it bumps the patch version, adds a CHANGELOG entry for the sync, and releases. That is rule 1 applied automatically.
