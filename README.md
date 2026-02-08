# 🌐 Line Localization Machine

A modern browser extension that provides AI-powered line-by-line webpage translation with intelligent batching, pipeline processing, and subtle animations.

## 📥 Install

[![Available in the Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/line-localization-machine/ndofgkefebkmliigcmgmbmamilkjjjla?hl=zh-tw)

[![Get the add-on for Firefox](https://blog.mozilla.org/addons/files/2015/11/get-the-addon-small.png)](https://addons.mozilla.org/en-US/firefox/addon/line-localization-machine/)

## ✨ Features

- **OpenAI Compatible**: Works with OpenAI API and other compatible endpoints
- **Intelligent Pipeline Translation**: Translates webpage content with background processing for maximum efficiency
- **Batch Processing**: Combines 3-8 blocks per API request to reduce costs and improve speed
- **15 Languages**: Support for major world languages with flag emojis
- **Bring Your Own Key**: API keys stored locally, never shared

<https://github.com/user-attachments/assets/1fdb6a30-c0e3-483d-ba92-3405ca712502>

## 🎯 Usage

1. Navigate to any webpage you want to translate
2. Click the Line Localization Machine extension icon
3. Optionally select a different target language from the dropdown
4. Click "Translate Page"
5. Watch as content gets translated in batches with pipeline processing!
6. Use the toggle button (top-right of page) to switch between original and translated text

## ⚙️ Configuration

### API Settings

- **API Key**: Your API key (required)
- **Endpoint**: OpenAI-compatible API endpoint (default: OpenAI)
- **Model**: Choose from latest 2025 models or enter a custom model ID
  - **Predefined**: GPT-4o Mini, GPT-5 Mini, GPT-5 Nano
  - **Custom**: Any model ID supported by your API provider
- **Target Language**: Select from 15 supported languages (Traditional Chinese is default)
- **Blocks Per Request**: Configure batch size (3, 5, or 8 blocks per API call)

### Supported Languages (15 Languages with Flags)

- 🇪🇸 Spanish
- 🇫🇷 French
- 🇩🇪 German
- 🇨🇳 Chinese (Simplified)
- 🇹🇼 Chinese (Traditional) - _Default_
- 🇯🇵 Japanese
- 🇰🇷 Korean
- 🇵🇹 Portuguese
- 🇮🇹 Italian
- 🇷🇺 Russian
- 🇸🇦 Arabic
- 🇮🇳 Hindi
- 🇳🇱 Dutch
- 🇸🇪 Swedish
- 🇳🇴 Norwegian

### Supported Model Providers

The extension supports any OpenAI-compatible API endpoint:

**Built-in Model Options:**

- **OpenAI**: `gpt-4o-mini`, `gpt-5-mini`, `gpt-5-nano`

**Custom Model Examples:**

- OpenAI: `gpt-4o`, `gpt-5`
- Other providers: `gemini-2.5-flash-lite`, etc.
- Any other OpenAI-compatible model ID

Simply select "Custom Model..." and enter the exact model identifier used by your API provider.

## 🧪 Testing

### Prerequisites

```bash
npm install
npx playwright install chromium
```

### Unit & Integration Tests

```bash
npm test              # Run all Jest tests (unit + integration)
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests only
```

### E2E Tests

E2E tests use Playwright to load the real extension in Chromium and verify the full translation pipeline.

#### Mock Server (required for non-live E2E tests)

Start the mock server in a separate terminal before running E2E tests:

```bash
npm run test:mock-server
```

The mock server runs on `http://localhost:3001` and provides:

- `POST /v1/chat/completions` — mock OpenAI-compatible translation API
- `POST /test/reset` — reset server state
- `POST /test/mode` — set translation/marker behavior
- `GET /test/stats` — request count and current config
- Static file serving for test HTML pages

#### Smoke Test

Quick check that the extension loads and can translate:

```bash
npm run test:e2e
```

#### Pipeline Test

Comprehensive test that verifies marker cleanup, link preservation, inline element preservation, content zone detection, and toggle button behavior:

```bash
# With mock server (start mock server first)
npm run test:pipeline

# With mock server — test LLM marker misbehavior
npm run test:pipeline:contaminate  # LLM adds fake markers
npm run test:pipeline:drop         # LLM strips markers
```

#### Live API Testing

Test against real LLM providers instead of the mock server:

```bash
# OpenAI (reads $OPENAI_API_KEY)
npm run test:pipeline:live

# Custom provider
node tests/e2e/test-translation-pipeline.js --live \
  --api-key-env=OLLAMA_API_KEY \
  --endpoint=https://ollama.com/v1/ \
  --model=ministral-3:8b-cloud

# Test on a specific URL
node tests/e2e/test-translation-pipeline.js --live \
  --url=https://example.com/article \
  --lang=japanese
```

**Pipeline test flags:**

| Flag                | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `--live`            | Use real LLM API instead of mock server                           |
| `--endpoint=URL`    | API endpoint (default: `https://api.openai.com/v1`)               |
| `--model=MODEL`     | Model name (default: `gpt-4o-mini`)                               |
| `--api-key-env=VAR` | Env var holding the API key (default: `OPENAI_API_KEY`)           |
| `--url=URL`         | Translate a custom URL instead of the test page                   |
| `--lang=LANG`       | Target language (default: `spanish`)                              |
| `--headed`          | Show browser window                                               |
| `--keep-open`       | Keep browser open after test for manual inspection                |
| `--markers=MODE`    | Mock server marker behavior: `preserve`, `drop`, or `contaminate` |

### Linting & Formatting

```bash
npm run lint          # Check with ESLint
npm run lint:fix      # Auto-fix lint issues
npm run format        # Format with Prettier
npm run format:check  # Check formatting
```

## 📄 License

MIT License - feel free to modify and distribute

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request
