/**
 * Animation module for Line Localization Machine.
 *
 * Handles all visual feedback: progress bar, translation animations,
 * and toggle button.
 */

// ─── Timing Helpers ───────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function showTranslationProgress() {
  const progressBar = document.createElement('div');
  progressBar.id = 'llm-progress-bar';
  progressBar.innerHTML = `
    <div class="llm-progress-inner">
      <div class="llm-progress-label">Translating</div>
      <div class="llm-progress-text">Analyzing content...</div>
      <div class="llm-progress-track">
        <div class="llm-progress-fill" style="width: 0%"></div>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.setAttribute('data-llm-progress', '');
  style.textContent = `
    #llm-progress-bar {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 10000;
      background: #fffffe;
      border: 1px solid #e0ded7;
      padding: 14px 16px;
      border-radius: 4px;
      color: #2d2a25;
      font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
      animation: llmSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      min-width: 260px;
    }

    @keyframes llmSlideIn {
      from { transform: translateY(-8px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .llm-progress-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #d97706;
      margin-bottom: 4px;
    }

    .llm-progress-text {
      font-size: 11px;
      font-weight: 400;
      color: #8a857a;
      margin-bottom: 10px;
      line-height: 1.3;
    }

    .llm-reasoning-stats {
      display: block;
      margin-bottom: 4px;
    }

    .llm-reasoning-snippet {
      display: block;
      font-size: 10px;
      color: #b0aa9f;
      font-style: italic;
      max-width: 260px;
      max-height: 3.9em;
      line-height: 1.3;
      overflow: hidden;
      word-break: break-all;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }

    .llm-progress-track {
      width: 100%;
      height: 3px;
      background: #efeee9;
      border-radius: 1px;
      overflow: hidden;
    }

    .llm-progress-fill {
      height: 100%;
      background: #2d2a25;
      transition: width 0.3s ease;
      border-radius: 1px;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(progressBar);
}

function updateReasoningProgress(seconds, kChars, snippet) {
  const progressBar = document.getElementById('llm-progress-bar');
  if (!progressBar) return;

  const text = progressBar.querySelector('.llm-progress-text');
  const fill = progressBar.querySelector('.llm-progress-fill');
  const label = progressBar.querySelector('.llm-progress-label');

  if (label) label.textContent = 'Thinking';

  // Show stats + a sliding window of thinking text
  if (text) {
    const stats = `${seconds}s \u00b7 ${kChars}k chars`;
    if (snippet) {
      // Clean up the snippet: collapse whitespace, trim to ~80 chars
      const clean = snippet.replace(/\s+/g, ' ').trim().slice(-200);
      text.innerHTML =
        `<span class="llm-reasoning-stats">${stats}</span>` +
        `<span class="llm-reasoning-snippet">${escapeHTML(clean)}</span>`;
    } else {
      text.textContent = stats;
    }
  }

  if (fill) fill.style.width = `${Math.min(30, Number(seconds) * 3)}%`;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateTranslationProgress(current, total) {
  const progressBar = document.getElementById('llm-progress-bar');
  if (progressBar) {
    const percentage = Math.round((current / total) * 100);
    const fill = progressBar.querySelector('.llm-progress-fill');
    const text = progressBar.querySelector('.llm-progress-text');
    const label = progressBar.querySelector('.llm-progress-label');

    if (label) label.textContent = 'Translating';
    fill.style.width = `${percentage}%`;
    text.textContent = `${current}/${total} blocks \u00b7 ${percentage}%`;
  }
}

function hideTranslationProgress() {
  setTimeout(() => {
    const progressBar = document.getElementById('llm-progress-bar');
    const style = document.querySelector('style[data-llm-progress]');

    if (progressBar) {
      progressBar.style.animation = `llmSlideIn 300ms ease reverse`;
      setTimeout(() => progressBar.remove(), 300);
    }

    if (style) style.remove();
  }, 1000);
}

// ─── Block Animations ─────────────────────────────────────────────────────────

function animateBlockStart(block) {
  block.forEach(item => {
    item.element.classList.add('llm-preparing');
  });
}

function animateBlockError(block) {
  block.forEach(item => {
    item.element.classList.remove('llm-preparing');
    item.element.classList.add('llm-error');
  });
}

async function animateTranslation(block, translatedItems, settings) {
  for (let i = 0; i < block.length; i++) {
    const item = block[i];
    const translatedSegments = translatedItems[i] || item.textNodes.map(n => n.textContent);

    await animateLineTransition(item, translatedSegments, settings);
  }
}

/**
 * 4-phase animation: fade out → replace text nodes → fade in → settle.
 * Returns { originalHTML, translatedHTML } for toggle support.
 */
async function animateLineTransition(item, translatedSegments, settings, debug) {
  const element = item.element;

  // Skip if element was detached from DOM (page re-rendered, SPA navigation, etc.)
  if (!document.contains(element)) {
    if (debug) console.warn('[Animation] Skipping detached element');
    return null;
  }

  const segments = Array.isArray(translatedSegments)
    ? translatedSegments
    : [String(translatedSegments ?? '')];

  // Phase 1: Quick fade out
  element.classList.remove('llm-preparing');
  element.classList.add('llm-fading-out');
  await delay(50);

  // Snapshot original innerHTML BEFORE any modification (for toggle restore)
  const originalHTML = element.innerHTML;

  // Phase 2: Replace text nodes directly — never touch DOM structure
  if (segments.length === item.textNodes.length) {
    item.textNodes.forEach((node, i) => {
      node.textContent = segments[i];
    });
  } else {
    if (debug) {
      console.warn(
        `Segment count mismatch: expected ${item.textNodes.length}, got ${segments.length}`
      );
    }
    element.textContent = segments.join('');
  }

  // Snapshot translated innerHTML (for toggle restore)
  const translatedHTML = element.innerHTML;

  // Mark as translated
  element.setAttribute('data-llm-state', 'translated');

  // Phase 3: Quick fade in
  element.classList.remove('llm-fading-out');
  element.classList.add('llm-translated');
  await delay(60);

  // Phase 4: Settle
  element.classList.add('llm-settled');

  return { originalHTML, translatedHTML };
}

// ─── Toggle Button ────────────────────────────────────────────────────────────

function addGlobalToggleButton(translatedElements, retranslateCallback) {
  const existing = document.getElementById('llm-original-toggle');
  if (existing) existing.remove();

  setTimeout(() => {
    createToggleButton(translatedElements, retranslateCallback);
  }, 1500);
}

function createToggleButton(translatedElements, retranslateCallback) {
  const toggleButton = document.createElement('div');
  toggleButton.id = 'llm-original-toggle';
  const retranslateHTML = retranslateCallback
    ? `<button class="llm-retranslate-btn" title="Re-translate (skip cache)">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <polyline points="23 4 23 10 17 10" />
           <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
         </svg>
       </button>`
    : '';
  toggleButton.innerHTML = `
    <div class="llm-toggle-container">
      ${retranslateHTML}
      <button class="llm-toggle-btn" title="Toggle between translated and original text">
        <svg class="toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 0 1 6.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="toggle-text">Show Originals</span>
      </button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #llm-original-toggle {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace;
      animation: llmSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes llmSlideIn {
      from { transform: translateY(-8px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .llm-toggle-container {
      display: flex;
      align-items: stretch;
      background: #fffffe;
      border: 1px solid #e0ded7;
      border-radius: 4px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
    }

    .llm-retranslate-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      background: none;
      border: none;
      border-right: 1px solid #e0ded7;
      color: #a8a49a;
      cursor: pointer;
      transition: all 0.2s ease;
      border-radius: 4px 0 0 4px;
    }

    .llm-retranslate-btn:hover {
      background: #f7f6f3;
      color: #d97706;
    }

    .llm-retranslate-btn.loading {
      pointer-events: none;
      opacity: 0.4;
    }

    .llm-toggle-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: none;
      border: none;
      color: #2d2a25;
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.2s ease;
      border-radius: 4px;
    }

    .llm-toggle-btn:hover {
      background: #f7f6f3;
      color: #d97706;
    }

    .llm-toggle-btn.active {
      background: #2d2a25;
      color: #faf9f7;
    }

    .llm-toggle-btn.active:hover {
      background: #1a1816;
    }

    .toggle-icon {
      transition: transform 0.2s ease;
    }

    .llm-toggle-btn.active .toggle-icon {
      transform: rotate(180deg);
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(toggleButton);

  if (retranslateCallback) {
    const retranslateBtn = toggleButton.querySelector('.llm-retranslate-btn');
    retranslateBtn.addEventListener('click', () => {
      retranslateBtn.classList.add('loading');
      retranslateCallback().finally(() => {
        retranslateBtn.classList.remove('loading');
      });
    });
  }

  const button = toggleButton.querySelector('.llm-toggle-btn');
  let globalShowingOriginals = false;

  button.addEventListener('click', () => {
    globalShowingOriginals = !globalShowingOriginals;

    button.classList.toggle('active', globalShowingOriginals);
    button.querySelector('.toggle-text').textContent = globalShowingOriginals
      ? 'Show Translations'
      : 'Show Originals';

    for (const [element, data] of translatedElements) {
      if (globalShowingOriginals) {
        element.innerHTML = data.originalHTML;
        element.setAttribute('data-llm-state', 'showing-original');
        element.classList.add('llm-showing-original');
      } else {
        element.innerHTML = data.translatedHTML;
        element.setAttribute('data-llm-state', 'translated');
        element.classList.remove('llm-showing-original');
      }
    }
  });
}

// ─── Exports (global scope for content script) ───────────────────────────────

// eslint-disable-next-line no-unused-vars
const Animation = {
  delay,
  showTranslationProgress,
  updateReasoningProgress,
  updateTranslationProgress,
  hideTranslationProgress,
  animateBlockStart,
  animateBlockError,
  animateTranslation,
  animateLineTransition,
  addGlobalToggleButton,
};
