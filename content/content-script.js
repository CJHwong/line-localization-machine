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

    const blocksPerRequest = this.translationSettings.blocksPerRequest || 15;
    let completedCount = 0;

    // Create batches
    const batches = [];
    for (let i = 0; i < textBlocks.length; i += blocksPerRequest) {
      batches.push(textBlocks.slice(i, i + blocksPerRequest));
    }

    // Pipeline processing: fire next batch request while animating current batch
    let nextBatchPromise = null;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const nextBatch = batches[batchIndex + 1];

      console.log(
        `[LLM] Starting batch ${batchIndex}/${batches.length - 1}, ${batch.length} blocks`
      );

      batch.forEach(block => {
        try {
          Animation.animateBlockStart(block);
        } catch (error) {
          console.warn('Error starting animation for block:', error);
        }
      });

      // Get translation for current batch
      let translationResult;
      try {
        if (batchIndex === 0 || !nextBatchPromise) {
          console.log(`[LLM] Batch ${batchIndex}: Starting fresh translation request`);
          const result = await this.translateMultipleBlocks(batch);
          translationResult = { success: true, result };
        } else {
          console.log(`[LLM] Batch ${batchIndex}: Awaiting pending translation request`);
          const result = await nextBatchPromise;
          translationResult = { success: true, result };
        }
        console.log(
          `[LLM] Batch ${batchIndex}: Got ${translationResult.result?.length || 0} translated blocks`
        );
      } catch (error) {
        console.error(`[LLM] Batch ${batchIndex}: Translation error:`, error);
        if (error.isFatalError) throw error;
        translationResult = { success: false, error };
      }

      // Pipeline: start next batch request NOW (runs in parallel with animation below)
      if (nextBatch) {
        console.log(
          `[LLM] Batch ${batchIndex}: Starting pipeline request for batch ${batchIndex + 1}`
        );
        nextBatchPromise = this.translateMultipleBlocks(nextBatch);
      } else {
        nextBatchPromise = null;
      }

      try {
        if (translationResult.success) {
          const batchTranslations = translationResult.result;

          for (let j = 0; j < batch.length; j++) {
            const block = batch[j];
            const blockTranslations = batchTranslations[j] || block.map(item => item.originalText);

            try {
              // animateTranslation stores { originalHTML, translatedHTML } per element
              for (let k = 0; k < block.length; k++) {
                const item = block[k];
                const segments = blockTranslations[k] || item.textNodes.map(n => n.textContent);

                const htmlPair = await Animation.animateLineTransition(
                  item,
                  segments,
                  this.translationSettings,
                  this.debug
                );
                this.translatedElements.set(item.element, htmlPair);
              }
            } catch (animationError) {
              console.warn('Error animating block translation:', animationError);
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
          }
        } else {
          console.warn('Batch translation failed:', translationResult.error);

          if (translationResult.error && translationResult.error.isFatalError) {
            console.error('Fatal error, stopping translation:', translationResult.error);
            this.updateTranslationState({
              isTranslating: false,
              status: 'error',
              error: translationResult.error.message,
              errorType: translationResult.error.errorType,
              progress: Math.round((completedCount / textBlocks.length) * 100),
              totalBlocks: textBlocks.length,
              completedBlocks: completedCount,
            });
            this.isTranslating = false;
            if (this.translationSettings.showProgress !== false) {
              Animation.hideTranslationProgress(this.translationSettings);
            }
            throw translationResult.error;
          }

          // Non-fatal: show error animation and continue
          this.handleBatchError(batch, completedCount, textBlocks.length);
          completedCount += batch.length;
          this.completedBlocks = completedCount;
        }
      } catch (error) {
        if (error.isFatalError) throw error;
        console.warn('Unexpected batch error:', error);
        this.handleBatchError(batch, completedCount, textBlocks.length);
        completedCount += batch.length;
        this.completedBlocks = completedCount;
      }
    }

    if (this.translationSettings.showProgress !== false) {
      Animation.hideTranslationProgress(this.translationSettings);
    }
    Animation.addGlobalToggleButton(this.translatedElements, this.translationSettings);
  }

  handleBatchError(batch, completedCount, totalBlocks) {
    batch.forEach(block => {
      Animation.animateBlockError(block);
      completedCount++;
      this.completedBlocks = completedCount;
      Animation.updateTranslationProgress(completedCount, totalBlocks, this.translationSettings);
      this.updateTranslationState({
        isTranslating: true,
        status: 'translating',
        progress: Math.round((completedCount / totalBlocks) * 100),
        totalBlocks,
        completedBlocks: completedCount,
      });
    });
  }

  // ─── API Communication ─────────────────────────────────────────────────────

  async translateMultipleBlocks(blocks) {
    const translationData = {
      targetLanguage: this.getLanguageName(this.translationSettings.targetLanguage),
      blocks: blocks.map((block, blockIndex) => ({
        id: blockIndex,
        items: block.map(item => item.textNodes.map(node => node.textContent)),
      })),
    };

    if (this.debug) {
      console.log('Translation request:', {
        blockCount: blocks.length,
        totalItems: translationData.blocks.reduce((sum, b) => sum + b.items.length, 0),
      });
    }

    try {
      const result = await this.callTranslationAPI(translationData);

      if (!result.success || !result.blocks) {
        throw new Error(result.error || 'Translation failed - no blocks returned');
      }

      const results = [];
      for (let i = 0; i < blocks.length; i++) {
        const originalBlock = blocks[i];
        const translatedBlock = result.blocks.find(b => b.id === i) || result.blocks[i];

        if (!translatedBlock || !translatedBlock.items) {
          console.warn(`Missing translation for block ${i}, using original`);
          results.push(originalBlock.map(item => item.textNodes.map(n => n.textContent)));
          continue;
        }

        let translatedItems = translatedBlock.items;

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

        results.push(translatedItems);
      }

      return results;
    } catch (error) {
      if (error.isFatalError) throw error;
      console.error('Batch translation error:', error);
      return blocks.map(block => block.map(item => item.textNodes.map(n => n.textContent)));
    }
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

  async callTranslationAPI(translationData) {
    if (!translationData || !translationData.blocks || translationData.blocks.length === 0) {
      return { success: false, error: 'No translation data provided' };
    }

    try {
      if (this.debug) {
        console.log('Translation request via background script:', {
          model: this.translationSettings.model,
          targetLanguage: translationData.targetLanguage,
          blockCount: translationData.blocks.length,
          totalItems: translationData.blocks.reduce((sum, b) => sum + b.items.length, 0),
        });
      }

      const result = await chrome.runtime.sendMessage({
        action: 'TRANSLATE_REQUEST',
        translationData,
        settings: this.translationSettings,
      });

      if (!result || !result.success) {
        let errorMessage = 'Translation failed';
        if (result && result.error) {
          errorMessage = typeof result.error === 'string' ? result.error : result.error.toString();
        }
        const error = new Error(errorMessage);
        if (result && result.errorType) error.errorType = result.errorType;
        if (result && result.errorStatus) error.status = result.errorStatus;
        if (
          result &&
          (result.isRetryable === false || (result.errorStatus >= 400 && result.errorStatus < 500))
        ) {
          error.isFatalError = true;
        }
        throw error;
      }

      return {
        success: true,
        blocks: result.blocks,
        usage: result.usage,
        model: result.model,
      };
    } catch (error) {
      console.error('Translation API call failed:', error);
      if (error.isFatalError || error.errorType) throw error;
      throw new Error(`Translation failed: ${error.message}`);
    }
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
