// Cross-browser API abstraction for background scripts
import ModelConfig from '../shared/models.js';
import APIClient from '../shared/api-client.js';
import { DEBUG, DebugLogger } from '../shared/debug.js';
import {
  shouldClearTranslationState,
  addFirefoxSpecificListeners,
  startPeriodicCleanup,
  updateTranslationState,
  getTranslationState,
  clearTranslationState,
} from './translation-state.js';

// Minimal abstraction for genuine browser differences only
const BrowserAPI = {
  get isFirefox() {
    return typeof browser !== 'undefined';
  },

  get action() {
    if (this.isFirefox) {
      return browser.action || browser.browserAction;
    }
    return chrome.action;
  },

  async injectScript(tabId, options) {
    return await chrome.scripting.executeScript({
      target: { tabId },
      files: options.file ? [options.file] : undefined,
    });
  },

  async insertCSS(tabId, options) {
    return await chrome.scripting.insertCSS({
      target: { tabId },
      files: options.file ? [options.file] : undefined,
    });
  },
};

class BackgroundScript {
  constructor() {
    this.translationStates = new Map();
    this.ModelConfig = ModelConfig;
    this.APIClient = APIClient;
    this.debug = DEBUG;
    this.debugLogger = DebugLogger;
    this.init();
  }

  async init() {
    chrome.runtime.onInstalled.addListener(details => {
      if (details.reason === 'install') {
        this.handleInstallation();
      } else if (details.reason === 'update') {
        console.log('Line Localization Machine updated');
      }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const handleAsync = async () => {
        try {
          const result = await this.handleMessage(message, sender);
          sendResponse(result);
        } catch (error) {
          console.error('Background message handler error:', error);
          sendResponse({ success: false, error: error.message });
        }
      };

      if (!BrowserAPI.isFirefox) {
        handleAsync();
        return true;
      } else {
        return this.handleMessage(message, sender);
      }
    });

    BrowserAPI.action.onClicked.addListener(tab => {
      this.handleActionClick(tab);
    });

    chrome.tabs.onRemoved.addListener(tabId => {
      this.translationStates.delete(tabId);
      console.log(`Cleaned up translation state for closed tab ${tabId}`);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (this.debug && this.translationStates.has(tabId)) {
        console.log(`Tab ${tabId} updated:`, changeInfo);
      }

      if (
        shouldClearTranslationState(changeInfo, BrowserAPI.isFirefox) &&
        this.translationStates.has(tabId)
      ) {
        this.translationStates.delete(tabId);
        console.log(
          `Cleaned up translation state for navigated/refreshed tab ${tabId} (${changeInfo.status || 'unknown status'})`
        );
      }
    });

    startPeriodicCleanup(this.translationStates, this.debug);

    if (BrowserAPI.isFirefox) {
      addFirefoxSpecificListeners(this.translationStates, this.debug);
    }
  }

  // ─── Installation ──────────────────────────────────────────────────────────

  async handleInstallation() {
    await this.loadSharedConfig();
    const defaultSettings = this.ModelConfig.getDefaultSettings();
    await chrome.storage.local.set(defaultSettings);

    if (BrowserAPI.isFirefox) {
      chrome.tabs.create({ url: 'settings/settings.html' });
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
    }
  }

  // ─── Message Routing ───────────────────────────────────────────────────────

  async handleMessage(message, sender) {
    try {
      switch (message.action) {
        case 'TRANSLATE_REQUEST':
          return await this.handleTranslationRequest(message);

        case 'GET_SETTINGS':
          return await this.getSettings();

        case 'SAVE_SETTINGS':
          return await this.saveSettings(message.settings);

        case 'HEALTH_CHECK':
          return {
            status: 'healthy',
            timestamp: Date.now(),
            browser: BrowserAPI.isFirefox ? 'firefox' : 'chrome',
          };

        case 'UPDATE_TRANSLATION_STATE':
          return await updateTranslationState(
            this.translationStates,
            message.tabId,
            message.state,
            this.debug,
            this.debugLogger
          );

        case 'GET_TRANSLATION_STATE':
          return {
            state: await getTranslationState(
              this.translationStates,
              message.tabId,
              this.debug,
              this.debugLogger
            ),
          };

        case 'CLEAR_TRANSLATION_STATE':
          return clearTranslationState(this.translationStates, message.tabId, this.debug);

        case 'GET_CURRENT_TAB_ID':
          return await this.getCurrentTabId(sender);

        default:
          throw new Error(`Unknown action: ${message.action}`);
      }
    } catch (error) {
      console.error('Background script error:', error);

      let errorMessage = 'Unknown error occurred';
      if (error && typeof error.message === 'string') {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && error.toString) {
        try {
          errorMessage = error.toString();
        } catch (e) {
          errorMessage = 'Error could not be serialized';
        }
      }

      return { success: false, error: errorMessage };
    }
  }

  // ─── Action Handler ────────────────────────────────────────────────────────

