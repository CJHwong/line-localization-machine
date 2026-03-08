/**
 * Translation state management for Line Localization Machine.
 *
 * Manages per-tab translation state: CRUD operations, periodic cleanup,
 * stale state detection, and Firefox-specific event handling.
 */

// ─── State Invalidation ──────────────────────────────────────────────────────

/**
 * Determine if a tab update event should clear the translation state.
 * Firefox sends different update signals than Chrome, requiring broader checks.
 */
export function shouldClearTranslationState(changeInfo, isFirefox) {
  // Chrome: clear on navigation (loading + url change)
  if (changeInfo.status === 'loading' && changeInfo.url) {
    return true;
  }

  if (isFirefox) {
    if (changeInfo.status === 'loading' || (changeInfo.status === 'complete' && changeInfo.url)) {
      return true;
    }
    if (changeInfo.url && !changeInfo.status) {
      return true;
    }
    if (changeInfo.title && changeInfo.url) {
      return true;
    }
  }

  return false;
}

// ─── Firefox-Specific Listeners ──────────────────────────────────────────────

/**
 * Add Firefox-specific event listeners for better state cleanup.
 * Firefox doesn't always fire tab update events reliably, so we validate
 * state on tab activation and window focus changes.
 */
export function addFirefoxSpecificListeners(translationStates, debug) {
  chrome.tabs.onActivated.addListener(async activeInfo => {
    const { tabId } = activeInfo;

    if (translationStates.has(tabId)) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const storedState = translationStates.get(tabId);

        if (storedState.url && storedState.url !== tab.url) {
          if (debug) {
            console.log(`[Firefox] Tab ${tabId} activation: URL changed, clearing state`);
          }
          translationStates.delete(tabId);
        }
      } catch (error) {
        if (debug) {
          console.log(`[Firefox] Tab ${tabId} activation: Tab not found, clearing state`);
        }
        translationStates.delete(tabId);
      }
    }
  });

  chrome.windows.onFocusChanged.addListener(async windowId => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;

    try {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      if (tabs.length > 0) {
        const tab = tabs[0];
        if (translationStates.has(tab.id)) {
          const storedState = translationStates.get(tab.id);

          if (storedState.url && storedState.url !== tab.url) {
            if (debug) {
              console.log(`[Firefox] Window focus: Tab ${tab.id} URL changed, clearing state`);
            }
            translationStates.delete(tab.id);
          }
        }
      }
    } catch (error) {
      console.warn('[Firefox] Error during window focus state check:', error);
    }
  });
}

// ─── Periodic Cleanup ─────────────────────────────────────────────────────────

export function startPeriodicCleanup(translationStates, debug) {
  setInterval(
    async () => {
      try {
        await performPeriodicCleanup(translationStates, debug);
      } catch (error) {
        console.warn('Periodic cleanup failed:', error);
      }
    },
    2 * 60 * 1000
  );
}

async function performPeriodicCleanup(translationStates, debug) {
  const maxAge = 10 * 60 * 1000;
  const now = Date.now();
  const staleTabIds = [];

  for (const [tabId, state] of translationStates.entries()) {
    try {
      if (state.timestamp && now - state.timestamp > maxAge) {
        staleTabIds.push(tabId);
        continue;
      }

      try {
        await chrome.tabs.get(tabId);
      } catch (tabError) {
        staleTabIds.push(tabId);
      }
    } catch (error) {
      console.warn(`Error during cleanup check for tab ${tabId}:`, error);
      staleTabIds.push(tabId);
    }
  }

  if (staleTabIds.length > 0) {
    if (debug) {
      console.log(`Periodic cleanup: removing ${staleTabIds.length} stale translation states`);
    }
    staleTabIds.forEach(tabId => translationStates.delete(tabId));
  }
}

// ─── State CRUD ───────────────────────────────────────────────────────────────

export async function updateTranslationState(translationStates, tabId, state, debug, debugLogger) {
  if (!tabId) {
    console.warn('No tabId provided for updateTranslationState');
    return { success: false, error: 'Tab ID required' };
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    const enhancedState = {
      ...state,
      url: tab.url,
      timestamp: Date.now(),
    };

    translationStates.set(tabId, enhancedState);

    if (debug) {
      console.log(`[TabID Debug] Storing translation state for tab ${tabId}:`, {
        isTranslating: state.isTranslating,
        status: state.status,
        progress: state.progress,
        completed: state.completedBlocks,
        total: state.totalBlocks,
        url: tab.url,
        timestamp: enhancedState.timestamp,
        allStoredTabIds: Array.from(translationStates.keys()),
        totalStates: translationStates.size,
      });
    }

    if (debugLogger?.isEnabled()) {
      debugLogger.log(`\u2713 Updated translation state for tab ${tabId}:`, {
        isTranslating: state.isTranslating,
        status: state.status,
        progress: state.progress,
        completed: state.completedBlocks,
        total: state.totalBlocks,
        url: tab.url,
      });
      debugLogger.log('All translation states:', Array.from(translationStates.entries()));
    }

    return { success: true };
  } catch (error) {
    console.warn(`Failed to get tab ${tabId} for state update:`, error);
    const enhancedState = { ...state, timestamp: Date.now() };
    translationStates.set(tabId, enhancedState);
    return { success: true };
  }
}

export async function getTranslationState(translationStates, tabId, debug, debugLogger) {
  if (!tabId) {
    console.warn('No tabId provided for getTranslationState');
    return null;
  }

  const storedState = translationStates.get(tabId);
  if (!storedState) return null;

  const maxAge = 10 * 60 * 1000;
  if (storedState.timestamp && Date.now() - storedState.timestamp > maxAge) {
    console.log(`Clearing expired translation state for tab ${tabId}`);
    translationStates.delete(tabId);
    return null;
  }

  try {
    const currentTab = await chrome.tabs.get(tabId);

    if (storedState.url && currentTab.url !== storedState.url) {
      console.log(
        `URL changed for tab ${tabId}: ${storedState.url} \u2192 ${currentTab.url}, clearing state`
      );
      translationStates.delete(tabId);
      return null;
    }

    if (debugLogger?.isEnabled()) {
      debugLogger.log(`\uD83D\uDD0D Getting translation state for tab ${tabId}:`, storedState);
      debugLogger.log('Available states:', Array.from(translationStates.keys()));
    }

    return storedState;
  } catch (error) {
    console.warn(`Failed to validate tab ${tabId} state:`, error);
    translationStates.delete(tabId);
    return null;
  }
}

export function clearTranslationState(translationStates, tabId, debug) {
  if (!tabId) {
    console.warn('No tabId provided for clearTranslationState');
    return { success: false, error: 'Tab ID required' };
  }

  if (debug) {
    const stateDetails = translationStates.get(tabId);
    console.log(`[TabID Debug] Clearing translation state for tab ${tabId}:`, {
      hadState: !!stateDetails,
      stateDetails: stateDetails
        ? {
            isTranslating: stateDetails.isTranslating,
            status: stateDetails.status,
            url: stateDetails.url,
            timestamp: stateDetails.timestamp,
          }
        : null,
      allStoredTabIds: Array.from(translationStates.keys()),
      totalStates: translationStates.size,
    });
  }

  translationStates.delete(tabId);
  return { success: true };
}
