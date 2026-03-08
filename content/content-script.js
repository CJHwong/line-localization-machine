// Content scripts use background script for API calls (dynamic imports don't work reliably in content scripts)
// TextExtraction and Animation are loaded via manifest.json content_scripts before this file.

class LineLocalizationMachine {
  constructor() {
    this.isTranslating = false;
    this.translatedElements = new Map(); // element → { originalHTML, translatedHTML }
    this.translationSettings = null;
    this.animationQueue = [];
    this.translationHistory = []; // Store translation pairs for context
    this.totalBlocks = 0;
    this.completedBlocks = 0;
    this.tabId = null; // Store current tab ID
    this.debug = false; // Set to true for verbose logging

    this.init();
  }

  async init() {
    // Content script self-cleanup: Clear any stale translation state for this tab
    // This handles Firefox page refresh where tab update events don't fire reliably
    await this.performSelfCleanup();

    // Listen for messages from popup using unified API
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'START_TRANSLATION') {
        // Store tab ID from message or sender
        this.tabId = message.tabId || (sender && sender.tab && sender.tab.id) || null;

        if (this.debug) {
          console.log(`[TabID Debug] Content script received translation request:`, {
            tabIdFromMessage: message.tabId,
            tabIdFromSender: sender && sender.tab && sender.tab.id,
            finalTabId: this.tabId,
            currentUrl: window.location.href,
            currentTitle: document.title,
          });
        }

        this.startTranslation(message.settings)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
      } else if (message.action === 'PING') {
        // Firefox state check: respond to indicate content script is available
        sendResponse({ success: true, status: 'content_script_available' });
        return false; // Synchronous response
      }
    });
  }

  async performSelfCleanup() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_CURRENT_TAB_ID' });

      if (response?.success && response.tabId) {
        const currentTabId = response.tabId;
        if (this.debug) {
          console.log(
            `[ContentScript] Self-cleanup: clearing any stale state for tab ${currentTabId}`
          );
        }
        await chrome.runtime.sendMessage({
          action: 'CLEAR_TRANSLATION_STATE',
          tabId: currentTabId,
        });
      } else {
        console.warn('[ContentScript] Self-cleanup: Could not determine tab ID');
      }
    } catch (error) {
      console.warn('[ContentScript] Self-cleanup failed (non-critical):', error);
    }
  }

  async startTranslation(settings) {
    if (this.isTranslating) {
      throw new Error('Translation already in progress');
    }

    // Validate settings
    if (!settings.apiKey || typeof settings.apiKey !== 'string' || !settings.apiKey.trim()) {
      throw new Error('API key is required');
    }
    if (!settings.model || typeof settings.model !== 'string' || !settings.model.trim()) {
      throw new Error('Model is required');
    }
    if (
      !settings.targetLanguage ||
      typeof settings.targetLanguage !== 'string' ||
      !settings.targetLanguage.trim()
    ) {
      throw new Error('Target language is required');
    }

    this.isTranslating = true;
    this.translationSettings = settings;
    this.translationHistory = [];
    this.completedBlocks = 0;

    // Clear any existing progress indicators from previous translations
    this.clearPreviousTranslationState();

    this.updateTranslationState({
      isTranslating: true,
      status: 'starting',
      progress: 0,
      totalBlocks: 0,
      completedBlocks: 0,
    });

    try {
      // Identify article content via Readability (or null for fallback)
      const articleData = TextExtraction.identifyArticleContent();

      // Extract translatable text elements, filtered by article content
      const textElements = TextExtraction.extractTextElements(document.body, articleData);

      if (textElements.length === 0) {
        throw new Error('No translatable content found on this page');
      }

      if (this.debug) {
        console.log(`Starting translation: ${textElements.length} text elements found`);
        console.log('Settings:', {
          model: settings.model,
          targetLanguage: settings.targetLanguage,
          endpoint: settings.apiEndpoint,
        });
      }

      await this.translateWithAnimations(textElements);

      this.updateTranslationState({
        isTranslating: false,
        status: 'completed',
        progress: 100,
        totalBlocks: this.totalBlocks,
        completedBlocks: this.completedBlocks,
      });

      if (this.translationSettings.playSound) {
        Animation.playCompletionSound();
      }

      setTimeout(
        () => {
          this.clearTranslationState();
        },
        Animation.getAdjustedTiming(3000, this.translationSettings)
      );
    } catch (error) {
      this.updateTranslationState({
        isTranslating: false,
        status: 'error',
        progress: 0,
        totalBlocks: this.totalBlocks,
        completedBlocks: this.completedBlocks,
        error: error.message,
      });

      setTimeout(
        () => {
          this.clearTranslationState();
        },
        Animation.getAdjustedTiming(5000, this.translationSettings)
      );

      throw error;
    } finally {
      this.isTranslating = false;
    }
  }

  // ─── Translation Pipeline ──────────────────────────────────────────────────

  async translateWithAnimations(textElements) {
    const textBlocks = TextExtraction.groupIntoBlocks(textElements);
    this.totalBlocks = textBlocks.length;
    this.completedBlocks = 0;

    this.updateTranslationState({
      isTranslating: true,
      status: 'translating',
      progress: 0,
      totalBlocks: this.totalBlocks,
      completedBlocks: 0,
    });

    Animation.injectSpeedAdjustedCSS(this.translationSettings);

    if (this.translationSettings.showProgress !== false) {
      Animation.showTranslationProgress();
    }

    // Start scanning animation on all blocks
    textBlocks.forEach(block => {
      try {
        Animation.animateBlockStart(block);
      } catch (error) {
        console.warn('Error starting animation for block:', error);
      }
    });

    // Build the full translation payload — all blocks in one request
    const translationData = {
      targetLanguage: this.getLanguageName(this.translationSettings.targetLanguage),
      blocks: textBlocks.map((block, blockIndex) => ({
        id: blockIndex,
        items: block.map(item => item.textNodes.map(node => node.textContent)),
      })),
    };

    console.log(
      `[LLM] Streaming translation: ${textBlocks.length} blocks, ` +
        `${translationData.blocks.reduce((s, b) => s + b.items.length, 0)} items`
    );

    // Open a long-lived port to background for streaming
    const port = chrome.runtime.connect({ name: 'streaming-translate' });
    let completedCount = 0;

    await new Promise((resolve, reject) => {
      // Queue blocks and render with minimum spacing so translations
      // appear progressively even when the model bursts output all at once
      // (common with reasoning models that think first, then dump the answer).
      const MIN_RENDER_INTERVAL_MS = 120;
      const blockQueue = [];
      let rendering = false;
      let streamDone = false;
      let streamError = null;

      const processQueue = async () => {
        if (rendering) return;
        rendering = true;

        while (blockQueue.length > 0) {
          const renderStart = Date.now();
          const { blockIndex, translatedBlock } = blockQueue.shift();
          const originalBlock = textBlocks[blockIndex];

          if (!originalBlock) {
            console.warn(`[LLM] Received block ${blockIndex} but no matching original`);
            continue;
          }

          try {
            let translatedItems = translatedBlock.items || [];

            // Pad or trim items to match block size
            if (translatedItems.length < originalBlock.length) {
              while (translatedItems.length < originalBlock.length) {
                const fallbackItem = originalBlock[translatedItems.length];
                translatedItems.push(fallbackItem.textNodes.map(n => n.textContent));
              }
            } else if (translatedItems.length > originalBlock.length) {
              translatedItems = translatedItems.slice(0, originalBlock.length);
            }

            // Coerce each item to an array of strings
            translatedItems = translatedItems.map(segments => {
              if (!Array.isArray(segments)) return [String(segments ?? '')];
              return segments.map(s => String(s ?? ''));
            });

            // Animate each item in the block
            for (let k = 0; k < originalBlock.length; k++) {
              const item = originalBlock[k];
              const segments = translatedItems[k] || item.textNodes.map(n => n.textContent);

              try {
                const htmlPair = await Animation.animateLineTransition(
                  item,
                  segments,
                  this.translationSettings,
                  this.debug
                );
                this.translatedElements.set(item.element, htmlPair);
              } catch (animationError) {
                console.warn('Error animating item:', animationError);
              }
            }
          } catch (error) {
            console.warn(`[LLM] Error processing block ${blockIndex}:`, error);
            Animation.animateBlockError(originalBlock);
          }

          completedCount++;
          this.completedBlocks = completedCount;

          if (this.translationSettings.showProgress !== false) {
            Animation.updateTranslationProgress(
              completedCount,
              textBlocks.length,
              this.translationSettings
            );
          }
          this.updateTranslationState({
            isTranslating: true,
            status: 'translating',
            progress: Math.round((completedCount / textBlocks.length) * 100),
            totalBlocks: textBlocks.length,
            completedBlocks: completedCount,
          });

          console.log(
            `[LLM] Block ${blockIndex} rendered (${completedCount}/${textBlocks.length})`
          );

          // Enforce minimum spacing between block renders so the user
          // sees a progressive reveal instead of an instant dump
          if (blockQueue.length > 0) {
            const elapsed = Date.now() - renderStart;
            const remaining = MIN_RENDER_INTERVAL_MS - elapsed;
            if (remaining > 0) {
              await new Promise(r => setTimeout(r, remaining));
            }
          }
        }

        rendering = false;

        // If the stream already finished while we were rendering, resolve now
        if (streamDone) {
          console.log(`[LLM] Stream complete: ${completedCount}/${textBlocks.length} blocks`);
          if (streamError) {
            reject(streamError);
          } else {
            resolve();
          }
        }
      };

      port.onMessage.addListener(message => {
        if (message.type === 'reasoning') {
          if (this.translationSettings.showProgress !== false) {
            const seconds = (message.elapsed / 1000).toFixed(1);
            const kChars = (message.chars / 1000).toFixed(0);
            Animation.updateReasoningProgress(seconds, kChars, message.snippet);
          }
        } else if (message.type === 'block') {
          blockQueue.push({ blockIndex: message.index, translatedBlock: message.block });
          processQueue();
        } else if (message.type === 'done') {
          port.disconnect();
          streamDone = true;
          // If queue is empty and not rendering, resolve immediately
          if (blockQueue.length === 0 && !rendering) {
            console.log(`[LLM] Stream complete: ${completedCount}/${textBlocks.length} blocks`);
            resolve();
          }
          // Otherwise processQueue will resolve when it drains
        } else if (message.type === 'error') {
          console.error('[LLM] Stream error:', message.error);
          port.disconnect();

          const error = new Error(message.error);
          error.isRetryable = message.isRetryable;
          if (!message.isRetryable) {
            error.isFatalError = true;
          }

          streamDone = true;
          streamError = error;
          if (blockQueue.length === 0 && !rendering) {
            reject(error);
          }
        }
      });

      port.onDisconnect.addListener(() => {
        if (completedCount < textBlocks.length && !streamDone) {
          const disconnectError = chrome.runtime.lastError;
          console.warn('[LLM] Port disconnected:', disconnectError?.message || 'unknown');
          streamDone = true;
          if (blockQueue.length === 0 && !rendering) {
            resolve();
          }
        }
      });

      // Fire the stream
      port.postMessage({
        action: 'START_STREAM',
        translationData,
        settings: this.translationSettings,
      });
    });

    if (this.translationSettings.showProgress !== false) {
      Animation.hideTranslationProgress(this.translationSettings);
    }
    Animation.addGlobalToggleButton(this.translatedElements, this.translationSettings);
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

  // ─── State Management ──────────────────────────────────────────────────────

  updateTranslationState(state) {
    if (!this.tabId) {
      console.warn('No tab ID available for state update');
      return;
    }

    if (this.debug) {
      console.log('Updating translation state for tab', this.tabId, ':', state);
    }

    chrome.runtime
      .sendMessage({
        action: 'UPDATE_TRANSLATION_STATE',
        tabId: this.tabId,
        state,
      })
      .then(response => {
        if (this.debug) console.log('Translation state update response:', response);
      })
      .catch(error => {
        console.error('Failed to update translation state:', error);
      });
  }

  async getTranslationState() {
    if (!this.tabId) {
      console.warn('No tab ID available for getting state');
      return null;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'GET_TRANSLATION_STATE',
        tabId: this.tabId,
      });
      return response?.state || null;
    } catch (error) {
      console.warn('Failed to get translation state:', error);
      return null;
    }
  }

  async clearTranslationState() {
    if (!this.tabId) {
      console.warn('No tab ID available for clearing state');
      return;
    }
    try {
      await chrome.runtime.sendMessage({
        action: 'CLEAR_TRANSLATION_STATE',
        tabId: this.tabId,
      });
    } catch (error) {
      console.warn('Failed to clear translation state:', error);
    }
  }

  clearPreviousTranslationState() {
    const existingProgress = document.getElementById('llm-progress-bar');
    if (existingProgress) existingProgress.remove();

    const existingToggle = document.getElementById('llm-global-toggle');
    if (existingToggle) existingToggle.remove();

    this.translatedElements.clear();

    document
      .querySelectorAll(
        '.llm-preparing, .llm-fading-out, .llm-translated, .llm-settled, .llm-error'
      )
      .forEach(element => {
        element.classList.remove(
          'llm-preparing',
          'llm-fading-out',
          'llm-translated',
          'llm-settled',
          'llm-error'
        );
      });
  }
}

// Initialize the Line Localization Machine
new LineLocalizationMachine();
