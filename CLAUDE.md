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

### Adding New Models

Update `shared/models.js` only:

1. Add model ID to `PREDEFINED_MODELS` array
2. Add display name to `MODEL_DESCRIPTIONS` object
3. Model appears in settings dropdown automatically

### Settings Schema

Actual settings stored in `chrome.storage.local` (defined in `shared/models.js` `DEFAULT_SETTINGS`):

- `apiKey`, `apiEndpoint`, `model`, `customModel`, `targetLanguage`, `reasoningEffort`

`blocksPerRequest` and `temperature` were removed. Do not re-add them.
