// Cross-browser API abstraction for background scripts
import ModelConfig from '../shared/models.js';
import APIClient from '../shared/api-client.js';
import { DEBUG, DebugLogger } from '../shared/debug.js';
// Minimal abstraction for genuine browser differences only
const BrowserAPI = {
  get isFirefox() {
    return typeof browser !== 'undefined';
  },

  // Action API still differs between browsers
  get action() {
    return this.isFirefox ? browser.browserAction : chrome.action;
  },

  // Script injection methods differ
  async injectScript(tabId, options) {
    if (this.isFirefox) {
      return await browser.tabs.executeScript(tabId, options);
    } else {
      return await chrome.scripting.executeScript({
        target: { tabId },
        files: options.file ? [options.file] : undefined,
      });
    }
  },

  async insertCSS(tabId, options) {
    if (this.isFirefox) {
      return await browser.tabs.insertCSS(tabId, options);
    } else {
      return await chrome.scripting.insertCSS({
        target: { tabId },
        files: options.file ? [options.file] : undefined,
      });
    }
  },
};

class BackgroundScript {
  constructor() {
    this.translationStates = new Map(); // Store translation state per tab ID
    // Initialize with imported modules
    this.ModelConfig = ModelConfig;
    this.APIClient = APIClient;
    this.debug = DEBUG;
    this.debugLogger = DebugLogger;
    this.init();
  }

