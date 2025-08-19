// Minimal abstraction for genuine browser differences
const BrowserAPI = {
  // Keep this helper method since the array destructuring differs slightly
  async getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  },
};

class BeautifulPopupController {
  constructor() {
    this.elements = {
      quickLanguage: document.getElementById('quickLanguage'),
      translatePage: document.getElementById('translatePage'),
      openSettings: document.getElementById('openSettings'),
      statusBadge: document.getElementById('statusBadge'),
      statusText: document.getElementById('statusText'),
      statusMessage: document.getElementById('statusMessage'),
    };

    this.settings = {};
    this.isTranslating = false;
    this.translationState = null;
    this.refreshTimer = null;
    this.debug = false; // Set to true for verbose logging
    this.init();
  }

  async loadSharedConfig() {
    // Load the shared model configuration using dynamic import
    try {
      const module = await import('../shared/models.js');
      this.ModelConfig = module.default;
    } catch (error) {
      console.error('Failed to load shared config, using fallback:', error);
      // Fallback configuration if loading fails
      this.ModelConfig = {
        DEFAULT_MODEL: 'gpt-4o-mini',
        getDefaultSettings() {
          return {
            apiKey: '',
            apiEndpoint: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            customModel: '',
            targetLanguage: 'chinese-traditional',
            animationSpeed: 'normal',
            showProgress: true,
            playSound: false,
            maxBlockSize: 5,
            temperature: 0.3,
            blocksPerRequest: 5,
          };
        },
      };
    }
  }

  isFirefox() {
    // Detect if running in Firefox (browser object exists in Firefox extensions)
    return typeof browser !== 'undefined';
  }

  async handleFirefoxStateCheck(tab) {
    try {
      // Firefox-specific: Enhanced state validation using URL and content script checks

      // First, get the stored translation state from background
      const response = await this.sendMessageWithRetry({
        action: 'GET_TRANSLATION_STATE',
        tabId: tab.id,
      });

      const storedState = response?.state;

      if (!storedState) {
        // No stored state, nothing to validate
        return;
      }

      // URL validation: If stored URL doesn't match current URL, clear state
      if (storedState.url && storedState.url !== tab.url) {
        if (this.debug) {
          console.log(
            `Firefox: URL mismatch detected. Stored: ${storedState.url}, Current: ${tab.url}`
          );
        }

        await this.sendMessageWithRetry({
          action: 'CLEAR_TRANSLATION_STATE',
          tabId: tab.id,
        });

        this.translationState = null;
        this.isTranslating = false;
        return;
      }

      // Additional validation: Check if content script is available
      // This helps catch cases where the page was refreshed but URL remained the same
      try {
        const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
        if (this.debug) {
          console.log('Firefox: Content script available, state appears valid');
        }
      } catch (contentScriptError) {
        if (this.debug) {
          console.log('Firefox: Content script not available, clearing state as precaution');
        }

        await this.sendMessageWithRetry({
          action: 'CLEAR_TRANSLATION_STATE',
          tabId: tab.id,
        });

        this.translationState = null;
        this.isTranslating = false;
      }
    } catch (error) {
      if (this.debug) {
        console.warn('Firefox state check failed:', error);
      }
      // On error, assume page was refreshed and clear state
      this.translationState = null;
      this.isTranslating = false;
    }
  }