  async handleActionClick(tab) {
    const restrictedUrls = BrowserAPI.isFirefox
      ? ['about:', 'moz-extension:']
      : ['chrome:', 'chrome-extension:', 'edge:', 'extension:'];

    if (restrictedUrls.some(prefix => tab.url.startsWith(prefix))) {
      if (chrome.notifications && chrome.notifications.create) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/icon-48.png',
          title: 'Line Localization Machine',
          message: 'Cannot translate this page. Try opening the extension popup instead.',
        });
      }
      return;
    }

    try {
      await BrowserAPI.injectScript(tab.id, { file: 'content/content-script.js' });
      await BrowserAPI.insertCSS(tab.id, { file: 'content/animations.css' });

      const settings = await this.getSettings();

      if (!settings.apiKey) {
        if (BrowserAPI.isFirefox) {
          chrome.tabs.create({ url: 'settings/settings.html' });
        } else {
          chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
        }
        return;
      }

      chrome.tabs.sendMessage(tab.id, {
        action: 'START_TRANSLATION',
        tabId: tab.id,
        settings,
      });
    } catch (error) {
      console.error('Error handling action click:', error);
      if (chrome.notifications && chrome.notifications.create) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/icon-48.png',
          title: 'Error',
          message: 'Failed to start translation. Please try again.',
        });
      }
    }
  }

  // ─── Translation Request ───────────────────────────────────────────────────

  async handleTranslationRequest(message) {
    const { translationData, settings } = message;

    if (!translationData || !translationData.blocks || !Array.isArray(translationData.blocks)) {
      return {
        success: false,
        error: 'Invalid translation data: missing blocks array',
        errorType: 'client_error',
        isRetryable: false,
      };
    }

    try {
      const totalChars = translationData.blocks.reduce(
        (sum, b) =>
          sum +
          b.items.reduce(
            (s, item) =>
              s + (Array.isArray(item) ? item.reduce((c, seg) => c + String(seg).length, 0) : 0),
            0
          ),
        0
      );
      const maxTokens = Math.min(16000, Math.max(2000, totalChars * 4));
      // Scale timeout: 30s base + 10s per 1000 chars, capped at 180s
      const timeout = Math.min(180000, 30000 + Math.ceil(totalChars / 1000) * 10000);

      const result = await this.APIClient.translate(
        {
          apiKey: settings.apiKey,
          apiEndpoint: settings.apiEndpoint,
          model: settings.model,
        },
        translationData,
        {
          temperature: settings.temperature !== undefined ? settings.temperature : 0.3,
          maxTokens,
          timeout,
          reasoningEffort: settings.reasoningEffort || 'off',
        }
      );

      if (result.success) {
        return {
          success: true,
          blocks: result.blocks,
          usage: result.usage,
          model: result.model,
        };
      } else {
        return {
          success: false,
          error: result.error,
          errorType: result.errorType,
          errorStatus: result.errorStatus,
          isRetryable: result.isRetryable,
          apiMessage: result.apiMessage,
          retryAfter: result.retryAfter,
        };
      }
    } catch (error) {
      console.error('Translation API error:', error);

      let errorMessage = 'Unknown error occurred';
      if (error && typeof error.message === 'string') {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && error.toString) {
        try {
          errorMessage = error.toString();
        } catch (e) {
          errorMessage = 'Error could not be serialized';
        }
      }

      return {
        success: false,
        error: errorMessage,
        errorType: error.type || error.errorType || 'unknown',
        isRetryable: error.isRetryable || false,
      };
    }
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  async getSettings() {
    if (!this.ModelConfig) await this.loadSharedConfig();
    const defaultSettings = this.ModelConfig.getDefaultSettings();
    const settings = await chrome.storage.local.get(Object.keys(defaultSettings));
    return { ...defaultSettings, ...settings };
  }

  async saveSettings(newSettings) {
    await chrome.storage.local.set(newSettings);
    return { success: true };
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  async getCurrentTabId(sender) {
    if (sender && sender.tab && sender.tab.id) {
      return { success: true, tabId: sender.tab.id };
    }
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        return { success: true, tabId: tabs[0].id };
      }
    } catch (error) {
      console.warn('Could not get current tab ID:', error);
    }
    return { success: false, error: 'Could not determine tab ID' };
  }

  getLanguageName(languageCode) {
    const languageMap = {
      spanish: 'Spanish',
      french: 'French',
      german: 'German',
      chinese: 'Simplified Chinese',
      'chinese-traditional': 'Traditional Chinese',
      japanese: 'Japanese',
      korean: 'Korean',
      portuguese: 'Portuguese',
      italian: 'Italian',
      russian: 'Russian',
      arabic: 'Arabic',
      hindi: 'Hindi',
      dutch: 'Dutch',
      swedish: 'Swedish',
      norwegian: 'Norwegian',
    };
    return languageMap[languageCode] || languageCode;
  }
}

// Initialize the background script
new BackgroundScript();