  async init() {
    // Handle extension installation
    chrome.runtime.onInstalled.addListener(details => {
      if (details.reason === 'install') {
        this.handleInstallation();
      } else if (details.reason === 'update') {
        this.handleUpdate();
      }
    });

    // Handle messages from content scripts and popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // For Chrome service workers, we need to handle async properly
      const handleAsync = async () => {
        try {
          const result = await this.handleMessage(message, sender, sendResponse);
          sendResponse(result);
        } catch (error) {
          console.error('Background message handler error:', error);
          sendResponse({ success: false, error: error.message });
        }
      };

      // Chrome service workers require returning true to keep message channel open for async responses
      if (!BrowserAPI.isFirefox) {
        handleAsync();
        return true; // Keep message channel open
      } else {
        // Firefox can handle the promise directly
        return this.handleMessage(message, sender, sendResponse);
      }
    });

    // Handle action clicks (extension icon)
    BrowserAPI.action.onClicked.addListener(tab => {
      this.handleActionClick(tab);
    });

    // Clean up translation states when tabs are closed
    chrome.tabs.onRemoved.addListener(tabId => {
      this.translationStates.delete(tabId);
      console.log(`Cleaned up translation state for closed tab ${tabId}`);
    });

    // Clean up translation states when tabs are navigated/refreshed
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      // Debug logging to understand Firefox behavior
      if (this.debug && this.translationStates.has(tabId)) {
        console.log(`Tab ${tabId} updated:`, changeInfo);
      }

      // Clear state when page starts loading (navigation/refresh)
      // Firefox-compatible: be more permissive with conditions
      const shouldClear = this.shouldClearTranslationState(changeInfo, tabId);

      if (shouldClear && this.translationStates.has(tabId)) {
        this.translationStates.delete(tabId);
        console.log(
          `Cleaned up translation state for navigated/refreshed tab ${tabId} (${changeInfo.status || 'unknown status'})`
        );
      }
    });

    // Start periodic cleanup for stale states (every 2 minutes)
    this.startPeriodicCleanup();

    // Firefox-specific: Add additional event listeners for better state cleanup
    if (BrowserAPI.isFirefox) {
      this.addFirefoxSpecificListeners();
    }
  }

  shouldClearTranslationState(changeInfo, tabId) {
    // Firefox-compatible state clearing logic

    // Original Chrome logic (strict)
    if (changeInfo.status === 'loading' && changeInfo.url) {
      return true;
    }

    // Firefox-compatible additions
    if (BrowserAPI.isFirefox) {
      // Firefox might send different status values or missing url
      if (changeInfo.status === 'loading' || (changeInfo.status === 'complete' && changeInfo.url)) {
        return true;
      }

      // URL change without status (navigation)
      if (changeInfo.url && !changeInfo.status) {
        return true;
      }

      // Title change often indicates page load completion after navigation
      if (changeInfo.title && changeInfo.url) {
        return true;
      }
    }

    return false;
  }

  addFirefoxSpecificListeners() {
    // Firefox-specific event handling for better state cleanup

    // Listen for tab activation (when user switches to a tab)
    chrome.tabs.onActivated.addListener(async activeInfo => {
      const { tabId } = activeInfo;

      // When user switches to a tab, verify the translation state is still valid
      if (this.translationStates.has(tabId)) {
        try {
          const tab = await chrome.tabs.get(tabId);
          const storedState = this.translationStates.get(tabId);

          // URL validation on tab activation
          if (storedState.url && storedState.url !== tab.url) {
            if (this.debug) {
              console.log(`[Firefox] Tab ${tabId} activation: URL changed, clearing state`);
            }
            this.translationStates.delete(tabId);
          }
        } catch (error) {
          if (this.debug) {
            console.log(`[Firefox] Tab ${tabId} activation: Tab not found, clearing state`);
          }
          this.translationStates.delete(tabId);
        }
      }
    });

    // Listen for window focus changes (Firefox-specific behavior)
    chrome.windows.onFocusChanged.addListener(async windowId => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        return; // No window focused
      }

      // When window gains focus, check active tab state
      try {
        const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
        if (tabs.length > 0) {
          const tab = tabs[0];
          if (this.translationStates.has(tab.id)) {
            const storedState = this.translationStates.get(tab.id);

            // Enhanced URL validation on window focus
            if (storedState.url && storedState.url !== tab.url) {
              if (this.debug) {
                console.log(`[Firefox] Window focus: Tab ${tab.id} URL changed, clearing state`);
              }
              this.translationStates.delete(tab.id);
            }
          }
        }
      } catch (error) {
        console.warn('[Firefox] Error during window focus state check:', error);
      }
    });
  }

  startPeriodicCleanup() {
    // Clean up stale translation states every 2 minutes
    setInterval(
      async () => {
        try {
          await this.performPeriodicCleanup();
        } catch (error) {
          console.warn('Periodic cleanup failed:', error);
        }
      },
      2 * 60 * 1000
    ); // 2 minutes
  }

  async performPeriodicCleanup() {
    const maxAge = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    const staleTabIds = [];

    // Check each stored translation state
    for (const [tabId, state] of this.translationStates.entries()) {
      try {
        // Age-based cleanup
        if (state.timestamp && now - state.timestamp > maxAge) {
          staleTabIds.push(tabId);
          continue;
        }

        // Tab validity check
        try {
          await chrome.tabs.get(tabId);
          // Tab still exists, keep the state
        } catch (tabError) {
          // Tab no longer exists
          staleTabIds.push(tabId);
        }
      } catch (error) {
        console.warn(`Error during cleanup check for tab ${tabId}:`, error);
        staleTabIds.push(tabId);
      }
    }

    // Remove stale states
    if (staleTabIds.length > 0) {
      if (this.debug) {
        console.log(`Periodic cleanup: removing ${staleTabIds.length} stale translation states`);
      }
      staleTabIds.forEach(tabId => this.translationStates.delete(tabId));
    }
  }

  async handleInstallation() {
    // Load shared models config
    await this.loadSharedConfig();

    // Set default settings
    const defaultSettings = this.ModelConfig.getDefaultSettings();
    await chrome.storage.local.set(defaultSettings);

    // Open settings page on first install
    if (BrowserAPI.isFirefox) {
      chrome.tabs.create({ url: 'settings/settings.html' });
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
    }
  }

  async handleUpdate() {
    console.log('Line Localization Machine updated');
  }

  async handleMessage(message, sender) {
    try {
      switch (message.action) {
        case 'TRANSLATE_REQUEST':
          return await this.handleTranslationRequest(message, sender);

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
          return await this.updateTranslationState(message.tabId, message.state);

        case 'GET_TRANSLATION_STATE':
          return { state: await this.getTranslationState(message.tabId) };

        case 'CLEAR_TRANSLATION_STATE':
          return this.clearTranslationState(message.tabId);

        case 'GET_CURRENT_TAB_ID':
          return await this.getCurrentTabId(sender);

        default:
          throw new Error(`Unknown action: ${message.action}`);
      }
    } catch (error) {
      console.error('Background script error:', error);

      // Safe error message extraction
      let errorMessage = 'Unknown error occurred';
      if (error && typeof error.message === 'string') {
        errorMessage = error.message;
      } else if (error && typeof error === 'string') {
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

  async handleActionClick(tab) {
    // Check if we can access the tab
    const restrictedUrls = BrowserAPI.isFirefox
      ? ['about:', 'moz-extension:']
      : ['chrome:', 'chrome-extension:', 'edge:', 'extension:'];

    const isRestricted = restrictedUrls.some(prefix => tab.url.startsWith(prefix));

    if (isRestricted) {
      // Can't inject into system pages
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
      // Inject content script if not already injected
      await BrowserAPI.injectScript(tab.id, {
        file: 'content/content-script.js',
      });

      await BrowserAPI.insertCSS(tab.id, {
        file: 'content/animations.css',
      });

      // Get settings and start translation
      const settings = await this.getSettings();

      if (!settings.apiKey) {
        // Open settings page for first-time setup
        if (BrowserAPI.isFirefox) {
          chrome.tabs.create({ url: 'settings/settings.html' });
        } else {
          chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
        }
        return;
      }

      // Send translation start message
      chrome.tabs.sendMessage(tab.id, {
        action: 'START_TRANSLATION',
        tabId: tab.id, // Include tab ID for state management
        settings: settings,
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

  async handleTranslationRequest(message, sender) {
    const { text, settings, translationHistory = [] } = message;

    try {
      // Use centralized API client for translation with context
      const result = await this.APIClient.translate(
        {
          apiKey: settings.apiKey,
          apiEndpoint: settings.apiEndpoint,
          model: settings.model,
        },
        text,
        this.getLanguageName(settings.targetLanguage), // Convert language code to display name
        {
          translationHistory: translationHistory, // Pass translation history for context
          temperature: settings.temperature !== undefined ? settings.temperature : 0.3,
          maxTokens: Math.min(2000, Math.max(100, text.length * 2)),
          timeout: 30000,
        }
      );

      if (result.success) {
        return {
          success: true,
          translatedText: result.translatedText,
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

      // Safe error message extraction
      let errorMessage = 'Unknown error occurred';
      if (error && typeof error.message === 'string') {
        errorMessage = error.message;
      } else if (error && typeof error === 'string') {
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

  async getSettings() {
    // Ensure shared config is loaded
    if (!this.ModelConfig) {
      await this.loadSharedConfig();
    }

    const defaultSettings = this.ModelConfig.getDefaultSettings();
    const settings = await chrome.storage.local.get(Object.keys(defaultSettings));

    return {
      ...defaultSettings,
      ...settings,
    };
  }

  async saveSettings(newSettings) {
    await chrome.storage.local.set(newSettings);
    return { success: true };
  }

  async updateTranslationState(tabId, state) {
    if (!tabId) {
      console.warn('No tabId provided for updateTranslationState');
      return { success: false, error: 'Tab ID required' };
    }

    // Get current tab URL for validation
    try {
      const tab = await chrome.tabs.get(tabId);
      const enhancedState = {
        ...state,
        url: tab.url,
        timestamp: Date.now(),
      };

      this.translationStates.set(tabId, enhancedState);

      // Enhanced debugging for tab ID issues
      if (this.debug) {
        console.log(`[TabID Debug] Storing translation state for tab ${tabId}:`, {
          isTranslating: state.isTranslating,
          status: state.status,
          progress: state.progress,
          completed: state.completedBlocks,
          total: state.totalBlocks,
          url: tab.url,
          timestamp: enhancedState.timestamp,
          allStoredTabIds: Array.from(this.translationStates.keys()),
          totalStates: this.translationStates.size,
        });
      }

      if (this.debugLogger?.isEnabled()) {
        this.debugLogger.log(`✓ Updated translation state for tab ${tabId}:`, {
          isTranslating: state.isTranslating,
          status: state.status,
          progress: state.progress,
          completed: state.completedBlocks,
          total: state.totalBlocks,
          url: tab.url,
        });
        this.debugLogger.log(
          'All translation states:',
          Array.from(this.translationStates.entries())
        );
      }

      return { success: true };
    } catch (error) {
      console.warn(`Failed to get tab ${tabId} for state update:`, error);
      // Fallback: store state without URL validation
      const enhancedState = {
        ...state,
        timestamp: Date.now(),
      };
      this.translationStates.set(tabId, enhancedState);
      return { success: true };
    }
  }

  async getTranslationState(tabId) {
    if (!tabId) {
      console.warn('No tabId provided for getTranslationState');
      return null;
    }

    const storedState = this.translationStates.get(tabId);
    if (!storedState) {
      return null;
    }

    // Timestamp-based cleanup (states older than 10 minutes are considered stale)
    const maxAge = 10 * 60 * 1000; // 10 minutes
    if (storedState.timestamp && Date.now() - storedState.timestamp > maxAge) {
      console.log(`Clearing expired translation state for tab ${tabId}`);
      this.translationStates.delete(tabId);
      return null;
    }

    // URL-based validation
    try {
      const currentTab = await chrome.tabs.get(tabId);

      if (storedState.url && currentTab.url !== storedState.url) {
        console.log(
          `URL changed for tab ${tabId}: ${storedState.url} → ${currentTab.url}, clearing state`
        );
        this.translationStates.delete(tabId);
        return null;
      }

      if (this.debugLogger?.isEnabled()) {
        this.debugLogger.log(`🔍 Getting translation state for tab ${tabId}:`, storedState);
        this.debugLogger.log('Available states:', Array.from(this.translationStates.keys()));
      }

      return storedState;
    } catch (error) {
      console.warn(`Failed to validate tab ${tabId} state:`, error);
      // If we can't get the tab (maybe it was closed), clear the state
      this.translationStates.delete(tabId);
      return null;
    }
  }

  clearTranslationState(tabId) {
    if (!tabId) {
      console.warn('No tabId provided for clearTranslationState');
      return { success: false, error: 'Tab ID required' };
    }

    const hadState = this.translationStates.has(tabId);
    const stateDetails = hadState ? this.translationStates.get(tabId) : null;

    // Enhanced debugging for tab ID issues
    if (this.debug) {
      console.log(`[TabID Debug] Clearing translation state for tab ${tabId}:`, {
        hadState,
        stateDetails: stateDetails
          ? {
              isTranslating: stateDetails.isTranslating,
              status: stateDetails.status,
              url: stateDetails.url,
              timestamp: stateDetails.timestamp,
            }
          : null,
        allStoredTabIds: Array.from(this.translationStates.keys()),
        totalStates: this.translationStates.size,
      });
    }

    this.translationStates.delete(tabId);
    return { success: true };
  }

  async getCurrentTabId(sender) {
    // Return tab ID from sender if available
    if (sender && sender.tab && sender.tab.id) {
      return { success: true, tabId: sender.tab.id };
    }

    // If no sender tab ID, try to get active tab
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
