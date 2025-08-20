// Global test setup
global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const mockData = {
          apiKey: 'test-api-key',
          apiEndpoint: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-4',
          targetLanguage: 'es',
          blocksPerRequest: 5,
          temperature: 0.3,
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
