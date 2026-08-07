// Global test setup

// Polyfill structuredClone for fake-indexeddb (Node < 17)
if (!global.structuredClone) {
  global.structuredClone = val => JSON.parse(JSON.stringify(val));
}

// Set up fake-indexeddb for tests (IndexedDB is not available in jsdom)
require('fake-indexeddb/auto');

global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const mockData = {
          apiKeys: {
            openai: 'test-api-key',
            google: '',
            ollama: '',
            custom: '',
          },
          provider: 'openai',
          apiEndpoint: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-5.6-luna',
          targetLanguage: 'es',
        };
        if (callback) callback(mockData);
        return Promise.resolve(mockData);
      }),
      set: jest.fn((data, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
      remove: jest.fn((keys, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve({ success: true })),
    connect: jest.fn(() => ({
      postMessage: jest.fn(),
      onMessage: { addListener: jest.fn() },
      onDisconnect: { addListener: jest.fn() },
      disconnect: jest.fn(),
    })),
    onMessage: {
      addListener: jest.fn(),
    },
    lastError: null,
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([{ id: 1, url: 'https://example.com' }])),
    sendMessage: jest.fn(() => Promise.resolve({ success: true })),
  },
  scripting: {
    executeScript: jest.fn(() => Promise.resolve([{ result: 'success' }])),
  },
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
  },
};

global.browser = global.chrome;

// Mock fetch for API calls
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [
          {
            message: {
              content: 'Translated text',
            },
          },
        ],
      }),
  })
);

// Mock DOM methods commonly used in content scripts
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    getPropertyValue: () => '',
    display: 'block',
    visibility: 'visible',
  }),
});

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
