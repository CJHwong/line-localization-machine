# Privacy Policy for Line Localization Machine

**Effective Date:** August 25, 2025  
**Last Updated:** August 25, 2025

## Overview

Line Localization Machine is a browser extension that provides AI-powered webpage translation. This privacy policy explains how we collect, use, and protect your information when you use our extension.

## Information We Collect

### Data You Provide

- **API Key**: Your OpenAI (or compatible AI service) API key for translation services
- **API Endpoint**: Custom API endpoint URL if you use a different service provider
- **Settings**: Your translation preferences including:
  - Target language selection
  - Model selection (GPT-4o Mini, GPT-5 Mini, etc.)
  - Animation speed and display preferences
  - Batch size and temperature settings

### Data We Process

- **Webpage Text**: Text content from webpages that you choose to translate
- **Translation Results**: Translated text returned from your chosen AI service
- **Translation History**: Recent translations used for context consistency (temporary, in-memory only)

## How We Use Your Information

### Local Storage Only

- All your settings and API keys are stored locally in your browser using `chrome.storage.local`
- No personal data is transmitted to our servers or third parties
- Your API key and settings never leave your device except when making translation requests to your chosen AI service

### Translation Processing

- Webpage text is sent to your configured AI service (e.g., OpenAI) using your API key
- Translation requests include only the text content and your language preferences
- Translation history is used temporarily to maintain consistency across related content

## Data Sharing and Third Parties

### AI Service Providers

- Text for translation is sent to your configured AI service (default: OpenAI)
- This data sharing occurs only when you actively request translations
- Data is transmitted directly from your browser to the AI service
- We do not intercept, store, or access this data

### No Data Collection by Us

- We do not collect, store, or transmit any personal information to our servers
- We do not have servers or databases that store user data
- We do not track your browsing activity or collect analytics

## Data Storage and Security

### Local Browser Storage

- API keys are stored securely in your browser's local storage
- Settings are stored locally and synchronized across your browser instances if enabled
- No data is stored on external servers

### Data Retention

- Settings persist until you uninstall the extension or manually clear them
- Translation history is kept in memory only during active translation sessions
- No long-term data retention occurs

## Your Rights and Controls

### Data Access and Control

- You can view and modify all stored settings through the extension's settings page
- You can delete your API key and reset all settings at any time
- Uninstalling the extension removes all stored data

### Translation Control

- Translation only occurs when you explicitly request it
- You can stop translation at any time
- You control which AI service receives your data through your API configuration

## Updates to This Policy

We may update this privacy policy from time to time. Updates will be reflected by changing the "Last Updated" date at the top of this policy. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact Information

For questions about this privacy policy or the extension's data practices, please contact us through:

- GitHub Issues: [https://github.com/CJHwong/line-localization-machine/issues](https://github.com/CJHwong/line-localization-machine/issues)

## Technical Details

### Browser Permissions

Our extension requests the following permissions:

- **activeTab**: To access the content of the current webpage for translation
- **storage**: To save your settings locally in your browser
- **scripting**: To inject translation functionality into webpages
- **host_permissions ("&lt;all_urls&gt;")**: To translate content on any website you visit

### Data Processing Location

- Settings storage: Local browser storage only
- Translation processing: Your configured AI service (e.g., OpenAI's servers)
- No intermediate servers or proxies are used

## Compliance

This extension is designed to minimize data collection and maximize user privacy. We operate under the principle of data minimization, collecting only what is necessary for the extension's core functionality.
