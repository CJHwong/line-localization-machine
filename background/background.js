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
        this.migrateSettings();
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

    // ─── Streaming translation via long-lived port ──────────────────────────
    chrome.runtime.onConnect.addListener(port => {
      if (port.name !== 'streaming-translate') return;

      // Abort the fetch when the port disconnects (page close/refresh/navigate)
      const abortController = new AbortController();
      let streamStarted = false;
      port.onDisconnect.addListener(() => {
        if (streamStarted) {
          abortController.abort();
          console.log('[Background] Port disconnected — aborting stream');
        } else {
          console.log('[Background] Port disconnected before stream started');
        }
      });

      port.onMessage.addListener(async message => {
        if (message.action !== 'START_STREAM') return;
        streamStarted = true;

        console.log(
          '[Background] START_STREAM received, signal aborted:',
          abortController.signal.aborted
        );

        const { translationData, settings } = message;

        if (!translationData?.blocks || !Array.isArray(translationData.blocks)) {
          port.postMessage({
            type: 'error',
            error: 'Invalid translation data: missing blocks array',
            isRetryable: false,
          });
          return;
        }

        try {
          const totalChars = translationData.blocks.reduce(
            (sum, b) =>
              sum +
              b.items.reduce(
                (s, item) =>
                  s +
                  (Array.isArray(item) ? item.reduce((c, seg) => c + String(seg).length, 0) : 0),
                0
              ),
            0
          );
          const maxTokens = Math.min(64000, Math.max(4000, totalChars * 4));

          // Throttle reasoning updates to avoid flooding the port.
          // Buffer recent text so each update carries a meaningful snippet.
          let lastReasoningUpdate = 0;
          const REASONING_THROTTLE_MS = 300;
          let reasoningTextBuffer = '';

          const result = await this.APIClient.streamTranslate(
            {
              apiKey: settings.apiKey,
              apiEndpoint: settings.apiEndpoint,
              model: settings.model,
            },
            translationData,
            {
              maxTokens,
              reasoningEffort: settings.reasoningEffort || 'off',
              signal: abortController.signal,
            },
            (blockIndex, block) => {
              try {
                port.postMessage({ type: 'block', index: blockIndex, block });
              } catch {
                // Port disconnected mid-stream — user navigated away
              }
            },
            ({ chars, elapsed, text }) => {
              reasoningTextBuffer += text;
              // Keep only the tail — no point buffering megabytes
              if (reasoningTextBuffer.length > 500) {
                reasoningTextBuffer = reasoningTextBuffer.slice(-400);
              }
              const now = Date.now();
              if (now - lastReasoningUpdate < REASONING_THROTTLE_MS) return;
              lastReasoningUpdate = now;
              try {
                port.postMessage({
                  type: 'reasoning',
                  chars,
                  elapsed,
                  snippet: reasoningTextBuffer.slice(-250),
                });
              } catch {
                // Port disconnected
              }
            }
          );

          if (abortController.signal.aborted) return; // Page gone, don't try to post

          if (result.success) {
            port.postMessage({ type: 'done', usage: result.usage, model: result.model });
          } else {
            port.postMessage({
              type: 'error',
              error: result.error,
              isRetryable: result.isRetryable || false,
            });
          }
        } catch (error) {
          console.error('Streaming translation error:', error);
          try {
            port.postMessage({
              type: 'error',
              error: error.message || 'Unknown streaming error',
              isRetryable: error.isRetryable || false,
            });
          } catch {
            // Port already disconnected
          }
        }
      });
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

  // ─── Migration ───────────────────────────────────────────────────────────

  async migrateSettings() {
    const stored = await chrome.storage.local.get('reasoningEffort');
    // Migrate 'off' → 'low': 'off' meant "don't send the parameter" which
    // let reasoning models burn unlimited thinking tokens on translation
    if (!stored.reasoningEffort || stored.reasoningEffort === 'off') {
      await chrome.storage.local.set({ reasoningEffort: 'low' });
      console.log('Migrated reasoningEffort: off → low');
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
