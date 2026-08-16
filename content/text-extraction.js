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
const MIN_ARTICLE_EXTRACTED_CHARS = 200;
const MIN_ARTICLE_COVERAGE = 0.5;
const MIN_READABILITY_PAGE_COVERAGE = 0.25;

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

// Tags that are always inline — orphan runs may wrap them without changing
// layout. Unknown tags (custom elements) are decided by computed display.
const INLINE_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'BDI',
  'BDO',
  'BR',
  'BUTTON',
  'CITE',
  'CODE',
  'DATA',
  'DEL',
  'DFN',
  'EM',
  'I',
  'IMG',
  'INS',
  'KBD',
  'LABEL',
  'MARK',
  'Q',
  'SAMP',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
  'VAR',
  'WBR',
]);

/**
 * True when the element renders inline. Custom elements default to inline in
 * browsers, but pages often style them block/flex/grid — wrapping those in an
 * orphan span inserts an unstyled box into the page's layout (grid items land
 * in the wrong column, flex items collapse), so they must flush the run.
 */
function isInlineElement(element) {
  if (INLINE_TAGS.has(element.tagName)) return true;
  const display = getComputedStyle(element).display;
  return (
    display === 'inline' ||
    display === 'inline-block' ||
    display === 'inline-flex' ||
    display === 'inline-grid' ||
    display === 'contents'
  );
}

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

    // Readability strips the title from article.content but returns it separately.
    // Include it so the page's <h1> title element passes the filter.
    const normalizedTitle = normalizeWhitespace(article.title);
    if (normalizedTitle.length >= 10) {
      articleTexts.add(normalizedTitle);
    }

    const fullArticleText = normalizedTitle + ' ' + normalizeWhitespace(article.textContent);
    const pageText = normalizeWhitespace(document.body.innerText || document.body.textContent);

    // Build the article region: live DOM roots that contain the article.
    // Readability's parse can drop article content (sibling containers, hero),
    // so the region replaces text matching against the parse output.
    const region = buildArticleRegion(article);

    console.log(
      `[LLM] Readability: identified article "${normalizedTitle}" with ` +
        `${articleTexts.size} text blocks, ${fullArticleText.length} chars, ` +
        `region: ${region ? region.size + ' root(s)' : 'none (text matching)'}`
    );

    return { articleTexts, fullArticleText, pageText, region };
  } catch (error) {
    console.warn('[LLM] Readability error, using fallback:', error.message);
    return null;
  }
}

// ─── Article Region (live DOM) ───────────────────────────────────────────────

/**
 * Check whether an element is inside the article region (a set of live DOM roots).
 */
function isInsideRegion(element, region) {
  for (const root of region) {
    if (root === element || root.contains(element)) return true;
  }
  return false;
}

/**
 * Find the live element whose text best matches the Readability article output.
 * Returns the innermost container with the highest overlap ratio, or null.
 */
function findTopCandidate(articleText) {
  let best = null;
  let bestRatio = 0;
  for (const el of document.body.querySelectorAll('div, section, article, main')) {
    const text = normalizeWhitespace(el.textContent);
    if (text.length < 100) continue;
    const ratio =
      Math.min(articleText.length, text.length) / Math.max(articleText.length, text.length);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = el;
    }
  }
  return bestRatio >= 0.5 ? best : null;
}

/**
 * Decide whether a sibling container looks like article content.
 * Rejects hidden elements, non-content zones, and link-heavy containers.
 * Short siblings (under 200 chars) are still article content when Readability
 * kept their text — the length floor alone rejects short standalone
 * paragraphs. Scripts and styles are never article content.
 */
function isArticleLikeSibling(element, articleText) {
  if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return false;
  if (element.classList.contains('w-condition-invisible')) return false;
  const style = element.getAttribute('style') || '';
  if (style.includes('display: none') || style.includes('visibility: hidden')) return false;
  if (element.closest(FALLBACK_NON_CONTENT)) return false;
  const text = normalizeWhitespace(element.textContent);
  if (text.length < 200) {
    if (text.length < 10 || !articleText.includes(text)) return false;
  }
  // Mostly links → navigation or card lists, not article prose
  const linkText = normalizeWhitespace(
    [...element.querySelectorAll('a')].map(a => a.textContent).join(' ')
  );
  if (linkText.length / text.length > 0.5) return false;
  return true;
}

/**
 * Find the section containing the article title (the hero).
 * Matches the H1 against the Readability title.
 */
function findHeroSection(title) {
  const normalizedTitle = normalizeWhitespace(title);
  if (normalizedTitle.length < 10) return null;
  for (const h1 of document.querySelectorAll('h1')) {
    const h1Text = normalizeWhitespace(h1.textContent);
    const matches =
      h1Text === normalizedTitle ||
      (h1Text.length >= 10 &&
        (h1Text.includes(normalizedTitle) || normalizedTitle.includes(h1Text)));
    if (!matches) continue;
    let hero = h1;
    while (hero.parentElement && hero.parentElement !== document.body) {
      const parent = hero.parentElement;
      if (['SECTION', 'ARTICLE', 'MAIN'].includes(parent.tagName)) return parent;
      if (normalizeWhitespace(parent.textContent).length < 200) break;
      hero = parent;
    }
    return hero;
  }
  return null;
}

