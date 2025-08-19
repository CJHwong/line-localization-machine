# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Line Localization Machine is a browser extension that provides AI-powered line-by-line webpage translation with intelligent batching, pipeline processing, and subtle animations.

## Key Architecture

### Modern Architecture

The project uses Manifest V3 with modular design patterns:

- **Shared utilities**: Centralized configuration and API management in `shared/` folder
- **Service worker**: Non-persistent background script for efficiency
- **Modular structure**: Clear separation between popup, settings, content, and background

### Core Components

- **Background Script** (`background/background.js`): Service worker handling API requests and extension lifecycle
- **Content Script** (`content/content-script.js`): Main translation engine with DOM manipulation and 4-phase animations
- **Popup** (`popup/`): Simple interface for quick translation and language selection
- **Settings** (`settings/`): Comprehensive configuration page for API keys, models, and preferences
- **Shared modules** (`shared/`): Centralized model configuration, API client, and debug utilities

### Translation Pipeline

The extension uses sophisticated batch processing:

- **Intelligent grouping**: Combines 3-8 text blocks per API request (configurable)
- **Pipeline processing**: Translates future batches while current ones animate
- **Context preservation**: Maintains translation history for consistency
- **Error handling**: Exponential backoff for 5xx errors, special handling for 429 rate limits

## Common Commands

### Development Setup

```bash
# The extension is pre-configured for Chrome with Manifest V3
# No setup scripts needed - ready to load directly

# Load in Chrome
# 1. Go to chrome://extensions/
# 2. Enable Developer mode
# 3. Click "Load unpacked" and select project directory
```

### Testing Extension

```bash
# Chrome: Load unpacked extension from project directory
# The manifest.json is already configured for Chrome Manifest V3
```

### Development Commands

```bash
# Linting and formatting
npm run lint          # Check code with ESLint
npm run lint:fix       # Auto-fix linting issues
npm run format         # Format code with Prettier
npm run format:check   # Check code formatting

# View main components
ls popup/ settings/ content/ background/ shared/ assets/

# Check current manifest configuration
cat manifest.json
```

## API Integration

### Translation Flow

1. Content script extracts text using TreeWalker API
2. Groups text into semantic blocks (max 3 items per block)
3. Batches blocks for API requests (3-8 blocks per request)
4. Background script handles OpenAI-compatible API calls
5. Content script animates translations with 4-phase CSS animations

### Error Handling Strategy

- **5xx Server Errors**: Retry up to 3 times with exponential backoff (1s, 2s, 4s)
- **429 Rate Limiting**: Special handling with longer delays (5s, 10s, 20s), respects Retry-After header
- **4xx Client Errors**: Stop immediately with user-friendly messages
- **Network Timeouts**: 30-second timeout with retry logic

### Settings Management

All settings are managed centrally through the `shared/models.js` configuration file, which provides:

- **Centralized model list**: All available models defined in one place
- **Default settings**: Consistent defaults across all components
- **Model descriptions**: User-friendly names for each model
- **Helper methods**: `isPredefinedModel()`, `getModelDescription()`, etc.

Settings stored in browser.storage.local:

- `apiKey`: User's API key
- `apiEndpoint`: API endpoint URL (default: OpenAI)
- `model`: Selected model or custom model ID
- `targetLanguage`: Default translation language
- `blocksPerRequest`: Batch size (3, 5, or 8)
- `temperature`: Translation creativity (0.1-1.0 range, 0.3 default)

#### Adding New Models

To add a new model, update `shared/models.js`:

1. Add model ID to `PREDEFINED_MODELS` array
2. Add display name to `MODEL_DESCRIPTIONS` object
3. The model will automatically appear in settings dropdown

## Browser-Specific Notes

### Chrome (Manifest V3)

- Uses `chrome.action` API for extension icon
- Requires `chrome.scripting` for content script injection
- Service worker background script (non-persistent)

### Model Support

- **GPT-5**: OpenAI's latest models
- **Custom models**: Support for any OpenAI-compatible endpoint

## Animation System

The extension uses a 4-phase CSS animation system:

1. **Scanning**: Subtle preparation animation (`llm-preparing`)
2. **Fade Out**: Content fades before replacement (`llm-fading-out`)
3. **Translation Reveal**: New content appears (`llm-translated`)
4. **Settlement**: Final state with polish (`llm-settled`)

Animation styles are in `content/animations.css` and triggered by content script classes.

## Language Support

Supports 15 languages with flag emojis:

- Spanish, French, German, Chinese (Simplified/Traditional)
- Japanese, Korean, Portuguese, Italian, Russian
- Arabic, Hindi, Dutch, Swedish, Norwegian

Language codes map to display names in `getLanguageName()` function.

## Testing Strategy

### Manual Testing

1. Load extension in browser developer mode
2. Navigate to test webpage
3. Click extension icon or use popup
4. Verify translations appear with animations
5. Test global toggle button functionality

### API Testing

Use the "Test Connection" button in settings to verify:

- API endpoint accessibility
- API key validity
- Model availability
- Basic translation functionality

### Chrome Testing

Test functionality in Chrome by loading the extension in developer mode and verifying translation performance.

## Code Quality & Pre-commit Hooks

The project uses Husky for automated code quality checks:

### Setup

- **ESLint**: Configured with loose rules suitable for browser extension development
- **Prettier**: Consistent code formatting with 100-character line length
- **Pre-commit hooks**: Automatically run linting and formatting on commit

### Configuration Files

- `eslint.config.js`: ESLint configuration with browser extension globals
- `.prettierrc`: Prettier formatting rules
- `.husky/pre-commit`: Pre-commit hook that runs `eslint --fix` and `prettier --write`

### Ignored Files

ESLint ignores: `node_modules/`, `dist/`, `build/`, `web-ext-artifacts/`, `manifest.json`

### Global Variables Defined

Browser extension specific: `chrome`, `browser`, `getComputedStyle`, `confirm`, `alert`, etc.
