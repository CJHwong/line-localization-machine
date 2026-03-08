/**
 * Text extraction module for Line Localization Machine.
 *
 * Responsible for identifying article content (via Readability), extracting
 * translatable text elements from the DOM, collecting text nodes, grouping
 * elements into semantic blocks, and handling orphan text nodes.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const SKIP_TAGS = new Set([
  'CODE',
  'KBD',
  'SAMP',
  'ABBR',
  'SUB',
  'SUP',
  'VAR',
  'TIME',
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
]);

const BLOCK_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, li, td, th, figcaption, dt, dd, blockquote';

const SKIP_ANCESTORS = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS']);

const FALLBACK_NON_CONTENT = [
  'nav',
  'header',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '.sidebar',
  '.comments',
  '.comment-section',
  '.related-posts',
  '.related-articles',
  '.share-buttons',
  '.social-share',
  '.newsletter-signup',
  '.author-bio',
  '.post-meta',
  '.breadcrumb',
  '.pagination',
  '.table-of-contents',
  '.toc',
].join(',');

const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TD',
  'TH',
  'FIGCAPTION',
  'DT',
  'DD',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'TABLE',
  'PRE',
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'FORM',
  'NAV',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'DETAILS',
  'SUMMARY',
  'FIGURE',
  'DIALOG',
]);

// ─── Text Node Collection ─────────────────────────────────────────────────────

/**
 * Collect translatable text nodes from a block element in document order.
 * Skips text inside opaque elements (code, kbd, etc.) that shouldn't be translated.
 */
function collectTextNodes(element) {
  const textNodes = [];

  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        if (child.textContent.trim().length > 0) {
          textNodes.push(child);
        }
      } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
        if (!SKIP_TAGS.has(child.tagName)) {
          walk(child);
        }
      }
    }
  };

  walk(element);
  return textNodes;
}

// ─── Content Identification (Readability) ─────────────────────────────────────

