// Content scripts now use chrome.runtime directly (standardized across browsers)

// Content scripts use background script for API calls (dynamic imports don't work reliably in content scripts)

class LineLocalizationMachine {
  constructor() {
    this.isTranslating = false;
    this.originalContent = new Map();
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

        // Enhanced debugging for tab ID tracking
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
      // Get current tab ID for cleanup
      const response = await chrome.runtime.sendMessage({
        action: 'GET_CURRENT_TAB_ID',
      });

      if (response?.success && response.tabId) {
        const currentTabId = response.tabId;

        if (this.debug) {
          console.log(
            `[ContentScript] Self-cleanup: clearing any stale state for tab ${currentTabId}`
          );
        }

        // Clear any existing translation state for this tab
        await chrome.runtime.sendMessage({
          action: 'CLEAR_TRANSLATION_STATE',
          tabId: currentTabId,
        });

        if (this.debug) {
          console.log(`[ContentScript] Self-cleanup completed for tab ${currentTabId}`);
        }
      } else {
        console.warn('[ContentScript] Self-cleanup: Could not determine tab ID');
      }
    } catch (error) {
      // Silent fail - don't break content script loading if cleanup fails
      console.warn('[ContentScript] Self-cleanup failed (non-critical):', error);
    }
  }

  async startTranslation(settings) {
    if (this.isTranslating) {
      throw new Error('Translation already in progress');
    }

    // Validate settings with safe string checking
    if (
      !settings.apiKey ||
      typeof settings.apiKey !== 'string' ||
      settings.apiKey.trim().length === 0
    ) {
      throw new Error('API key is required');
    }

    if (
      !settings.model ||
      typeof settings.model !== 'string' ||
      settings.model.trim().length === 0
    ) {
      throw new Error('Model is required');
    }

    if (
      !settings.targetLanguage ||
      typeof settings.targetLanguage !== 'string' ||
      settings.targetLanguage.trim().length === 0
    ) {
      throw new Error('Target language is required');
    }

    this.isTranslating = true;
    this.translationSettings = settings;
    this.translationHistory = []; // Reset history for new translation session
    this.completedBlocks = 0;

    // Clear any existing progress indicators or error states from previous translations
    this.clearPreviousTranslationState();

    // Notify background script that translation started
    this.updateTranslationState({
      isTranslating: true,
      status: 'starting',
      progress: 0,
      totalBlocks: 0,
      completedBlocks: 0,
    });

    try {
      // Find main content area
      const contentArea = this.findMainContent();

      // Extract text lines
      const textElements = this.extractTextElements(contentArea);

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

      // Start translation process with animations
      await this.translateWithAnimations(textElements);

      // Notify completion
      this.updateTranslationState({
        isTranslating: false,
        status: 'completed',
        progress: 100,
        totalBlocks: this.totalBlocks,
        completedBlocks: this.completedBlocks,
      });

      // Play completion sound if enabled
      if (this.translationSettings.playSound) {
        this.playCompletionSound();
      }

      // Clear state after a short delay
      setTimeout(() => {
        this.clearTranslationState();
      }, this.getAdjustedTiming(3000));
    } catch (error) {
      // Notify error
      this.updateTranslationState({
        isTranslating: false,
        status: 'error',
        progress: 0,
        totalBlocks: this.totalBlocks,
        completedBlocks: this.completedBlocks,
        error: error.message,
      });

      // Clear error state after a delay
      setTimeout(() => {
        this.clearTranslationState();
      }, this.getAdjustedTiming(5000));

      throw error;
    } finally {
      this.isTranslating = false;
    }
  }

  findMainContent() {
    // Priority order for finding main content
    const selectors = [
      'main',
      '[role="main"]',
      'article',
      '.content',
      '#content',
      '.main-content',
      '.post-content',
      '.entry-content',
      '.container',
      '.wrapper',
      'body',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && this.hasSignificantText(element)) {
        return element;
      }
    }

    return document.body;
  }

  hasSignificantText(element) {
    const text = element.textContent.trim();
    return text.length > 50 && text.split(' ').length > 10;
  }

  extractTextElements(container) {
    const textElements = [];
    const processedElements = new Set();

    try {
      // Safety check
      if (!container || !container.nodeType) {
        console.warn('Invalid container provided to extractTextElements');
        return textElements;
      }

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          try {
            const text = node.textContent.trim();
            const parent = node.parentElement;

            // Safety checks
            if (!parent || !parent.tagName) {
              return NodeFilter.FILTER_REJECT;
            }

            // Skip empty text, scripts, styles, and hidden elements
            if (
              !text ||
              text.length < 5 || // Reduced minimum length to catch more content
              ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'CODE', 'PRE'].includes(
                parent.tagName
              ) ||
              parent.getAttribute('aria-hidden') === 'true' ||
              parent.classList.contains('llm-no-translate')
            ) {
              return NodeFilter.FILTER_REJECT;
            }

            // Safe style check
            try {
              const style = getComputedStyle(parent);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return NodeFilter.FILTER_REJECT;
              }
            } catch (styleError) {
              // If we can't get computed style, continue anyway
              console.warn('Could not get computed style for element:', styleError);
            }

            return NodeFilter.FILTER_ACCEPT;
          } catch (error) {
            console.warn('Error in acceptNode function:', error);
            return NodeFilter.FILTER_REJECT;
          }
        },
      });

      let node;
      let count = 0;
      const maxNodes = 1000; // Prevent infinite loops

      while ((node = walker.nextNode()) && count < maxNodes) {
        try {
          const text = node.textContent.trim();
          const parent = node.parentElement;

          // Safety checks
          if (!parent || !text) {
            count++;
            continue;
          }

          // Skip if we've already processed this element
          if (processedElements.has(parent)) {
            count++;
            continue;
          }

          if (text.length >= 5) {
            // Collect all text nodes within the same parent element
            const allTextNodes = this.getAllTextNodesInElement(parent);
            const fullText = allTextNodes
              .map(n => n.textContent || '')
              .join('')
              .trim();

            if (fullText.length >= 10) {
              // Check if element has links and store both text and HTML
              const hasLinks = parent.querySelector('a[href]');

              textElements.push({
                node: node, // Primary text node for reference
                allTextNodes: allTextNodes, // All text nodes in the element
                originalText: fullText,
                originalHTML: hasLinks ? parent.innerHTML : null, // Store HTML if there are links
                originalInnerHTML: parent.innerHTML, // Always store original innerHTML for restoration
                hasLinks: hasLinks,
                element: parent,
              });

              processedElements.add(parent);
            }
          }
        } catch (error) {
          console.warn('Error processing text node:', error);
        }

        count++;
      }

      if (count >= maxNodes) {
        console.warn('Hit maximum node limit in extractTextElements, stopping');
      }
    } catch (error) {
      console.error('Error in extractTextElements:', error);
    }

    return textElements;
  }

  async translateWithAnimations(textElements) {
    // Group elements by proximity and semantic blocks
    const textBlocks = this.groupIntoBlocks(textElements);
    this.totalBlocks = textBlocks.length;
    this.completedBlocks = 0;

    // Update state with total blocks
    this.updateTranslationState({
      isTranslating: true,
      status: 'translating',
      progress: 0,
      totalBlocks: this.totalBlocks,
      completedBlocks: 0,
    });

    // Apply animation speed settings
    this.injectSpeedAdjustedCSS();

    // Add visual indicator that translation is starting (if enabled)
    if (this.translationSettings.showProgress !== false) {
      this.showTranslationProgress();
    }

    // Process blocks in batches based on user setting (blocks per API request)
    const blocksPerRequest = this.translationSettings.blocksPerRequest || 5;
    let completedCount = 0;

    // Create batches
    const batches = [];
    for (let i = 0; i < textBlocks.length; i += blocksPerRequest) {
      batches.push(textBlocks.slice(i, i + blocksPerRequest));
    }

    // Pipeline: start first translation request
    const translationQueue = [];
    let nextBatchIndex = 0;

    // Helper function to start next translation
    const startNextTranslation = () => {
      if (nextBatchIndex < batches.length) {
        const batch = batches[nextBatchIndex];
        nextBatchIndex++;

        // Start translation in background
        const translationPromise = this.translateMultipleBlocks(batch)
          .then(result => ({ success: true, batch, result }))
          .catch(error => {
            // If this is a fatal error, don't catch it - let it bubble up immediately
            if (error.isFatalError) {
              console.error('Fatal error in translation promise, re-throwing:', error);
              throw error; // This will cause the promise to reject with the fatal error
            }
            return { success: false, batch, error };
          });

        translationQueue.push(translationPromise);
        return translationPromise;
      }
      return null;
    };

    // Start first 2 translations immediately for better pipeline
    startNextTranslation(); // Batch 0
    if (batches.length > 1) {
      startNextTranslation(); // Batch 1 (get ahead of animations)
    }

    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      // Start animations for all blocks in current batch
      batch.forEach(block => {
        try {
          this.animateBlockStart(block);
        } catch (error) {
          console.warn('Error starting animation for block:', error);
        }
      });

      // Start translation for batch that's 2 ahead (more pipeline lookahead)
      if (batchIndex + 2 < batches.length && translationQueue.length <= batchIndex + 2) {
        startNextTranslation();
      }

      try {
        // Wait for current batch translation to complete
        const translationResult = await translationQueue[batchIndex];

        if (translationResult.success) {
          const batchTranslations = translationResult.result;

          // Animate translation reveal for each block
          for (let j = 0; j < batch.length; j++) {
            const block = batch[j];
            const blockTranslations = batchTranslations[j] || block.map(item => item.originalText);

            try {
              await this.animateTranslation(block, blockTranslations);
            } catch (animationError) {
              console.warn('Error animating block translation:', animationError);
              // Continue with the next block even if animation fails
            }

            // Update progress
            completedCount++;
            this.completedBlocks = completedCount;
            if (this.translationSettings.showProgress !== false) {
              this.updateTranslationProgress(completedCount, textBlocks.length);
            }

            // Update persistent state
            this.updateTranslationState({
              isTranslating: true,
              status: 'translating',
              progress: Math.round((completedCount / textBlocks.length) * 100),
              totalBlocks: textBlocks.length,
              completedBlocks: completedCount,
            });

            // Small delay between block animations
            if (j < batch.length - 1) {
              await this.delay(15);
            }
          }
        } else {
          // Handle translation error
          console.warn('Batch translation failed:', translationResult.error);

          // Check if this is a fatal client error that should stop the entire translation
          if (translationResult.error && translationResult.error.isFatalError) {
            console.error(
              'Fatal error encountered, stopping entire translation:',
              translationResult.error
            );

            // Update state to show error and stop translation
            this.updateTranslationState({
              isTranslating: false,
              status: 'error',
              error: translationResult.error.message,
              errorType: translationResult.error.errorType,
              progress: Math.round((completedCount / textBlocks.length) * 100),
              totalBlocks: textBlocks.length,
              completedBlocks: completedCount,
            });

            // Mark as not translating and cleanup
            this.isTranslating = false;
            if (this.translationSettings.showProgress !== false) {
              this.hideTranslationProgress();
            }

            // Throw the error to stop the entire translation process
            throw translationResult.error;
          }

          // For non-fatal errors, continue with error animation
          batch.forEach(block => {
            this.animateBlockError(block);
            completedCount++;
            this.completedBlocks = completedCount;
            this.updateTranslationProgress(completedCount, textBlocks.length);

            // Update persistent state
            this.updateTranslationState({
              isTranslating: true,
              status: 'translating',
              progress: Math.round((completedCount / textBlocks.length) * 100),
              totalBlocks: textBlocks.length,
              completedBlocks: completedCount,
            });
          });
        }
      } catch (error) {
        // Check if this is a fatal error that should stop the entire translation
        if (error.isFatalError) {
          console.error('Fatal error in translation loop, stopping:', error);
          // Re-throw the fatal error to stop the entire translation process
          throw error;
        }

        console.warn('Unexpected batch error:', error);
        // Mark all blocks in batch as error
        batch.forEach(block => {
          this.animateBlockError(block);
          completedCount++;
          this.completedBlocks = completedCount;
          this.updateTranslationProgress(completedCount, textBlocks.length);

          // Update persistent state
          this.updateTranslationState({
            isTranslating: true,
            status: 'translating',
            progress: Math.round((completedCount / textBlocks.length) * 100),
            totalBlocks: textBlocks.length,
            completedBlocks: completedCount,
          });
        });
      }

      // Small delay between batches for smooth progression
      if (batchIndex + 1 < batches.length) {
        await this.delay(50);
      }
    }

    // Remove progress indicator and add toggle button
    if (this.translationSettings.showProgress !== false) {
      this.hideTranslationProgress();
    }
    this.addGlobalToggleButton();
  }

  groupIntoBlocks(textElements) {
    const blocks = [];
    let currentBlock = [];

    for (let i = 0; i < textElements.length; i++) {
      const element = textElements[i];
      const nextElement = textElements[i + 1];

      // Start new block for headings, major elements, or after significant gaps
      if (this.isBlockBoundary(element, nextElement) && currentBlock.length > 0) {
        blocks.push([...currentBlock]);
        currentBlock = [];
      }

      currentBlock.push(element);

      // Limit block size to avoid overwhelming the API, but allow related content to stay together
      if (currentBlock.length >= 3) {
        // Check if next element is closely related (same parent or similar structure)
        if (!nextElement || !this.areElementsRelated(element, nextElement)) {
          blocks.push([...currentBlock]);
          currentBlock = [];
        }
      }

      // Hard limit to prevent blocks from becoming too large
      if (currentBlock.length >= 5) {
        blocks.push([...currentBlock]);
        currentBlock = [];
      }
    }

    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    return blocks;
  }

  isBlockBoundary(element, nextElement) {
    const tagName = element.element.tagName.toLowerCase();

    // Strong boundaries - always start new block
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'article', 'section'].includes(tagName)) {
      return true;
    }

    // Check if we're moving to a different structural element
    if (nextElement) {
      const nextTagName = nextElement.element.tagName.toLowerCase();
      if (tagName !== nextTagName && ['p', 'div', 'li', 'blockquote'].includes(nextTagName)) {
        return true;
      }

      // Check if elements are in different containers
      if (element.element.parentElement !== nextElement.element.parentElement) {
        const elementDepth = this.getElementDepth(element.element);
        const nextElementDepth = this.getElementDepth(nextElement.element);
        // If depth difference is significant, create boundary
        if (Math.abs(elementDepth - nextElementDepth) > 2) {
          return true;
        }
      }
    }

    return false;
  }

  areElementsRelated(element1, element2) {
    // Check if elements are related and should stay in the same block
    const parent1 = element1.element.parentElement;
    const parent2 = element2.element.parentElement;

    // Same parent = closely related
    if (parent1 === parent2) {
      return true;
    }

    // Check if they're in the same list, table, or similar structure
    const container1 = element1.element.closest('ul, ol, table, blockquote, .content, .post');
    const container2 = element2.element.closest('ul, ol, table, blockquote, .content, .post');

    return container1 && container1 === container2;
  }

  getElementDepth(element) {
    let depth = 0;
    let current = element;
    while (current && current !== document.body) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  showTranslationProgress() {
    const progressBar = document.createElement('div');
    progressBar.id = 'llm-progress-bar';
    progressBar.innerHTML = `
      <div class="llm-progress-container">
        <div class="llm-progress-text">🌐 Translating content...</div>
        <div class="llm-progress-bar">
          <div class="llm-progress-fill" style="width: 0%"></div>
        </div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #llm-progress-bar {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 16px;
        border-radius: 8px;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        animation: slideIn 0.3s ease;
      }
      
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      
      .llm-progress-text {
        font-size: 12px;
        margin-bottom: 8px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.7);
      }
      
      .llm-progress-bar {
        width: 200px;
        height: 4px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 2px;
        overflow: hidden;
      }
      
      .llm-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #22c55e, #3b82f6);
        transition: width 0.3s ease;
        border-radius: 2px;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(progressBar);
  }

  updateTranslationProgress(current, total) {
    const progressBar = document.getElementById('llm-progress-bar');
    if (progressBar) {
      const percentage = Math.round((current / total) * 100);
      const fill = progressBar.querySelector('.llm-progress-fill');
      const text = progressBar.querySelector('.llm-progress-text');

      fill.style.width = `${percentage}%`;
      const blocksPerRequest = this.translationSettings?.blocksPerRequest || 5;
      text.textContent = `🌐 Translating... ${current}/${total} blocks (${blocksPerRequest}/batch, pipeline)`;
    }
  }

  hideTranslationProgress() {
    setTimeout(() => {
      const progressBar = document.getElementById('llm-progress-bar');
      const style = document.querySelector('style[data-llm-progress]');

      if (progressBar) {
        const animationDuration = this.getAdjustedTiming(300);
        progressBar.style.animation = `slideIn ${animationDuration}ms ease reverse`;
        setTimeout(() => progressBar.remove(), animationDuration);
      }

      if (style) style.remove();
    }, this.getAdjustedTiming(1000));
  }

  animateBlockStart(block) {
    block.forEach(item => {
      const element = item.element;
      element.classList.add('llm-preparing');

      // Store original content
      this.originalContent.set(element, item.originalText);
    });
  }

  animateBlockError(block) {
    block.forEach(item => {
      const element = item.element;
      element.classList.remove('llm-preparing');
      element.classList.add('llm-error');
    });
  }

  // Helper method to replace links with placeholders and extract link text for translation
  replaceLinksWithPlaceholders(text, linkMap) {
    // Safety checks
    if (typeof text !== 'string') {
      console.warn('replaceLinksWithPlaceholders: text is not a string:', typeof text);
      return text || '';
    }

    if (!linkMap || typeof linkMap !== 'object') {
      console.warn('replaceLinksWithPlaceholders: linkMap is not an object:', typeof linkMap);
      return text;
    }

    let processedText = text;
    let linkCounter = Object.keys(linkMap).length;

    // Find all links in the text and replace with placeholders
    const linkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>(.*?)<\/a>/gi;
    processedText = processedText.replace(linkRegex, (match, href, linkText) => {
      linkCounter++;
      const placeholder = `[LINK_${linkCounter}]`;

      // Store link metadata, including the text that should be translated
      linkMap[placeholder] = {
        originalHTML: match,
        href: href,
        originalText: linkText,
        // Extract other attributes from the original link
        attributes: match.match(/<a\s+([^>]*)>/i)?.[1] || `href="${href}"`,
      };

      if (this.debug) {
        console.log(`Replaced link: "${linkText}" -> "${placeholder}" (href: ${href})`);
      }

      // Return the placeholder followed by the link text (so the link text gets translated)
      return `${placeholder}${linkText}[/LINK_${linkCounter}]`;
    });

    return processedText;
  }

  // Helper method to restore links from placeholders with translated text
  restoreLinksFromPlaceholders(text, linkMap) {
    // Safety checks
    if (typeof text !== 'string') {
      console.warn('restoreLinksFromPlaceholders: text is not a string:', typeof text);
      return text || '';
    }

    if (!linkMap || typeof linkMap !== 'object') {
      return text;
    }

    let processedText = text;

    // Replace placeholders with reconstructed links using translated text
    for (const [placeholder, linkData] of Object.entries(linkMap)) {
      const linkNumber = placeholder.match(/\[LINK_(\d+)\]/)?.[1];
      if (!linkNumber) continue;

      const startPlaceholder = `[LINK_${linkNumber}]`;
      const endPlaceholder = `[/LINK_${linkNumber}]`;

      // Find the translated link text between placeholders
      const startIndex = processedText.indexOf(startPlaceholder);
      const endIndex = processedText.indexOf(endPlaceholder);

      if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const extractedText = processedText.substring(
          startIndex + startPlaceholder.length,
          endIndex
        );
        const translatedLinkText = (extractedText || '').trim();

        // Reconstruct the link with translated text
        const newLink = `<a ${linkData.attributes}>${translatedLinkText}</a>`;

        if (this.debug) {
          console.log(
            `Restored link: "${linkData.originalText}" -> "${translatedLinkText}" (href: ${linkData.href})`
          );
        }

        // Replace the placeholder section with the new link
        const placeholderSection = processedText.substring(
          startIndex,
          endIndex + endPlaceholder.length
        );
        processedText = processedText.replace(placeholderSection, newLink);
      } else {
        // Fallback: use original link if placeholders not found properly
        if (processedText.includes(startPlaceholder)) {
          processedText = processedText.replace(
            new RegExp(startPlaceholder.replace(/[[\]]/g, '\\$&'), 'g'),
            linkData.originalHTML
          );
        }
      }
    }

    return processedText;
  }

  async translateMultipleBlocks(blocks) {
    // Prepare link placeholder mapping
    const linkMap = {};

    // Combine all blocks into a single request with clear separators
    const blockTexts = blocks.map(block => {
      return block
        .map(item => {
          // Use HTML with placeholders for elements with links, otherwise use text
          let textToTranslate;
          if (item.hasLinks && item.originalHTML) {
            textToTranslate = this.replaceLinksWithPlaceholders(item.originalHTML, linkMap);
          } else {
            textToTranslate = item.originalText;
          }

          if (this.debug && item.hasLinks) {
            console.log('Item with links:', {
              originalText: item.originalText,
              originalHTML: item.originalHTML,
              textToTranslate: textToTranslate,
            });
          }

          return textToTranslate;
        })
        .join('\n\n||ITEM_SEPARATOR||\n\n');
    });

    // Use a unique separator between blocks
    const combinedText = blockTexts.join('\n\n===BLOCK_SEPARATOR===\n\n');

    try {
      const translatedText = await this.callTranslationAPI(combinedText);

      // Debug logging for separator issues
      if (this.debug && translatedText.includes('===BLOCK_SEPARATOR===')) {
        console.log('Separator debug - original blocks:', blocks.length);
        console.log(
          'Separator debug - translation contains separators:',
          translatedText.includes('===BLOCK_SEPARATOR===')
        );
        console.log('Separator debug - full translation:', translatedText);
      }

      // Split back into blocks - handle variations in separator formatting
      let translatedBlocks = translatedText.split('\n\n===BLOCK_SEPARATOR===\n\n');

      // Fallback: try without double newlines if exact match failed
      if (translatedBlocks.length === 1 && translatedText.includes('===BLOCK_SEPARATOR===')) {
        if (this.debug) console.log('Separator debug: trying fallback without double newlines');
        translatedBlocks = translatedText.split('===BLOCK_SEPARATOR===');
      }

      // Additional fallback: try with single newlines
      if (translatedBlocks.length === 1 && translatedText.includes('===BLOCK_SEPARATOR===')) {
        if (this.debug) console.log('Separator debug: trying fallback with single newlines');
        translatedBlocks = translatedText.split('\n===BLOCK_SEPARATOR===\n');
      }

      if (this.debug) {
        console.log('Separator debug - final block count:', translatedBlocks.length);
      }

      // Process each translated block
      const results = [];
      for (let i = 0; i < blocks.length; i++) {
        const originalBlock = blocks[i];
        const translatedBlockText = translatedBlocks[i] || blockTexts[i];

        // Split the translated block back into individual texts using item separator
        let translatedParts = translatedBlockText
          .split('\n\n||ITEM_SEPARATOR||\n\n')
          .map(part => (typeof part === 'string' ? part : '').trim())
          .filter(part => part.length > 0);

        // Fallback: try without double newlines if exact match failed
        if (translatedParts.length === 1 && translatedBlockText.includes('||ITEM_SEPARATOR||')) {
          translatedParts = translatedBlockText
            .split('||ITEM_SEPARATOR||')
            .map(part => (typeof part === 'string' ? part : '').trim())
            .filter(part => part.length > 0);
        }

        // Additional fallback: try with single newlines
        if (translatedParts.length === 1 && translatedBlockText.includes('||ITEM_SEPARATOR||')) {
          translatedParts = translatedBlockText
            .split('\n||ITEM_SEPARATOR||\n')
            .map(part => (typeof part === 'string' ? part : '').trim())
            .filter(part => part.length > 0);
        }

        // Restore links from placeholders in translated parts
        translatedParts = translatedParts.map((part, partIndex) => {
          try {
            const restoredPart = this.restoreLinksFromPlaceholders(part, linkMap);

            if (this.debug && part !== restoredPart) {
              console.log(`Link restoration for part ${partIndex}:`, {
                original: part,
                restored: restoredPart,
                containsLinks: restoredPart.includes('<a '),
              });
            }

            return restoredPart;
          } catch (error) {
            console.warn(`Error restoring links for part ${partIndex}:`, error);
            return part; // Return original part if restoration fails
          }
        });

        // Enhanced fallback logic for missing/mismatched parts
        if (translatedParts.length !== originalBlock.length) {
          console.warn(
            `Translation mismatch: expected ${originalBlock.length} parts, got ${translatedParts.length}`
          );

          if (this.debug) {
            console.log('Item separator debug - original block text:', blockTexts[i]);
            console.log('Item separator debug - translated block text:', translatedBlockText);
            console.log(
              'Item separator debug - contains item separators:',
              translatedBlockText.includes('||ITEM_SEPARATOR||')
            );
            console.log(
              'Item separator debug - translated parts (after link restoration):',
              translatedParts
            );
          }

          if (translatedParts.length === 1 && originalBlock.length > 1) {
            // Single translation for multiple items - try to split intelligently
            const singleTranslation = translatedParts[0];

            // Try splitting by sentence boundaries or paragraphs
            const sentences = singleTranslation
              .split(/[.!?]\s+/)
              .filter(s => s && typeof s === 'string' && s.trim());
            const paragraphs = singleTranslation
              .split('\n\n')
              .filter(p => p && typeof p === 'string' && p.trim());

            if (sentences.length === originalBlock.length) {
              translatedParts = sentences.map(
                s => (typeof s === 'string' ? s : '').trim() + (s.match(/[.!?]$/) ? '' : '.')
              );
            } else if (paragraphs.length === originalBlock.length) {
              translatedParts = paragraphs.map(p => (typeof p === 'string' ? p : '').trim());
            } else {
              // Split proportionally by character length
              const avgLength = Math.ceil(singleTranslation.length / originalBlock.length);
              translatedParts = [];
              let remaining = singleTranslation;

              for (let j = 0; j < originalBlock.length - 1; j++) {
                const splitIndex = Math.min(avgLength, remaining.length);
                // Try to split at word boundary
                const wordBoundary = remaining.lastIndexOf(' ', splitIndex);
                const cutIndex = wordBoundary > splitIndex * 0.7 ? wordBoundary : splitIndex;

                translatedParts.push((remaining.substring(0, cutIndex) || '').trim());
                remaining = (remaining.substring(cutIndex) || '').trim();
              }
              translatedParts.push(remaining); // Add the rest
            }
          } else if (translatedParts.length > originalBlock.length) {
            // More translations than original items - merge extras
            const merged = translatedParts.slice(0, originalBlock.length - 1);
            const lastParts = translatedParts.slice(originalBlock.length - 1);
            merged.push((lastParts.join(' ') || '').trim());
            translatedParts = merged;
          } else {
            // Still mismatched - pad with original texts
            while (translatedParts.length < originalBlock.length) {
              const missingIndex = translatedParts.length;
              translatedParts.push(originalBlock[missingIndex].originalText);
            }
          }
        }

        // Ensure we still have the exact number of parts
        if (translatedParts.length !== originalBlock.length) {
          console.warn('Final fallback: using original texts for block', i);
          results.push(originalBlock.map(item => item.originalText));
        } else {
          results.push(translatedParts);
        }
      }

      return results;
    } catch (error) {
      console.error('Batch translation error:', error);

      // If this is a fatal error (like 401, 403, etc.), don't catch it - let it propagate
      if (error.isFatalError) {
        console.error('Fatal error in translateMultipleBlocks, re-throwing:', error);
        throw error;
      }

      // For non-fatal errors, fallback: return original texts for all blocks
      return blocks.map(block => block.map(item => item.originalText));
    }
  }

  async translateBlock(block) {
    // Legacy method for single block translation - now uses batch method
    const result = await this.translateMultipleBlocks([block]);
    return result[0] || block.map(item => item.originalText);
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

  async callTranslationAPI(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return text || '';
    }

    // Content scripts use background script for API calls

    const targetLanguageName = this.getLanguageName(this.translationSettings.targetLanguage);

    try {
      if (this.debug) {
        console.log('Translation request via background script:', {
          model: this.translationSettings.model,
          targetLanguage: targetLanguageName,
          textLength: text.length,
          historyEntries: this.translationHistory.length,
        });
      }

      // Use background script for API calls (it has the centralized API client)
      const result = await chrome.runtime.sendMessage({
        action: 'TRANSLATE_REQUEST',
        text: text,
        settings: this.translationSettings,
        translationHistory: this.translationHistory, // Pass context for better translations
      });

      if (!result || !result.success) {
        // Handle API errors from background script
        let errorMessage = 'Translation failed';
        if (result && result.error) {
          if (typeof result.error === 'string') {
            errorMessage = result.error;
          } else if (result.error.toString) {
            errorMessage = result.error.toString();
          }
        }
        const error = new Error(errorMessage);

        if (result && result.errorType) {
          error.errorType = result.errorType;
        }
        if (result && result.errorStatus) {
          error.status = result.errorStatus;
        }
        if (
          result &&
          (result.isRetryable === false || (result.errorStatus >= 400 && result.errorStatus < 500))
        ) {
          error.isFatalError = true;
        }
        throw error;
      }

      const translatedText = result.translatedText;

      // Safety check for translatedText
      if (typeof translatedText !== 'string') {
        throw new Error(
          `Invalid translation result: expected string, got ${typeof translatedText}`
        );
      }

      // Add this translation to history for future context
      this.translationHistory.push({
        original: text,
        translated: translatedText,
        timestamp: Date.now(),
      });

      // Keep history manageable (max 10 entries)
      if (this.translationHistory.length > 10) {
        this.translationHistory = this.translationHistory.slice(-10);
      }

      return translatedText;
    } catch (error) {
      console.error('Translation API call failed:', error);

      // Re-throw API client errors as-is
      if (error.isFatalError || error.errorType) {
        throw error;
      }

      // Handle other errors
      throw new Error(`Translation failed: ${error.message}`);
    }
  }

  async animateTranslation(block, translatedTexts) {
    for (let i = 0; i < block.length; i++) {
      const item = block[i];
      const translatedText = translatedTexts[i] || item.originalText;

      await this.animateLineTransition(item, translatedText);
      await this.delay(10); // Faster stagger for quicker flow
    }
  }

  async animateLineTransition(item, translatedText) {
    const element = item.element;

    // Phase 1: Subtle fade out
    element.classList.remove('llm-preparing');
    element.classList.add('llm-fading-out');

    await this.delay(150);

    // Phase 2: Store original text and update with translation
    element.setAttribute('data-llm-original', item.originalText);
    element.setAttribute('data-llm-translated', translatedText);
    element.setAttribute('data-llm-state', 'translated');

    // Simplified and reliable text replacement
    try {
      // Store original content for restoration (use pre-stored original HTML)
      element.setAttribute('data-llm-original-html', item.originalInnerHTML || element.innerHTML);
      element.setAttribute('data-llm-original-nodes', JSON.stringify([item.originalText]));

      if (this.debug) {
        console.log('Text replacement debug:', {
          originalText: item.originalText,
          translatedText: translatedText,
          elementTag: element.tagName,
          hasLinks: !!element.querySelector('a[href]'),
          textContentBefore: element.textContent,
        });
      }

      // Check if the translated text contains HTML (links were restored)
      if (translatedText.includes('<a ') && translatedText.includes('</a>')) {
        // Translation contains HTML links - use sanitized innerHTML
        if (this.debug) console.log('Text replacement: using sanitized innerHTML (contains links)');
        element.innerHTML = translatedText;
      } else {
        // Plain text translation - use textContent for safety
        if (this.debug) console.log('Text replacement: using textContent (plain text)');
        element.textContent = translatedText;
      }

      if (this.debug) {
        console.log('Text replacement result:', {
          textContentAfter: element.textContent,
          matches: (element.textContent || '').trim() === (translatedText || '').trim(),
        });
      }
    } catch (error) {
      console.warn('Text replacement error, using fallback:', error);
      // Ultimate fallback - completely replace text content
      element.textContent = translatedText;
    }

    // Phase 3: Fade in with translation animation
    element.classList.remove('llm-fading-out');
    element.classList.add('llm-translated');

    await this.delay(200);

    // Phase 4: Settle
    element.classList.add('llm-settled');
  }

  addGlobalToggleButton() {
    // Check if button already exists
    if (document.getElementById('llm-original-toggle')) {
      return;
    }

    // Wait a bit to ensure progress bar is gone before showing toggle
    setTimeout(() => {
      this.createToggleButton();
    }, this.getAdjustedTiming(1500));
  }

  createToggleButton() {
    const toggleButton = document.createElement('div');
    toggleButton.id = 'llm-original-toggle';
    toggleButton.innerHTML = `
      <div class="llm-toggle-container">
        <button class="llm-toggle-btn" title="Toggle between translated and original text">
          <svg class="toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 0 1 6.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="toggle-text">Show Originals</span>
        </button>
      </div>
    `;

    // Add styles for the toggle button
    const style = document.createElement('style');
    style.textContent = `
      #llm-original-toggle {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: slideIn 0.3s ease;
      }
      
      .llm-toggle-container {
        backdrop-filter: blur(12px);
        background: rgba(255, 255, 255, 0.9);
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      
      .llm-toggle-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: none;
        border: none;
        color: #333;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        border-radius: 12px;
      }
      
      .llm-toggle-btn:hover {
        background: rgba(102, 126, 234, 0.1);
        color: #667eea;
      }
      
      .llm-toggle-btn.active {
        background: #667eea;
        color: white;
      }
      
      .toggle-icon {
        transition: transform 0.2s ease;
      }
      
      .llm-toggle-btn.active .toggle-icon {
        transform: rotate(180deg);
      }
      
      /* Global toggle button styles only - animations handled by animations.css */
      /* Note: .llm-showing-original styles are defined in animations.css */
    `;

    document.head.appendChild(style);
    document.body.appendChild(toggleButton);

    // Add click handler for global toggle
    const button = toggleButton.querySelector('.llm-toggle-btn');
    let globalShowingOriginals = false;

    button.addEventListener('click', () => {
      globalShowingOriginals = !globalShowingOriginals;

      // Update button appearance
      button.classList.toggle('active', globalShowingOriginals);
      button.querySelector('.toggle-text').textContent = globalShowingOriginals
        ? 'Show Translations'
        : 'Show Originals';

      // Toggle all translated elements
      const translatedElements = document.querySelectorAll(
        '[data-llm-state="translated"], [data-llm-state="showing-original"]'
      );

      translatedElements.forEach(element => {
        if (globalShowingOriginals) {
          // Show original text using enhanced restoration
          const originalText = element.getAttribute('data-llm-original');
          const originalHTML = element.getAttribute('data-llm-original-html');

          if (originalText) {
            // Try to restore original HTML structure if available
            if (originalHTML && originalHTML !== originalText) {
              try {
                element.innerHTML = originalHTML;
              } catch (error) {
                console.warn('Failed to restore original HTML, using text fallback:', error);
                element.textContent = originalText;
              }
            } else {
              // Try to restore using saved text node structure first
              if (!this.restoreOriginalTextNodes(element)) {
                // Fallback: use simple text replacement
                const textNode = this.findTextNode(element);
                if (textNode) {
                  textNode.textContent = originalText;
                } else {
                  // Last resort: set entire element text content
                  element.textContent = originalText;
                }
              }
            }
            element.setAttribute('data-llm-state', 'showing-original');
            element.classList.add('llm-showing-original');
          }
        } else {
          // Show translated text
          const translatedText = element.getAttribute('data-llm-translated');
          if (translatedText) {
            // Check if the translated text contains HTML links
            if (translatedText.includes('<a ') && translatedText.includes('</a>')) {
              // Translation contains HTML - use sanitized innerHTML
              element.innerHTML = translatedText;
            } else {
              // Plain text translation - use textContent
              element.textContent = translatedText;
            }

            element.setAttribute('data-llm-state', 'translated');
            element.classList.remove('llm-showing-original');
          }
        }
      });
    });
  }

  getAllTextNodesInElement(element) {
    // Get all text nodes within an element - safe implementation
    const textNodes = [];

    try {
      // Safety check
      if (!element || !element.nodeType) {
        return textNodes;
      }

      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: node => {
            // Safety checks to prevent recursion
            if (!node || !node.parentElement) {
              return NodeFilter.FILTER_REJECT;
            }

            const parent = node.parentElement;
            const tagName = parent.tagName;

            // Skip script/style tags and other problematic elements
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS'].includes(tagName)) {
              return NodeFilter.FILTER_REJECT;
            }

            // Only accept text nodes that have meaningful content
            const text = node.textContent;
            if (!text || typeof text !== 'string' || text.trim().length === 0) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          },
        },
        false
      );

      let node;
      let count = 0;
      const maxNodes = 50; // Prevent infinite loops

      while ((node = walker.nextNode()) && count < maxNodes) {
        textNodes.push(node);
        count++;
      }
    } catch (error) {
      console.warn('Error in getAllTextNodesInElement:', error);
    }

    return textNodes;
  }

  findTextNode(element) {
    // Find the primary text node within the element - safe implementation
    try {
      if (!element || !element.nodeType) {
        return null;
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
      let node;
      let count = 0;
      const maxNodes = 20;

      while ((node = walker.nextNode()) && count < maxNodes) {
        if (node.textContent && node.textContent.trim()) {
          return node;
        }
        count++;
      }
    } catch (error) {
      console.warn('Error in findTextNode:', error);
    }

    return null;
  }

  restoreOriginalTextNodes(element) {
    // Restore original text for elements with multiple text nodes - safe implementation
    try {
      if (!element || !element.nodeType) {
        return false;
      }

      const originalNodesData = element.getAttribute('data-llm-original-nodes');
      if (!originalNodesData) {
        return false;
      }

      const originalTexts = JSON.parse(originalNodesData);
      if (!Array.isArray(originalTexts) || originalTexts.length === 0) {
        return false;
      }

      // Simple approach: just restore the original text directly
      const originalText = element.getAttribute('data-llm-original');
      if (originalText) {
        element.textContent = originalText;
        return true;
      }

      // Fallback: use first item from original texts array
      if (originalTexts[0]) {
        element.textContent = originalTexts[0];
        return true;
      }
    } catch (error) {
      console.warn('Failed to restore original text nodes:', error);

      // Ultimate fallback: try to get original from data attribute
      try {
        const originalText = element.getAttribute('data-llm-original');
        if (originalText) {
          element.textContent = originalText;
          return true;
        }
      } catch (fallbackError) {
        console.warn('Fallback restoration also failed:', fallbackError);
      }
    }

    return false;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, this.getAdjustedTiming(ms)));
  }

  // Animation speed system
  getSpeedMultiplier() {
    const speed = this.translationSettings?.animationSpeed || 'normal';
    switch (speed) {
      case 'slow':
        return 1.5; // 1.5x slower
      case 'fast':
        return 0.6; // 0.6x faster
      case 'normal':
      default:
        return 1.0; // normal speed
    }
  }

  getAdjustedTiming(baseMs) {
    return Math.round(baseMs * this.getSpeedMultiplier());
  }

  injectSpeedAdjustedCSS() {
    // Remove any existing speed-adjusted CSS
    const existingStyle = document.getElementById('llm-speed-adjusted-styles');
    if (existingStyle) {
      existingStyle.remove();
    }

    const multiplier = this.getSpeedMultiplier();

    // Only inject custom CSS if speed is not normal
    if (multiplier === 1.0) return;

    const css = `
      .llm-preparing {
        transition-duration: ${0.2 * multiplier}s !important;
        animation-duration: ${1.0 * multiplier}s !important;
      }
      .llm-fading-out {
        animation-duration: ${0.15 * multiplier}s !important;
      }
      .llm-translated {
        animation-duration: ${0.2 * multiplier}s !important;
      }
      .llm-settled {
        transition-duration: ${0.2 * multiplier}s !important;
      }
      .llm-error {
        animation-duration: ${0.5 * multiplier}s !important;
      }
      .llm-block-loading::after {
        animation-duration: ${1.0 * multiplier}s !important;
      }
      .llm-showing-original {
        transition-duration: ${0.2 * multiplier}s !important;
      }
      #llm-progress-bar {
        animation-duration: ${0.3 * multiplier}s !important;
      }
      .llm-progress-fill {
        transition-duration: ${0.3 * multiplier}s !important;
      }
      @media (prefers-reduced-motion: reduce) {
        .llm-preparing, .llm-fading-out, .llm-translated, .llm-settled {
          animation: none !important;
          transition: opacity ${0.2 * multiplier}s ease !important;
        }
      }
    `;

    const style = document.createElement('style');
    style.id = 'llm-speed-adjusted-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  playCompletionSound() {
    try {
      // Create a simple, pleasant completion sound using Web Audio API
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Create a short, gentle completion tone
      const oscillator1 = audioContext.createOscillator();
      const oscillator2 = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      // Two-tone chime effect
      oscillator1.connect(gainNode);
      oscillator2.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Set frequencies for a pleasant chord (C and G notes)
      oscillator1.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      oscillator2.frequency.setValueAtTime(783.99, audioContext.currentTime); // G5

      // Set waveform for a soft sound
      oscillator1.type = 'sine';
      oscillator2.type = 'sine';

      // Gentle fade in and out envelope
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.2);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.4);

      // Play the sound
      const startTime = audioContext.currentTime;
      oscillator1.start(startTime);
      oscillator2.start(startTime);
      oscillator1.stop(startTime + 0.4);
      oscillator2.stop(startTime + 0.4);
    } catch (error) {
      console.warn('Could not play completion sound:', error);
      // Fallback: try using a simple beep if Web Audio API fails
      try {
        const audio = new window.Audio(
          'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmUhCjuZz/LNeSMFLrHa7eGWQQsVX7Tp65VFEAg+s+ruy2Q9Cz8h'
        );
        audio.volume = 0.1;
        audio.play().catch(() => {
          // Silent fail if even the fallback doesn't work
        });
      } catch {
        // Silent fail - user interaction may be required for audio
      }
    }
  }

  updateTranslationState(state) {
    // Send state update to background script for persistence
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
        state: state,
      })
      .then(response => {
        if (this.debug) {
          console.log('Translation state update response:', response);
        }
      })
      .catch(error => {
        console.error('Failed to update translation state:', error);
      });
  }

  async getTranslationState() {
    // Get current translation state from background script
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
    // Clear translation state from background script
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
    // Remove any existing progress bar or error indicators from previous translations
    const existingProgress = document.getElementById('llm-progress-bar');
    if (existingProgress) {
      existingProgress.remove();
    }

    const existingToggle = document.getElementById('llm-global-toggle');
    if (existingToggle) {
      existingToggle.remove();
    }

    // Clear any existing translation classes from elements
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
