# Line Localization Machine — Agent Instructions

## Build & Test

- `npm test` — Jest (unit + integration)
- `npm run test:e2e` — Playwright smoke test (needs `npm run test:mock-server` in separate terminal)
- `npm run lint` / `npm run format` — ESLint + Prettier
- `npm run publish:prep` — pre-publish validation + zip packaging

## Hard Constraints

### Streaming Architecture (not batch)

Translation uses a **single streaming API request** for the entire page — not batched requests.

- Content script opens `chrome.runtime.connect({ name: 'streaming-translate' })` port
- Background `onConnect` handler calls `APIClient.streamTranslate()` with `stream: true`
- `streamTranslate()` feeds SSE deltas through `isolateJSON()` → `repairQuotes()` → jsonriver (vendored `vendor/jsonriver-1.1.1/`) for progressive JSON parsing
- jsonriver `completeCallback` fires at path `['blocks', N]`, delivering each block immediately via port message `{ type: 'block', index, block }`
- Port lifecycle: `START_STREAM` → `block` (repeated) → `done` or `error`

### Publishing

- Full publishing guide: `docs/publishing.md`
- Packaging scripts: `scripts/package-chrome.sh`, `scripts/package-firefox.sh`
- `npm run publish:prep` runs pre-publish checks then builds both zip packages

### Version Sync

When bumping the version, update exactly **2 files**:

1. `manifest.json` → `"version"`
2. `package.json` → `"version"`

### Packaging Allowlist

Both packaging scripts use an **explicit `cp -R` allowlist**, not a wildcard. When adding a new top-level folder that ships with the extension (e.g. `history/`):

1. `scripts/package-chrome.sh` — add the folder name to the `cp -R` line
2. `scripts/package-firefox.sh` — add the folder name to the `cp -R` line

Forgetting this ships zips that omit the folder. Dev-loaded (unpacked) installs still work because they read from disk, so the bug only surfaces in packaged builds (Chrome Web Store, AMO, or `dist/*.zip`). `docs/publishing.md` also has stale manual `cp` snippets — keep those in sync or delete them.

### Release Submission Text

Every version bump must also append a new entry to `CHANGELOG.md` containing two strings the user pastes into the AMO/CWS submission form:

1. **Release Notes** (user-facing, appears on the store detail page). Short bullet list of user-visible changes only. No commit hashes, no internal jargon, no "we".
2. **Notes to Reviewer** (AMO requires this when source review applies). Confirm there is no transpilation/bundling/minification, give exact reproduction steps from a clean checkout, and list vendored third-party code (`vendor/readability-0.6.0/` Apache 2.0, `vendor/jsonriver-1.1.1/` BSD-3-Clause) so reviewers know what to skip.

The reproduction steps must produce the exact zip the reviewer is reviewing. Reference the version-bump commit by SHA or tag.

### Adding New Models

Update `shared/models.js` only:

1. Add model ID to `PREDEFINED_MODELS` array
2. Add display name to `MODEL_DESCRIPTIONS` object
3. Model appears in settings dropdown automatically

### Settings Schema

Actual settings stored in `chrome.storage.local` (defined in `shared/models.js` `DEFAULT_SETTINGS`):

- `apiKey`, `apiEndpoint`, `model`, `customModel`, `targetLanguage`, `reasoningEffort`

`blocksPerRequest` and `temperature` were removed. Do not re-add them.
