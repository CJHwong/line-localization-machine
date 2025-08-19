// Centralized debug configuration for Line Localization Machine
// Set DEBUG to true to enable verbose logging across all components

const DEBUG = false; // Toggle this to enable/disable debug logging

// Debug utility functions
const DebugLogger = {
  log: (...args) => {
    if (DEBUG) {
      console.log('[LLM Debug]', ...args);
    }
  },

  warn: (...args) => {
    if (DEBUG) {
      console.warn('[LLM Debug]', ...args);
    }
  },

  error: (...args) => {
    // Always show errors regardless of debug flag
    console.error('[LLM Error]', ...args);
  },

  info: (...args) => {
    if (DEBUG) {
      console.info('[LLM Info]', ...args);
    }
  },

  isEnabled: () => DEBUG,
};

// Export for both ES6 modules and CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEBUG, DebugLogger };
} else if (typeof window !== 'undefined') {
  window.LLMDebug = { DEBUG, DebugLogger };
}

export { DEBUG, DebugLogger };
export default { DEBUG, DebugLogger };