  async init() {
    await this.loadSettings();
    await this.checkTranslationState();
    this.updateUI();
    this.bindEvents();
    this.addEntryAnimations();

    // Cleanup when popup is closed
    window.addEventListener('beforeunload', () => {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
    });

    // Also cleanup on visibility change (when popup is hidden)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
        console.log('Stopped refresh timer due to popup becoming hidden');
      }
    });
  }

  addEntryAnimations() {
    // Stagger the card animations
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, index) => {
      card.style.opacity = '0';
      card.style.transform = 'translateX(-20px)';

      setTimeout(
        () => {
          card.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
          card.style.opacity = '1';
          card.style.transform = 'translateX(0)';
        },
        100 + index * 100
      );
    });
  }

  async loadSettings() {
    try {
      this.settings = await chrome.storage.local.get([
        'apiKey',
        'apiEndpoint',
        'model',
        'targetLanguage',
        'animationSpeed',
        'showProgress',
        'playSound',
        'maxBlockSize',
        'temperature',
        'blocksPerRequest',
      ]);

      // Load shared config if not available
      if (!this.ModelConfig) {
        await this.loadSharedConfig();
      }

      // Set defaults if missing
      this.settings = {
        ...this.ModelConfig.getDefaultSettings(),
        ...this.settings,
      };
    } catch (error) {
      console.error('Error loading settings:', error);
      this.updateStatusBadge('error', 'Config Error');
    }
  }

  async checkTranslationState() {
    try {
      // Get current active tab
      const tab = await BrowserAPI.getActiveTab();
      if (!tab || !tab.id) {
        console.warn('No active tab found');
        this.translationState = null;
        return;
      }

      // Enhanced debugging for tab ID tracking
      if (this.debug) {
        console.log(`[TabID Debug] Popup checking translation state:`, {
          tabId: tab.id,
          tabUrl: tab.url,
          tabTitle: tab.title,
          isFirefox: this.isFirefox(),
          currentTime: Date.now(),
        });
      }

      // Firefox-specific: Check if page was recently refreshed/navigated
      // Firefox may not properly clear translation states on page refresh
      if (this.isFirefox()) {
        await this.handleFirefoxStateCheck(tab);
      }

      // For Chrome, ensure service worker is ready before making requests
      if (typeof chrome !== 'undefined') {
        await this.ensureServiceWorkerReady();
      }

      const response = await this.sendMessageWithRetry({
        action: 'GET_TRANSLATION_STATE',
        tabId: tab.id,
      });

      // Enhanced debugging for state response
      if (this.debug) {
        console.log(`[TabID Debug] Background state response for tab ${tab.id}:`, {
          hasResponse: !!response,
          hasState: !!response?.state,
          stateDetails: response?.state
            ? {
                isTranslating: response.state.isTranslating,
                status: response.state.status,
                url: response.state.url,
                timestamp: response.state.timestamp,
              }
            : null,
        });
      }

      this.translationState = response?.state || null;

      // Immediate local state reset if background has no state
      if (!this.translationState) {
        if (this.debug) {
          console.log(`[TabID Debug] No background state found, resetting local state`);
        }
        this.isTranslating = false;
        // Reset UI to default state
        this.updateUI();
        return;
      }

      if (this.translationState && this.translationState.isTranslating) {
        this.isTranslating = true;
        if (this.debug) {
          console.log(`[TabID Debug] Found ongoing translation:`, this.translationState);
        }
      }
    } catch (error) {
      console.warn('Failed to get translation state:', error);
      this.translationState = null;
      this.isTranslating = false;
    }
  }

  async ensureServiceWorkerReady(maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (this.debug) {
          console.log(`Service worker health check attempt ${attempt}/${maxAttempts}`);
        }
        const response = await chrome.runtime.sendMessage({ action: 'HEALTH_CHECK' });
        if (response?.status === 'healthy') {
          if (this.debug) {
            console.log('Service worker ready');
          }
          return true;
        }
      } catch (error) {
        if (this.debug) {
          console.warn(`Service worker health check failed (attempt ${attempt}):`, error);
        }
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // Exponential backoff
        }
      }
    }
    if (this.debug) {
      console.warn('Service worker may not be ready, continuing anyway');
    }
    return false;
  }

  async sendMessageWithRetry(message, maxAttempts = 2) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (this.debug) {
          console.log(`Sending message (attempt ${attempt}/${maxAttempts}):`, message);
        }
        const response = await chrome.runtime.sendMessage(message);
        if (this.debug) {
          console.log('Message response:', response);
        }

        // Chrome sometimes returns undefined instead of proper response
        if (response === undefined) {
          throw new Error('Received undefined response from background script');
        }

        return response;
      } catch (error) {
        if (this.debug) {
          console.warn(`Message attempt ${attempt} failed:`, error);
        }
        lastError = error;

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 50 * attempt));
        }
      }
    }

    throw lastError;
  }

  updateUI() {
    // Set default language in dropdown
    if (this.settings.targetLanguage) {
      this.elements.quickLanguage.value = this.settings.targetLanguage;
    }

    // Defensive state reset: If no translation state, ensure local flags are reset
    if (!this.translationState) {
      if (this.debug) {
        console.log(`[TabID Debug] updateUI: No translation state, resetting local flags`);
      }
      this.isTranslating = false;
      this.clearTranslationState(); // Clear any UI artifacts
    }

    // Update status badge and UI state based on current translation state
    if (!this.settings.apiKey) {
      this.updateStatusBadge('warning', 'Setup Needed');
      this.elements.translatePage.disabled = true;
      this.showSetupInfo();
    } else if (this.translationState && this.translationState.isTranslating) {
      // Show current translation status
      this.showTranslationInProgress();
    } else {
      this.updateStatusBadge('ready', 'Ready');
      this.elements.translatePage.disabled = false;
      // Ensure animation state is cleared
      this.stopTranslationAnimation();
    }
  }

  showSetupInfo() {
    this.showStatusMessage('Add API key in settings to get started', 'warning', 8000);
  }

  showTranslationInProgress() {
    const state = this.translationState;
    let statusText = 'Working';
    let statusMessage = 'Translation in progress...';

    if (state.status === 'starting') {
      statusText = 'Starting';
      statusMessage = 'Analyzing page content...';
    } else if (state.status === 'translating') {
      statusText = 'Translating';
      const progress = state.progress || 0;
      const completed = state.completedBlocks || 0;
      const total = state.totalBlocks || 0;

      if (total > 0) {
        statusMessage = `Translating... ${completed}/${total} blocks (${progress}%)`;
      } else {
        statusMessage = 'Translating content...';
      }
    } else if (state.status === 'completed') {
      statusText = 'Completed';
      statusMessage = 'Translation finished!';
      // Stop refresh timer when completed
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
    } else if (state.status === 'error') {
      statusText = 'Error';
      // Show user-friendly error message based on error type
      if (state.errorType === 'authentication') {
        statusMessage = 'Invalid API key';
      } else if (state.errorType === 'client_error') {
        statusMessage = 'Configuration error';
      } else {
        statusMessage = state.error || 'Translation failed';
      }
      // Stop refresh timer on error
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
    }

    this.updateStatusBadge('working', statusText);
    this.showStatusMessage(statusMessage, 'info');
    this.elements.translatePage.disabled = true;
    this.startTranslationAnimation();

    // Start periodic refresh to show live progress (avoid recursion)
    if (!this.refreshTimer && state.isTranslating) {
      this.refreshTimer = setInterval(async () => {
        try {
          await this.checkTranslationState();
          if (this.translationState && this.translationState.isTranslating) {
            // Update display without calling showTranslationInProgress (avoid recursion)
            this.updateTranslationDisplay();
          } else {
            // Translation finished, stop refreshing
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
            this.updateUI();
          }
        } catch (error) {
          console.warn('Error in refresh timer:', error);
          // Stop timer on persistent errors
          clearInterval(this.refreshTimer);
          this.refreshTimer = null;
          this.updateUI();
        }
      }, 1000);
    }
  }

  updateTranslationDisplay() {
    // Update display for ongoing translation without starting timers
    const state = this.translationState;
    if (!state) return;

    let statusText = 'Working';
    let statusMessage = 'Translation in progress...';
    let badgeType = 'working';

    if (state.status === 'starting') {
      statusText = 'Starting';
      statusMessage = 'Analyzing page content...';
    } else if (state.status === 'translating') {
      statusText = 'Translating';
      const progress = state.progress || 0;
      const completed = state.completedBlocks || 0;
      const total = state.totalBlocks || 0;

      if (total > 0) {
        statusMessage = `Translating... ${completed}/${total} blocks (${progress}%)`;
      } else {
        statusMessage = 'Translating content...';
      }
    } else if (state.status === 'completed') {
      statusText = 'Completed';
      statusMessage = 'Translation finished!';
      badgeType = 'ready';
    } else if (state.status === 'error') {
      statusText = 'Error';
      badgeType = 'error';
      // Show user-friendly error message based on error type
      if (state.errorType === 'authentication') {
        statusMessage = 'Invalid API key';
      } else if (state.errorType === 'client_error') {
        statusMessage = 'Configuration error';
      } else {
        statusMessage = state.error || 'Translation failed';
      }
    }

    this.updateStatusBadge(badgeType, statusText);
    this.showStatusMessage(statusMessage, 'info');
    this.elements.translatePage.disabled = state.isTranslating;
  }

  bindEvents() {
    this.elements.translatePage.addEventListener('click', () => this.translatePage());
    this.elements.openSettings.addEventListener('click', () => this.openSettings());

    // Update language preference when changed
    this.elements.quickLanguage.addEventListener('change', async () => {
      if (this.elements.quickLanguage.value) {
        try {
          await chrome.storage.local.set({
            targetLanguage: this.elements.quickLanguage.value,
          });
          this.settings.targetLanguage = this.elements.quickLanguage.value;

          // Show quick feedback
          this.showStatusMessage('Language updated!', 'success', 2000);
        } catch (error) {
          console.error('Error saving language preference:', error);
        }
      }
    });

    // Add hover effects
    this.elements.translatePage.addEventListener('mouseenter', () => {
      if (!this.isTranslating && !this.elements.translatePage.disabled) {
        this.elements.translatePage.style.transform = 'translateY(-3px) scale(1.02)';
      }
    });

    this.elements.translatePage.addEventListener('mouseleave', () => {
      if (!this.isTranslating) {
        this.elements.translatePage.style.transform = '';
      }
    });
  }

  async translatePage() {
    if (!this.settings.apiKey) {
      this.showStatusMessage('Please configure your API key in settings first', 'warning');
      setTimeout(() => this.openSettings(), 1500);
      return;
    }

    // Check current state before starting
    await this.checkTranslationState();
    if (this.isTranslating || (this.translationState && this.translationState.isTranslating)) {
      this.showStatusMessage('Translation is already in progress', 'warning');
      return;
    }

    try {
      this.isTranslating = true;

      // Clear any existing progress/error state
      this.clearTranslationState();

      this.startTranslationAnimation();

      // Get active tab
      const tab = await BrowserAPI.getActiveTab();

      // Determine target language (quick select overrides default)
      const targetLanguage = this.elements.quickLanguage.value || this.settings.targetLanguage;

      this.showStatusMessage('Analyzing page content...', 'info');

      // Clear existing translation state in background script
      try {
        await chrome.runtime.sendMessage({
          action: 'CLEAR_TRANSLATION_STATE',
          tabId: tab.id,
        });
      } catch (error) {
        console.warn('Failed to clear background translation state:', error);
      }

      // Send message to content script with error handling
      let response;
      try {
        const translationMessage = {
          action: 'START_TRANSLATION',
          tabId: tab.id, // Include tab ID for state management
          settings: {
            ...this.settings,
            targetLanguage: targetLanguage,
          },
        };

        // Enhanced debugging for translation initiation
        if (this.debug) {
          console.log(`[TabID Debug] Popup starting translation:`, {
            tabId: tab.id,
            tabUrl: tab.url,
            messageTabId: translationMessage.tabId,
            isFirefox: this.isFirefox(),
          });
        }

        response = await chrome.tabs.sendMessage(tab.id, translationMessage);
      } catch (messageError) {
        // Content script might not be injected yet, try to inject and retry
        console.log('Content script not available, attempting injection...');
        try {
          if (chrome.scripting) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content/content-script.js'],
            });
            await chrome.scripting.insertCSS({
              target: { tabId: tab.id },
              files: ['content/animations.css'],
            });
          }
          // Retry the message
          await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay for injection

          if (this.debug) {
            console.log(`[TabID Debug] Popup retrying translation after injection:`, {
              tabId: tab.id,
              tabUrl: tab.url,
            });
          }

          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'START_TRANSLATION',
            tabId: tab.id,
            settings: {
              ...this.settings,
              targetLanguage: targetLanguage,
            },
          });
        } catch (injectionError) {
          throw new Error(
            'Could not establish connection with page. Please refresh and try again.'
          );
        }
      }

      if (this.debug) {
        console.log('Content script response:', response);
      }

      if (response && response.success) {
        this.showStatusMessage('Translation started! Watch the magic happen ✨', 'success', 3000);
        this.updateStatusBadge('working', 'Translating');

        // Show success animation
        this.showSuccessAnimation();

        // Check translation state to show progress immediately
        setTimeout(async () => {
          await this.checkTranslationState();
          if (this.translationState && this.translationState.isTranslating) {
            this.showTranslationInProgress();
          }
        }, 500);

        // Close popup after delay
        setTimeout(() => window.close(), 2000);
      } else {
        // Enhanced error handling with error type information
        const error = new Error(response?.error || 'Translation failed');
        if (response?.errorType) {
          error.errorType = response.errorType;
          error.errorStatus = response.errorStatus;
          error.apiMessage = response.apiMessage;
        }
        throw error;
      }
    } catch (error) {
      console.error('Translation error:', error);

      // Handle specific error types with user-friendly messages
      if (error.errorType === 'authentication') {
        this.showStatusMessage('Invalid API key. Please check your settings.', 'error', 8000);
        this.updateStatusBadge('error', 'Auth Failed');
      } else if (error.errorType === 'forbidden') {
        this.showStatusMessage('Access denied. Check your API key permissions.', 'error', 8000);
        this.updateStatusBadge('error', 'Access Denied');
      } else if (error.errorType === 'not_found') {
        this.showStatusMessage('Model not found. Please check your model settings.', 'error', 8000);
        this.updateStatusBadge('error', 'Model Error');
      } else if (error.errorType === 'rate_limit') {
        this.showStatusMessage('Rate limit exceeded. Please try again later.', 'warning', 8000);
        this.updateStatusBadge('warning', 'Rate Limited');
      } else if (error.errorType === 'client_error') {
        this.showStatusMessage('Configuration error. Please check your settings.', 'error', 8000);
        this.updateStatusBadge('error', 'Config Error');
      } else if (error.message.includes('Could not establish connection')) {
        this.showStatusMessage('Please refresh the page and try again', 'error');
        this.updateStatusBadge('error', 'Connection Error');
      } else if (error.message.includes('Cannot translate')) {
        this.showStatusMessage('This page cannot be translated', 'warning');
        this.updateStatusBadge('warning', 'Not Supported');
      } else if (error.message.includes('No tab with id')) {
        this.showStatusMessage('Page not accessible. Try refreshing the page.', 'error');
        this.updateStatusBadge('error', 'Page Error');
      } else if (error.message.includes('The message port closed')) {
        this.showStatusMessage('Page communication lost. Please refresh and try again.', 'error');
        this.updateStatusBadge('error', 'Connection Lost');
      } else {
        this.showStatusMessage(`Translation failed: ${error.message}`, 'error');
        this.updateStatusBadge('error', 'Failed');
      }
    } finally {
      this.isTranslating = false;
      this.stopTranslationAnimation();
    }
  }

  startTranslationAnimation() {
    this.elements.translatePage.classList.add('loading');
    this.elements.translatePage.querySelector('.btn-text').textContent = 'Translating...';
    this.elements.translatePage.disabled = true;
    this.updateStatusBadge('working', 'Working');
  }

  stopTranslationAnimation() {
    this.elements.translatePage.classList.remove('loading');
    this.elements.translatePage.querySelector('.btn-text').textContent = 'Translate Page';
    this.elements.translatePage.disabled = false;
  }

  showSuccessAnimation() {
    // Create confetti effect
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57'];
    for (let i = 0; i < 15; i++) {
      setTimeout(() => this.createConfetti(colors[i % colors.length]), i * 50);
    }
  }

  createConfetti(color) {
    const confetti = document.createElement('div');
    confetti.style.cssText = `
      position: absolute;
      width: 6px;
      height: 6px;
      background: ${color};
      border-radius: 50%;
      pointer-events: none;
      z-index: 1000;
      left: ${Math.random() * 100}%;
      top: 20px;
      animation: confettiFall 2s ease-out forwards;
    `;

    document.body.appendChild(confetti);

    // Add CSS animation if not already added
    if (!document.getElementById('confetti-style')) {
      const style = document.createElement('style');
      style.id = 'confetti-style';
      style.textContent = `
        @keyframes confettiFall {
          to {
            transform: translateY(500px) rotate(720deg);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => confetti.remove(), 2000);
  }

  openSettings() {
    // Open settings page using standard Chrome extension methods
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      // Fallback to creating new tab with extension URL
      const settingsUrl = chrome.runtime.getURL('settings/settings.html');
      chrome.tabs.create({ url: settingsUrl });
    }
  }

  updateStatusBadge(type, text) {
    this.elements.statusBadge.className = `status-badge ${type}`;
    this.elements.statusText.textContent = text;
  }

  showStatusMessage(message, type = 'info', duration = 4000) {
    const statusMessage = this.elements.statusMessage;
    const statusText = statusMessage.querySelector('.status-text');

    statusText.textContent = message;
    statusMessage.className = `status-message show ${type}`;

    clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => {
      statusMessage.classList.remove('show');
    }, duration);
  }

  clearTranslationState() {
    // Hide any existing status messages
    this.elements.statusMessage.classList.remove('show');

    // Clear any existing refresh timer
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Reset translation state
    this.translationState = null;

    // Clear status message timeout
    clearTimeout(this.statusTimeout);

    // Reset status badge to ready state (unless API key is missing)
    if (this.settings.apiKey) {
      this.updateStatusBadge('ready', 'Ready');
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new BeautifulPopupController();
});
