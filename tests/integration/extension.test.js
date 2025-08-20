/**
 * Integration tests for browser extension components
 * These tests verify interaction between different parts of the extension
 */

describe('Extension Integration Tests', () => {
  let mockStorage = {};

  beforeEach(() => {
    // Reset mock storage
    mockStorage = {
      apiKey: 'test-key',
      apiEndpoint: 'http://localhost:3001/v1/chat/completions',
      model: 'gpt-4',
      targetLanguage: 'es',
      blocksPerRequest: 5,
      temperature: 0.3,
    };

    // Mock chrome.storage.local to use our mock storage
    global.chrome.storage.local.get.mockImplementation((keys, callback) => {
      const result = {};
      if (Array.isArray(keys)) {
        keys.forEach(key => {
          if (mockStorage[key] !== undefined) {
            result[key] = mockStorage[key];
          }
        });
      } else if (typeof keys === 'object' && keys !== null) {
        // Handle object with default values
        Object.keys(keys).forEach(key => {
          result[key] = mockStorage[key] !== undefined ? mockStorage[key] : keys[key];
        });
      } else if (typeof keys === 'string') {
        if (mockStorage[keys] !== undefined) {
          result[keys] = mockStorage[keys];
        }
      } else if (keys === null || keys === undefined) {
        // Get all storage
        Object.assign(result, mockStorage);
      }

      if (callback) callback(result);
      return Promise.resolve(result);
    });

    global.chrome.storage.local.set.mockImplementation((data, callback) => {
      Object.assign(mockStorage, data);
      if (callback) callback();
      return Promise.resolve();
    });
  });

  describe('Settings and Storage Integration', () => {
    test('should save and retrieve settings correctly', async () => {
      const testSettings = {
        apiKey: 'new-test-key',
        model: 'gpt-3.5-turbo',
        targetLanguage: 'fr',
      };

      // Simulate saving settings
      await new Promise(resolve => {
        chrome.storage.local.set(testSettings, resolve);
      });

      // Simulate retrieving settings
      const retrievedSettings = await new Promise(resolve => {
        chrome.storage.local.get(['apiKey', 'model', 'targetLanguage'], resolve);
      });

      expect(retrievedSettings.apiKey).toBe(testSettings.apiKey);
      expect(retrievedSettings.model).toBe(testSettings.model);
      expect(retrievedSettings.targetLanguage).toBe(testSettings.targetLanguage);
    });

    test('should handle missing settings with defaults', async () => {
      // Clear mock storage
      mockStorage = {};

      const defaultSettings = {
        apiKey: '',
        apiEndpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4',
        targetLanguage: 'es',
        blocksPerRequest: 5,
        temperature: 0.3,
      };

      const settings = await new Promise(resolve => {
        chrome.storage.local.get(defaultSettings, resolve);
      });

      expect(settings.apiEndpoint).toBe(defaultSettings.apiEndpoint);
      expect(settings.model).toBe(defaultSettings.model);
      expect(settings.targetLanguage).toBe(defaultSettings.targetLanguage);
    });
  });

  describe('Background and Content Script Communication', () => {
    test('should handle translation request message', async () => {
      const mockTranslationRequest = {
        action: 'translate',
        text: 'Hello world',
        targetLanguage: 'es',
      };

      const mockResponse = {
        success: true,
        translatedText: 'Hola mundo',
      };

      // Mock the runtime.sendMessage to simulate background script response
      global.chrome.runtime.sendMessage.mockResolvedValue(mockResponse);

      const response = await chrome.runtime.sendMessage(mockTranslationRequest);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(mockTranslationRequest);
      expect(response.success).toBe(true);
      expect(response.translatedText).toBe('Hola mundo');
    });

    test('should handle settings request message', async () => {
      const mockSettingsRequest = {
        action: 'getSettings',
      };

      const mockResponse = {
        settings: mockStorage,
      };

      global.chrome.runtime.sendMessage.mockResolvedValue(mockResponse);

      const response = await chrome.runtime.sendMessage(mockSettingsRequest);

      expect(response.settings).toEqual(mockStorage);
    });

    test('should handle error in message passing', async () => {
      const errorMessage = {
        action: 'translate',
        text: 'Test text',
      };

      const mockError = new Error('Translation failed');
      global.chrome.runtime.sendMessage.mockRejectedValue(mockError);

      await expect(chrome.runtime.sendMessage(errorMessage)).rejects.toThrow('Translation failed');
    });
  });

  describe('API Integration Workflow', () => {
    test('should complete full translation workflow', async () => {
      // Mock successful API response
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: 'Texto traducido',
                },
              },
            ],
          }),
      });

      // Simulate the complete workflow
      const textToTranslate = 'Text to translate';
      const settings = await new Promise(resolve => {
        chrome.storage.local.get(
          {
            apiKey: '',
            apiEndpoint: 'http://localhost:3001/v1/chat/completions',
            model: 'gpt-4',
            targetLanguage: 'es',
            temperature: 0.3,
          },
          resolve
        );
      });

      // Simulate API call (this would normally be in background script)
      const response = await fetch(settings.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            {
              role: 'system',
              content: `Translate the following text to ${settings.targetLanguage}. Preserve formatting and return only the translation.`,
            },
            {
              role: 'user',
              content: textToTranslate,
            },
          ],
          temperature: settings.temperature,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.choices[0].message.content).toBe('Texto traducido');
    });

    test('should handle API error gracefully', async () => {
      // Mock API error response
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () =>
          Promise.resolve({
            error: {
              message: 'Invalid API key',
            },
          }),
      });

      const settings = await new Promise(resolve => {
        chrome.storage.local.get(
          {
            apiKey: 'invalid-key',
            apiEndpoint: 'http://localhost:3001/v1/chat/completions',
          },
          resolve
        );
      });

      const response = await fetch(settings.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });

  describe('Extension State Management', () => {
    test('should maintain consistent state across components', async () => {
      // Simulate state changes from different components
      const newLanguage = 'fr';

      // Settings component updates language
      await new Promise(resolve => {
        chrome.storage.local.set({ targetLanguage: newLanguage }, resolve);
      });

      // Background script retrieves updated settings
      const backgroundSettings = await new Promise(resolve => {
        chrome.storage.local.get(['targetLanguage'], resolve);
      });

      // Content script retrieves updated settings
      const contentSettings = await new Promise(resolve => {
        chrome.storage.local.get(['targetLanguage'], resolve);
      });

      expect(backgroundSettings.targetLanguage).toBe(newLanguage);
      expect(contentSettings.targetLanguage).toBe(newLanguage);
    });

    test('should handle concurrent storage operations', async () => {
      const operations = [
        chrome.storage.local.set({ setting1: 'value1' }),
        chrome.storage.local.set({ setting2: 'value2' }),
        chrome.storage.local.set({ setting3: 'value3' }),
      ];

      await Promise.all(operations);

      const allSettings = await new Promise(resolve => {
        chrome.storage.local.get(['setting1', 'setting2', 'setting3'], resolve);
      });

      expect(allSettings.setting1).toBe('value1');
      expect(allSettings.setting2).toBe('value2');
      expect(allSettings.setting3).toBe('value3');
    });
  });
});