function normalizeWhitespace(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Use Mozilla Readability to identify article content.
 * Returns { articleTexts: Set, fullArticleText: string } or null if
 * the page isn't an article.
 */
function identifyArticleContent() {
  if (typeof Readability === 'undefined') {
    console.warn('[LLM] Readability not loaded, using fallback');
    return null;
  }

  if (typeof isProbablyReaderable === 'function' && !isProbablyReaderable(document)) {
    console.log('[LLM] Readability: page is not readerable, using fallback');
    return null;
  }

  try {
    const clone = document.cloneNode(true);
    const article = new Readability(clone).parse();

    if (!article || !article.content) {
      console.log('[LLM] Readability: could not parse article, using fallback');
      return null;
    }

    const temp = document.createElement('div');
    temp.innerHTML = article.content;
    const articleTexts = new Set();

    temp.querySelectorAll(BLOCK_SELECTORS).forEach(el => {
      const text = normalizeWhitespace(el.textContent);
      if (text.length >= 10) articleTexts.add(text);
    });

    const fullArticleText = normalizeWhitespace(article.textContent);

    console.log(
      `[LLM] Readability: identified article with ${articleTexts.size} text blocks, ` +
        `${fullArticleText.length} chars`
    );

    return { articleTexts, fullArticleText };
  } catch (error) {
    console.warn('[LLM] Readability error, using fallback:', error.message);
    return null;
  }
}

/**
 * Check if an element's text matches article content identified by Readability.
 */
function isArticleContent(element, articleData) {
  if (!articleData) return true; // No Readability data → accept everything (fallback mode)
  const text = normalizeWhitespace(element.textContent);
  if (text.length < 10) return false;

  if (articleData.articleTexts.has(text)) return true;
  if (text.length >= 20 && articleData.fullArticleText.includes(text)) return true;

  return false;
}

// ─── Element Extraction ───────────────────────────────────────────────────────

/**
 * Extract translatable text elements from the page.
 * Uses articleData (from Readability) to filter to article content only.
 * When articleData is null (fallback mode), accepts all content outside
 * known non-content zones.
 */
function extractTextElements(container, articleData) {
  const textElements = [];

  if (articleData) {
    console.log('[LLM] Extracting with Readability filter');
  } else {
    console.log('[LLM DEBUG] Fallback mode: no Readability data, using non-content blocklist');
  }

  try {
    if (!container || !container.nodeType) {
      console.warn('[LLM DEBUG] Invalid container provided to extractTextElements');
      return textElements;
    }

    const candidates = container.querySelectorAll(BLOCK_SELECTORS);
    const processedElements = new Set();

    for (const element of candidates) {
      // Skip if ancestor already processed (prevents <p> inside <li> duplication)
      let ancestorProcessed = false;
      let parent = element.parentElement;
      while (parent && parent !== container) {
        if (processedElements.has(parent)) {
          ancestorProcessed = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (ancestorProcessed) continue;

      // Skip code/script containers
      if (SKIP_ANCESTORS.has(element.tagName)) continue;
      if (element.closest([...SKIP_ANCESTORS].join(','))) continue;

      // Skip hidden elements
      if (element.getAttribute('aria-hidden') === 'true') continue;
      if (element.classList.contains('llm-no-translate')) continue;

      try {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
      } catch (_styleError) {
        // continue anyway
      }

      // Skip containers with block children (not leaf elements)
      if (element.tagName === 'BLOCKQUOTE') continue;
      if (element.querySelector(BLOCK_SELECTORS)) continue;

      // Fallback mode: skip non-content zones when Readability is unavailable
      if (!articleData) {
        const nonContentAncestor = element.closest(FALLBACK_NON_CONTENT);
        if (nonContentAncestor && nonContentAncestor !== container) continue;
      }

      // Check text length
      const text = element.textContent.trim();
      if (text.length < 10) continue;

      // Readability filter: skip elements whose text isn't in the article
      if (!isArticleContent(element, articleData)) continue;

      // Collect translatable text nodes
      const textNodes = collectTextNodes(element);
      if (textNodes.length === 0) continue;

      textElements.push({ element, originalText: text, textNodes });
      processedElements.add(element);

      if (textElements.length >= 1000) {
        console.warn('[LLM] Hit maximum element limit, stopping');
        break;
      }
    }

    // Second pass: orphan text nodes (bare text inside divs, not in block tags)
    collectOrphanTextElements(container, processedElements, textElements, articleData);
  } catch (error) {
    console.error('[LLM] Error in extractTextElements:', error);
  }

  console.log(`[LLM] Extracted ${textElements.length} translatable elements`);
  return textElements;
}

// ─── Orphan Text Collection ───────────────────────────────────────────────────

/**
 * Find orphan text nodes — significant text sitting directly inside container
 * elements (div, section, article) but not wrapped in any block-level tag.
 */
function collectOrphanTextElements(container, processedElements, textElements, articleData) {
  const wrappers = container.querySelectorAll('div, section, article, main');

  for (const wrapper of [container, ...wrappers]) {
    if (textElements.length >= 1000) break;

    let orphanRun = [];
    let runTextContent = '';

    const flushRun = () => {
      if (orphanRun.length === 0) return;
      const trimmed = runTextContent.trim();
      if (trimmed.length < 10) {
        orphanRun = [];
        runTextContent = '';
        return;
      }

      // Create a wrapper span so we have an element to mark as translated
      const span = document.createElement('span');
      span.setAttribute('data-llm-orphan-wrap', 'true');
      orphanRun[0].parentNode.insertBefore(span, orphanRun[0]);
      for (const node of orphanRun) {
        span.appendChild(node);
      }

      // Readability filter
      if (!isArticleContent(span, articleData)) {
        // Unwrap — put nodes back where they were
        while (span.firstChild) {
          span.parentNode.insertBefore(span.firstChild, span);
        }
        span.remove();
        orphanRun = [];
        runTextContent = '';
        return;
      }

      const textNodes = collectTextNodes(span);
      if (textNodes.length > 0) {
        textElements.push({ element: span, originalText: trimmed, textNodes });
        processedElements.add(span);
      }

      orphanRun = [];
      runTextContent = '';
    };

    for (const child of [...wrapper.childNodes]) {
      if (processedElements.has(child)) {
        flushRun();
        continue;
      }

      if (child.nodeType === 3 /* TEXT_NODE */) {
        if (child.textContent.trim().length > 0) {
          orphanRun.push(child);
          runTextContent += child.textContent;
        }
        continue;
      }

      if (child.nodeType === 1 /* ELEMENT_NODE */) {
        if (BLOCK_TAGS.has(child.tagName)) {
          flushRun();
          continue;
        }
        // Inline element with content — part of the run
        if (child.textContent.trim().length > 0) {
          orphanRun.push(child);
          runTextContent += child.textContent;
          continue;
        }
      }

      flushRun();
    }

    flushRun();
  }
}

// ─── Block Grouping ───────────────────────────────────────────────────────────

function getElementDepth(element) {
  let depth = 0;
  let current = element;
  while (current && current !== document.body) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

function areElementsRelated(element1, element2) {
  const parent1 = element1.element.parentElement;
  const parent2 = element2.element.parentElement;

  if (parent1 === parent2) return true;

  const container1 = element1.element.closest('ul, ol, table, blockquote, .content, .post');
  const container2 = element2.element.closest('ul, ol, table, blockquote, .content, .post');

  return container1 && container1 === container2;
}

function isBlockBoundary(element, nextElement) {
  const tagName = element.element.tagName.toLowerCase();

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'article', 'section'].includes(tagName)) {
    return true;
  }

  if (nextElement) {
    const nextTagName = nextElement.element.tagName.toLowerCase();
    if (tagName !== nextTagName && ['p', 'div', 'li', 'blockquote'].includes(nextTagName)) {
      return true;
    }

    if (element.element.parentElement !== nextElement.element.parentElement) {
      const depthDiff = Math.abs(
        getElementDepth(element.element) - getElementDepth(nextElement.element)
      );
      if (depthDiff > 2) return true;
    }
  }

  return false;
}

/**
 * Group extracted text elements into semantic blocks for batched translation.
 */
function groupIntoBlocks(textElements) {
  const blocks = [];
  let currentBlock = [];

  for (let i = 0; i < textElements.length; i++) {
    const element = textElements[i];
    const nextElement = textElements[i + 1];

    if (isBlockBoundary(element, nextElement) && currentBlock.length > 0) {
      blocks.push([...currentBlock]);
      currentBlock = [];
    }

    currentBlock.push(element);

    if (currentBlock.length >= 3) {
      if (!nextElement || !areElementsRelated(element, nextElement)) {
        blocks.push([...currentBlock]);
        currentBlock = [];
      }
    }

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

// ─── Exports (global scope for content script) ───────────────────────────────

// eslint-disable-next-line no-unused-vars
const TextExtraction = {
  collectTextNodes,
  identifyArticleContent,
  normalizeWhitespace,
  isArticleContent,
  extractTextElements,
  groupIntoBlocks,
};
