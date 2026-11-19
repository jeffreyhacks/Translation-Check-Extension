# Notes for Claude

## Versioning
- The release line is **2.0.x**: 2.0.0, 2.0.1 and 2.0.2 are tagged, 2.0.3, 2.0.4, 2.0.5 and 2.0.6 are merged, and the current release is **2.0.7** (branch `update-v2.0.7`). Never use 2.1.x: `update-v2.1.5` is the name of a code branch, not a version.
- **Don't bump the version on your own.** New fixes go into the current release (2.0.7, branch `update-v2.0.7`), even after it has been merged: commit them on `update-v2.0.7` (if it was already merged, update that branch from `main` first). Start the next version (2.0.8) only when the user asks for a new release.
- Set the version in `manifest.json`, `package.json`, both `version` fields at the top of `package-lock.json`, and the README title.
- Branch: `update-v<version>`, built on the previous update branch. Commit title: `Release <version>: <summary>` for the commit that sets a new version; plain descriptive titles for later fixes in the same release.

## Workflow
- After changing `src/`, run `npm test` (it rebuilds `content.js`, `background.js`, `pdfcheck.js` and `panel.html` first) and commit the built files too.
- `src/wordlists.js` is generated: run `npm run wordlists` and don't edit it by hand.
