# Notes for Claude

## Versioning
- The release line is **2.0.x**: 2.0.0, 2.0.1 and 2.0.2 are tagged, 2.0.3 and 2.0.4 are merged, and the current release is **2.0.5**. Bump the patch number for each update, so the next one is **2.0.6**. Never use 2.1.x: `update-v2.1.5` is the name of a code branch, not a version.
- Set the version in `manifest.json`, `package.json`, both `version` fields at the top of `package-lock.json`, and the README title.
- Branch: `update-v<version>`, built on the previous update branch. Commit title: `Release <version>: <summary>`.

## Workflow
- After changing `src/`, run `npm test` (it rebuilds `content.js`, `background.js`, `pdfcheck.js` and `panel.html` first) and commit the built files too.
- `src/wordlists.js` is generated: run `npm run wordlists` and don't edit it by hand.