/**
 * Build the article region: a set of live DOM roots that contain the article.
 *
 * Readability's parse can drop article content that lives in sibling containers
 * (multi-column layouts) or in the hero. Text-matching against the parse output
 * then rejects that content. The region replaces text matching: everything
 * inside the region is article content.
 */
function buildArticleRegion(article) {
  const articleText = normalizeWhitespace(article.textContent);
  if (articleText.length < 200) return null;

  const topCandidate = findTopCandidate(articleText);
  if (!topCandidate) return null;

  const region = new Set();

  // Walk up to the nearest section/article/main boundary
  let boundary = topCandidate;
  while (boundary.parentElement && boundary.parentElement !== document.body) {
    const parent = boundary.parentElement;
    if (['SECTION', 'ARTICLE', 'MAIN'].includes(parent.tagName)) {
      boundary = parent;
      break;
    }
    boundary = parent;
  }

  // If the boundary is mostly article text, use it as the region root.
  // Otherwise fall back to the top candidate plus article-like siblings.
  const boundaryText = normalizeWhitespace(boundary.textContent);
  const boundaryRatio =
    Math.min(articleText.length, boundaryText.length) /
    Math.max(articleText.length, boundaryText.length);
  if (boundaryRatio >= 0.5) {
    region.add(boundary);
  } else {
    region.add(topCandidate);
    let current = topCandidate;
    while (current.parentElement && current !== boundary) {
      const parent = current.parentElement;
      for (const sibling of parent.children) {
        if (sibling === current || region.has(sibling)) continue;
        if (isArticleLikeSibling(sibling, articleText)) region.add(sibling);
      }
      current = parent;
    }
  }

  // Hero: the section containing the article title
  const hero = findHeroSection(article.title);
  if (hero) region.add(hero);

  return region;
}

/**
 * Check if an element's text matches article content identified by Readability.
 */
function isArticleContent(element, articleData) {
  if (!articleData) return true; // No Readability data → accept everything (fallback mode)

  // Headings are structurally part of the article — skip Readability matching
  if (/^H[1-6]$/.test(element.tagName)) return true;

  const text = normalizeWhitespace(element.textContent);
  if (text.length < 10) return false;

  // Region mode: accept everything inside the article region. Readability's
  // parse can drop article content (sibling containers, hero), so text
  // matching against the parse output is not reliable.
  if (articleData.region) {
    return isInsideRegion(element, articleData.region);
  }

  if (articleData.articleTexts.has(text)) return true;
  if (text.length >= 20 && articleData.fullArticleText.includes(text)) return true;

  return false;
}

/**
 * Decide whether a successful Readability parse produced too little usable DOM
 * content to justify keeping its filter.
 */
function shouldFallbackToWholePage(textElements, articleData) {
  if (!articleData) return false;

  const extractedChars = (textElements || []).reduce(
    (total, textElement) => total + normalizeWhitespace(textElement.originalText).length,
    0
  );
  const articleChars = normalizeWhitespace(articleData.fullArticleText).length;

  if (extractedChars < MIN_ARTICLE_EXTRACTED_CHARS) return true;
  if (articleChars === 0) return true;

  const pageChars = normalizeWhitespace(articleData.pageText).length;
  if (pageChars > articleChars && articleChars / pageChars < MIN_READABILITY_PAGE_COVERAGE) {
    return true;
  }

  return extractedChars / articleChars < MIN_ARTICLE_COVERAGE;
}

/**
 * Restore orphan text nodes after a discarded Readability extraction pass.
 */
function restoreOrphanTextElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return;

  for (const wrapper of container.querySelectorAll('[data-llm-orphan-wrap="true"]')) {
    if (!wrapper.parentNode) continue;

    while (wrapper.firstChild) {
      wrapper.parentNode.insertBefore(wrapper.firstChild, wrapper);
    }
    wrapper.remove();
  }
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
    console.log(
      articleData.region
        ? `[LLM] Extracting with article region (${articleData.region.size} roots)`
        : '[LLM] Extracting with Readability text filter'
    );
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
      if (element.querySelector(BLOCK_SELECTORS)) continue;

      // Skip non-content zones (fallback mode, or region mode where the region
      // may include non-article zones such as share buttons)
      if (!articleData || articleData.region) {
        const nonContentAncestor = element.closest(FALLBACK_NON_CONTENT);
        if (nonContentAncestor && nonContentAncestor !== container) continue;
      }

      // Check text length (headings are always kept — structurally part of the article)
      const tagName = element.tagName;
      const text = element.textContent.trim();
      if (text.length < 10 && !/^H[1-6]$/.test(tagName)) continue;

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
        if (BLOCK_TAGS.has(child.tagName) || !isInlineElement(child)) {
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
  shouldFallbackToWholePage,
  restoreOrphanTextElements,
  extractTextElements,
  groupIntoBlocks,
  buildArticleRegion,
  isInsideRegion,
};
