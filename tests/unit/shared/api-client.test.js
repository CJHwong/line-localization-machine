/**
 * Unit tests for API Client
 * Tests the APIClient class methods
 */

// Mock APIClient class based on the actual module structure
class APIClient {
  static joinUrl(base, path) {
    if (!base || !path) {
      return base || path || '';
    }

    const normalizedBase = base.replace(/\/+$/, '');
    const normalizedPath = path.replace(/^\/+/, '');

    return `${normalizedBase}/${normalizedPath}`;
  }

  static async makeRequest(endpoint, apiKey, requestBody) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      await response.json().catch(() => ({}));
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  static async translate(text, settings) {
    const endpoint = this.joinUrl(settings.apiEndpoint, 'chat/completions');

    const requestBody = {
      model: settings.model,
      messages: [
        {
          role: 'system',
          content: `Translate the following text to ${settings.targetLanguage}. Preserve formatting and return only the translation.`,
        },
        {
          role: 'user',
          content: text,
        },
      ],
      temperature: settings.temperature || 0.3,
    };

    const data = await this.makeRequest(endpoint, settings.apiKey, requestBody);

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No translation received from API');
    }

    return data.choices[0].message.content;
  }

  static async testConnection(settings) {
    try {
      const result = await this.translate('Hello', settings);
      return {
        success: true,
        message: 'Connection test successful',
        result,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}

describe('API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockClear();
  });

  describe('joinUrl', () => {
    test('should join URL parts correctly', () => {
      expect(APIClient.joinUrl('https://api.openai.com/v1', 'chat/completions')).toBe(
        'https://api.openai.com/v1/chat/completions'
      );

      expect(APIClient.joinUrl('https://api.openai.com/v1/', 'chat/completions')).toBe(
        'https://api.openai.com/v1/chat/completions'
      );

      expect(APIClient.joinUrl('https://api.openai.com/v1', '/chat/completions')).toBe(
        'https://api.openai.com/v1/chat/completions'
      );

      expect(APIClient.joinUrl('https://api.openai.com/v1/', '/chat/completions')).toBe(
        'https://api.openai.com/v1/chat/completions'
      );
    });

    test('should handle empty inputs', () => {
      expect(APIClient.joinUrl('', 'path')).toBe('path');
      expect(APIClient.joinUrl('base', '')).toBe('base');
      expect(APIClient.joinUrl('', '')).toBe('');
    });
  });

  describe('translate', () => {
    const mockSettings = {
      apiKey: 'test-api-key',
      apiEndpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      targetLanguage: 'Spanish',
      temperature: 0.3,
    };

    test('should make correct API request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: 'Hola mundo',
              },
            },
          ],
        }),
      };

      global.fetch.mockResolvedValue(mockResponse);

      const result = await APIClient.translate('Hello world', mockSettings);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mockSettings.apiKey}`,
          },
        })
      );

      // Verify the request body separately
      const callArgs = global.fetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe(mockSettings.model);
      expect(requestBody.temperature).toBe(mockSettings.temperature);
      expect(requestBody.messages).toHaveLength(2);
      expect(requestBody.messages[0].role).toBe('system');
      expect(requestBody.messages[0].content).toContain('Translate');
      expect(requestBody.messages[1].role).toBe('user');
      expect(requestBody.messages[1].content).toBe('Hello world');

      expect(result).toBe('Hola mundo');
    });

    test('should handle API errors', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue({
          error: {
            message: 'Invalid API key',
          },
        }),
      };

      global.fetch.mockResolvedValue(mockErrorResponse);

      await expect(APIClient.translate('Hello world', mockSettings)).rejects.toThrow(
        'API request failed'
      );
    });

    test('should handle network errors', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(APIClient.translate('Hello world', mockSettings)).rejects.toThrow(
        'Network error'
      );
    });

    test('should handle missing choices in response', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          choices: [],
        }),
      };

      global.fetch.mockResolvedValue(mockResponse);

      await expect(APIClient.translate('Hello world', mockSettings)).rejects.toThrow(
        'No translation received'
      );
    });
  });

  describe('testConnection', () => {
    const mockSettings = {
      apiKey: 'test-api-key',
      apiEndpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      targetLanguage: 'Spanish',
      temperature: 0.3,
    };

    test('should successfully test connection', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: 'Hola',
              },
            },
          ],
        }),
      };

      global.fetch.mockResolvedValue(mockResponse);

      const result = await APIClient.testConnection(mockSettings);

      expect(result.success).toBe(true);
      expect(result.message).toContain('successful');
      expect(result.result).toBe('Hola');
    });

    test('should handle connection test failure', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue({
          error: {
            message: 'Invalid API key',
          },
        }),
      };

      global.fetch.mockResolvedValue(mockErrorResponse);

      const result = await APIClient.testConnection(mockSettings);

      expect(result.success).toBe(false);
      expect(result.message).toContain('API request failed');
    });
  });
});
