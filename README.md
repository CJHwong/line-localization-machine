# 🌐 Line Localization Machine

A modern browser extension that provides AI-powered line-by-line webpage translation with intelligent batching, pipeline processing, and subtle animations.

## ✨ Features

- **OpenAI Compatible**: Works with OpenAI API and other compatible endpoints
- **Intelligent Pipeline Translation**: Translates webpage content with background processing for maximum efficiency
- **Batch Processing**: Combines 3-8 blocks per API request to reduce costs and improve speed
- **15 Languages**: Support for major world languages with flag emojis
- **Bring Your Own Key**: API keys stored locally, never shared

https://github.com/user-attachments/assets/1fdb6a30-c0e3-483d-ba92-3405ca712502

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

## 📄 License

MIT License - feel free to modify and distribute

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request
