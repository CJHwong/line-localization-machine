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

        const skipCache = message.skipCache || false;
        this.startTranslation(message.settings, skipCache)
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

  async startTranslation(settings, skipCache = false) {
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

    // If re-translating an already translated page, restore original DOM text
    // before extraction, otherwise we extract translated text and re-translate it.
    // Must happen BEFORE clearPreviousTranslationState which clears translatedElements.
    if (this.translatedElements.size > 0) {
      for (const [element, data] of this.translatedElements) {
        element.innerHTML = data.originalHTML;
      }
    }

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

      await this.translateWithAnimations(textElements, skipCache);

      this.updateTranslationState({
        isTranslating: false,
        status: 'completed',
        progress: 100,
        totalBlocks: this.totalBlocks,
        completedBlocks: this.completedBlocks,
      });

      setTimeout(() => {
        this.clearTranslationState();
      }, 3000);
    } catch (error) {
      Animation.hideTranslationProgress();

      this.updateTranslationState({
        isTranslating: false,
        status: 'error',
        progress: 0,
        totalBlocks: this.totalBlocks,
        completedBlocks: this.completedBlocks,
        error: error.message,
      });

      setTimeout(() => {
        this.clearTranslationState();
      }, 5000);

      throw error;
    } finally {
      this.isTranslating = false;
    }
  }

  // ─── Translation Pipeline ──────────────────────────────────────────────────

  async translateWithAnimations(textElements, skipCache = false) {
    const textBlocks = TextExtraction.groupIntoBlocks(textElements);
    this.totalBlocks = textBlocks.length;
    this.completedBlocks = 0;

    // Show progress immediately — cache lookup may block on IndexedDB
    this.updateTranslationState({
      isTranslating: true,
      status: 'translating',
      progress: 0,
      totalBlocks: this.totalBlocks,
      completedBlocks: 0,
    });
    Animation.showTranslationProgress();
    textBlocks.forEach(block => {
      try {
        Animation.animateBlockStart(block);
      } catch (error) {
        console.warn('Error starting animation for block:', error);
      }
    });

    // Check IndexedDB cache (unless user asked to skip)
    const targetLanguage = this.translationSettings.targetLanguage;
    const cacheKey = this.computeCacheKey(textBlocks, targetLanguage);

    if (!skipCache) {
      try {
        const cached = await TranslationCache.get(cacheKey);
        if (cached && cached.blocks && cached.blocks.length > 0) {
          console.log(`[LLM] Cache hit: ${cached.blocks.length} blocks for "${targetLanguage}"`);
          await this.renderCachedBlocks(cached, textBlocks);
          return;
        }
      } catch (err) {
        console.warn('[LLM] Cache read failed, falling back to API:', err.message);
      }
    }

    if (skipCache) {
      console.log('[LLM] Cache skipped — forcing fresh translation');
    }

    // Track completed blocks across retries by original index
    const completedBlockIndices = new Set();
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Build payload for remaining blocks only
      const remainingEntries = textBlocks
        .map((block, idx) => ({ block, idx }))
        .filter(({ idx }) => !completedBlockIndices.has(idx));

      if (remainingEntries.length === 0) break;

      if (attempt > 0) {
        console.log(
          `[LLM] Resuming translation (attempt ${attempt + 1}): ` +
            `${remainingEntries.length} blocks remaining`
        );
      }

      const translationData = {
        targetLanguage: this.getLanguageName(this.translationSettings.targetLanguage),
        blocks: remainingEntries.map(({ block, idx }) => ({
          id: idx,
          items: block.map(item => item.textNodes.map(node => node.textContent)),
        })),
      };

      console.log(
        `[LLM] Streaming translation: ${remainingEntries.length} blocks, ` +
          `${translationData.blocks.reduce((s, b) => s + b.items.length, 0)} items`
      );

      const result = await this.streamTranslationBlocks(
        textBlocks,
        translationData,
        completedBlockIndices,
        [],
        cacheKey
      );

      if (result.fatal) throw result.error;
      if (completedBlockIndices.size >= textBlocks.length) break;

      // All remaining blocks' elements are detached — no point retrying
      if (result.allDetached) break;
    }

    // Stop the breathing animation on any blocks that were never translated
    for (let i = 0; i < textBlocks.length; i++) {
      if (completedBlockIndices.has(i)) continue;
      for (const item of textBlocks[i]) {
        item.element.classList.remove('llm-preparing');
      }
    }

    if (completedBlockIndices.size < textBlocks.length) {
      console.warn(
        `[LLM] Translation incomplete after retries: ` +
          `${completedBlockIndices.size}/${textBlocks.length} blocks`
      );
    }

    Animation.hideTranslationProgress();
    Animation.addGlobalToggleButton(this.translatedElements, () => {
      return this.startTranslation(this.translationSettings, true);
    });
  }

  /**
   * Opens a streaming port and renders translated blocks as they arrive.
   * Resolves with { fatal, error, allDetached } — never rejects.
   * The caller retries when the stream is interrupted.
   */
  streamTranslationBlocks(
    textBlocks,
    translationData,
    completedBlockIndices,
    receivedBlocks,
    cacheKey
  ) {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'streaming-translate' });
    } catch (error) {
      // Extension context invalidated (reload, update, disable)
      console.warn('[LLM] Cannot connect to background:', error.message);
      return Promise.resolve({ fatal: true, error });
    }

    return new Promise(resolve => {
      const MIN_RENDER_INTERVAL_MS = 120;
      const blockQueue = [];
      let rendering = false;
      let streamDone = false;
      let fatalError = null;

      const finalize = () => {
        const allDone = completedBlockIndices.size >= textBlocks.length;
        if (fatalError) {
          resolve({ fatal: true, error: fatalError });
        } else {
          resolve({ fatal: false, allDetached: false });
        }
        if (allDone) {
          console.log(
            `[LLM] Stream complete: ${completedBlockIndices.size}/${textBlocks.length} blocks`
          );
          // Fire-and-forget: cache the translation for future page loads
          if (cacheKey && receivedBlocks.length > 0) {
            const blocksForCache = receivedBlocks.filter(b => b != null);
            TranslationCache.put(
              cacheKey,
              this.translationSettings.targetLanguage,
              blocksForCache,
              textBlocks.length
            ).catch(err => console.warn('[LLM] Cache write failed:', err.message));
          }
        }
      };

      const processQueue = async () => {
        if (rendering) return;
        rendering = true;

        while (blockQueue.length > 0) {
          const renderStart = Date.now();
          const { blockId, translatedBlock } = blockQueue.shift();
          const originalBlock = textBlocks[blockId];

          if (!originalBlock) {
            console.warn(`[LLM] Received block id ${blockId} but no matching original`);
            continue;
          }

          try {
            await this.renderBlockItems(originalBlock, translatedBlock.items || []);
          } catch (error) {
            console.warn(`[LLM] Error processing block ${blockId}:`, error);
            Animation.animateBlockError(originalBlock);
          }

          completedBlockIndices.add(blockId);
          this.completedBlocks = completedBlockIndices.size;
          receivedBlocks[blockId] = translatedBlock;

          Animation.updateTranslationProgress(completedBlockIndices.size, textBlocks.length);
          this.updateTranslationState({
            isTranslating: true,
            status: 'translating',
            progress: Math.round((completedBlockIndices.size / textBlocks.length) * 100),
            totalBlocks: textBlocks.length,
            completedBlocks: completedBlockIndices.size,
          });

          console.log(
            `[LLM] Block ${blockId} rendered (${completedBlockIndices.size}/${textBlocks.length})`
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

        if (streamDone) finalize();
      };

      port.onMessage.addListener(message => {
        if (message.type === 'reasoning') {
          const seconds = (message.elapsed / 1000).toFixed(1);
          const kChars = (message.chars / 1000).toFixed(0);
          Animation.updateReasoningProgress(seconds, kChars, message.snippet);
        } else if (message.type === 'block') {
          // Use block.id to map back to original textBlocks index
          const blockId = message.block?.id ?? message.index;
          blockQueue.push({ blockId, translatedBlock: message.block });
          processQueue();
        } else if (message.type === 'done') {
          port.disconnect();
          streamDone = true;
          if (blockQueue.length === 0 && !rendering) finalize();
        } else if (message.type === 'error') {
          console.error('[LLM] Stream error:', message.error);
          port.disconnect();

          const error = new Error(message.error);
          error.isRetryable = message.isRetryable;

          streamDone = true;
          if (!message.isRetryable) {
            error.isFatalError = true;
            fatalError = error;
          }
          if (blockQueue.length === 0 && !rendering) finalize();
        }
      });

      port.onDisconnect.addListener(() => {
        if (!streamDone) {
          const disconnectError = chrome.runtime.lastError;
          console.warn('[LLM] Port disconnected:', disconnectError?.message || 'unknown');
          streamDone = true;
          if (blockQueue.length === 0 && !rendering) finalize();
        }
      });

      // Fire the stream
      port.postMessage({
        action: 'START_STREAM',
        translationData,
        settings: this.translationSettings,
      });
    });
  }

  // ─── Cache helpers ────────────────────────────────────────────────────────

  DJB2_INIT = 5381;
  DJB2_MULT = 33;

  computeHash(textBlocks) {
    const content = JSON.stringify(
      textBlocks.map((block, idx) => ({
        id: idx,
        items: block.map(item => item.textNodes.map(n => n.textContent)),
      }))
    );
    let hash = this.DJB2_INIT;
    for (let i = 0; i < content.length; i++) {
      hash = (hash * this.DJB2_MULT) ^ content.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  computeCacheKey(textBlocks, targetLanguage) {
    return `${this.computeHash(textBlocks)}_${targetLanguage}`;
  }

  async renderBlockItems(originalBlock, translatedItems) {
    if (translatedItems.length < originalBlock.length) {
      while (translatedItems.length < originalBlock.length) {
        const fallbackItem = originalBlock[translatedItems.length];
        translatedItems.push(fallbackItem.textNodes.map(n => n.textContent));
      }
    } else if (translatedItems.length > originalBlock.length) {
      translatedItems = translatedItems.slice(0, originalBlock.length);
    }

    translatedItems = translatedItems.map(segments => {
      if (!Array.isArray(segments)) return [String(segments ?? '')];
      return segments.map(s => String(s ?? ''));
    });

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
        if (htmlPair) {
          this.translatedElements.set(item.element, htmlPair);
        }
      } catch (animationError) {
        console.warn('Error animating item:', animationError);
      }
    }
  }

  async renderCachedBlocks(cachedData, textBlocks) {
    this.totalBlocks = textBlocks.length;
    this.completedBlocks = 0;

    const MIN_RENDER_INTERVAL_MS = 80; // faster for cached — no network latency

    for (const block of cachedData.blocks) {
      const blockId = block.id;
      const originalBlock = textBlocks[blockId];

      if (!originalBlock) {
        console.warn(`[LLM] Cached block id ${blockId} has no matching original`);
        continue;
      }

      const renderStart = Date.now();

      try {
        await this.renderBlockItems(originalBlock, block.items || []);
      } catch (error) {
        console.warn(`[LLM] Error rendering cached block ${blockId}:`, error);
        Animation.animateBlockError(originalBlock);
      }

      this.completedBlocks++;
      Animation.updateTranslationProgress(this.completedBlocks, textBlocks.length);
      this.updateTranslationState({
        isTranslating: true,
        status: 'translating',
        progress: Math.round((this.completedBlocks / textBlocks.length) * 100),
        totalBlocks: textBlocks.length,
        completedBlocks: this.completedBlocks,
      });

      const elapsed = Date.now() - renderStart;
      const remaining = MIN_RENDER_INTERVAL_MS - elapsed;
      if (remaining > 0) {
        await new Promise(r => setTimeout(r, remaining));
      }
    }

    Animation.hideTranslationProgress();
    Animation.addGlobalToggleButton(this.translatedElements, () => {
      return this.startTranslation(this.translationSettings, true);
    });

    this.updateTranslationState({
      isTranslating: false,
      status: 'completed',
      progress: 100,
      totalBlocks: this.totalBlocks,
      completedBlocks: this.completedBlocks,
    });

    setTimeout(() => {
      this.clearTranslationState();
    }, 3000);

    console.log(`[LLM] Cache replay complete: ${this.completedBlocks}/${textBlocks.length} blocks`);
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
