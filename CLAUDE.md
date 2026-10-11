# Working on this repository

- **Versioning:** every release bumps the patch number (0.3.0, 0.3.1, 0.3.2…). The minor number moves only when the owner declares a version stable. Each release gets a CHANGELOG.md section. See docs/VERSIONING.md. This applies to every `@gamine` package.
- **Writing:** no em dashes anywhere (docs, UI text, code comments). Use commas, colons, full stops or parentheses.
- **Extras:** features that are not part of Microsoft Word or WordCraft are tagged ✦ Extra in the docs and "Extra" in the UI, and listed in docs/DIVERGENCES.md.
- **Upstream:** WordCraft is consumed unmodified at UPSTREAM_REV plus the patch series in patches/ (see patches/README.md). Keep patches small and upstreamable; record every behaviour change in docs/DIVERGENCES.md.
- **Before each commit:** run the TypeScript type check (`npx tsc --noEmit -p packages/wordcraft-react`), and the browser smoke test when the editor changes. Commit messages carry no AI attribution.
