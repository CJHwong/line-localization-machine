/**
 * Animation module for Line Localization Machine.
 *
 * Handles all visual feedback: progress bar, translation animations,
 * toggle button, speed adjustments, and completion sound.
 */

// ─── Timing Helpers ───────────────────────────────────────────────────────────

function getSpeedMultiplier(settings) {
  const speed = settings?.animationSpeed || 'normal';
  switch (speed) {
    case 'slow':
      return 1.5;
    case 'fast':
      return 0.6;
    case 'normal':
    default:
      return 1.0;
  }
}

function getAdjustedTiming(baseMs, settings) {
  return Math.round(baseMs * getSpeedMultiplier(settings));
}

function delay(ms, settings) {
  return new Promise(resolve => setTimeout(resolve, getAdjustedTiming(ms, settings)));
}

// ─── Speed-Adjusted CSS ──────────────────────────────────────────────────────

function injectSpeedAdjustedCSS(settings) {
  const existingStyle = document.getElementById('llm-speed-adjusted-styles');
  if (existingStyle) existingStyle.remove();

  const multiplier = getSpeedMultiplier(settings);
  if (multiplier === 1.0) return;

  const css = `
    .llm-preparing::after {
      animation-duration: ${2.4 * multiplier}s !important;
    }
    .llm-fading-out {
      animation-duration: ${0.06 * multiplier}s !important;
    }
    .llm-translated {
      animation-duration: ${0.18 * multiplier}s !important;
    }
    .llm-settled {
      transition-duration: ${0.2 * multiplier}s !important;
    }
    .llm-error {
      animation-duration: ${0.25 * multiplier}s !important;
    }
    .llm-block-loading::after {
      animation-duration: ${0.8 * multiplier}s !important;
    }
    .llm-showing-original {
      transition-duration: ${0.15 * multiplier}s !important;
    }
    #llm-progress-bar {
      animation-duration: ${0.3 * multiplier}s !important;
    }
    .llm-progress-fill {
      transition-duration: ${0.3 * multiplier}s !important;
    }
    @media (prefers-reduced-motion: reduce) {
      .llm-preparing::after, .llm-fading-out, .llm-translated, .llm-error {
        animation: none !important;
      }
      .llm-settled {
        transition: none !important;
      }
    }
  `;

  const style = document.createElement('style');
  style.id = 'llm-speed-adjusted-styles';
  style.textContent = css;
  document.head.appendChild(style);
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
      min-width: 220px;
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

function updateTranslationProgress(current, total, settings) {
  const progressBar = document.getElementById('llm-progress-bar');
  if (progressBar) {
    const percentage = Math.round((current / total) * 100);
    const fill = progressBar.querySelector('.llm-progress-fill');
    const text = progressBar.querySelector('.llm-progress-text');

    fill.style.width = `${percentage}%`;
    const blocksPerRequest = settings?.blocksPerRequest || 5;
    text.textContent = `${current}/${total} blocks \u00b7 ${blocksPerRequest}/batch \u00b7 ${percentage}%`;
  }
}

function hideTranslationProgress(settings) {
  setTimeout(
    () => {
      const progressBar = document.getElementById('llm-progress-bar');
      const style = document.querySelector('style[data-llm-progress]');

      if (progressBar) {
        const animationDuration = getAdjustedTiming(300, settings);
        progressBar.style.animation = `llmSlideIn ${animationDuration}ms ease reverse`;
        setTimeout(() => progressBar.remove(), animationDuration);
      }

      if (style) style.remove();
    },
    getAdjustedTiming(1000, settings)
  );
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
  const segments = Array.isArray(translatedSegments)
    ? translatedSegments
    : [String(translatedSegments ?? '')];

  // Phase 1: Quick fade out
  element.classList.remove('llm-preparing');
  element.classList.add('llm-fading-out');
  await delay(50, settings);

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
  await delay(60, settings);

  // Phase 4: Settle
  element.classList.add('llm-settled');

  return { originalHTML, translatedHTML };
}

// ─── Toggle Button ────────────────────────────────────────────────────────────

function addGlobalToggleButton(translatedElements, settings) {
  if (document.getElementById('llm-original-toggle')) return;

  setTimeout(
    () => {
      createToggleButton(translatedElements);
    },
    getAdjustedTiming(1500, settings)
  );
}

function createToggleButton(translatedElements) {
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
      background: #fffffe;
      border: 1px solid #e0ded7;
      border-radius: 4px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
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

// ─── Completion Sound ─────────────────────────────────────────────────────────

function playCompletionSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator1 = audioContext.createOscillator();
    const oscillator2 = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator1.connect(gainNode);
    oscillator2.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator1.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
    oscillator2.frequency.setValueAtTime(783.99, audioContext.currentTime); // G5
    oscillator1.type = 'sine';
    oscillator2.type = 'sine';

    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.05);
    gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.2);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.4);

    const startTime = audioContext.currentTime;
    oscillator1.start(startTime);
    oscillator2.start(startTime);
    oscillator1.stop(startTime + 0.4);
    oscillator2.stop(startTime + 0.4);
  } catch (error) {
    console.warn('Could not play completion sound:', error);
    try {
      const audio = new window.Audio(
        'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmUhCjuZz/LNeSMFLrHa7eGWQQsVX7Tp65VFEAg+s+ruy2Q9Cz8h'
      );
      audio.volume = 0.1;
      audio.play().catch(() => {});
    } catch {
      // Silent fail
    }
  }
}

// ─── Exports (global scope for content script) ───────────────────────────────

// eslint-disable-next-line no-unused-vars
const Animation = {
  getAdjustedTiming,
  delay,
  injectSpeedAdjustedCSS,
  showTranslationProgress,
  updateTranslationProgress,
  hideTranslationProgress,
  animateBlockStart,
  animateBlockError,
  animateTranslation,
  animateLineTransition,
  addGlobalToggleButton,
  playCompletionSound,
};
