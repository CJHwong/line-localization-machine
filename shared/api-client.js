/**
 * Centralized LLM API Client
 * Handles all requests to OpenAI-compatible API endpoints
 */
export default class APIClient {
  /**
   * Safely join URL parts, handling trailing/leading slashes
   * @param {string} base - Base URL
   * @param {string} path - Path to append
   * @returns {string} Properly joined URL
   *
   * Examples:
   * joinUrl('https://api.openai.com/v1', 'chat/completions') → 'https://api.openai.com/v1/chat/completions'
   * joinUrl('https://api.openai.com/v1/', 'chat/completions') → 'https://api.openai.com/v1/chat/completions'
   * joinUrl('https://api.openai.com/v1', '/chat/completions') → 'https://api.openai.com/v1/chat/completions'
   * joinUrl('https://api.openai.com/v1/', '/chat/completions') → 'https://api.openai.com/v1/chat/completions'
   */
  static joinUrl(base, path) {
    // Handle empty inputs
    if (!base || !path) {
      return base || path || '';
    }

    // Remove trailing slash from base and leading slash from path
    const cleanBase = base.replace(/\/+$/, '');
    const cleanPath = path.replace(/^\/+/, '');

    // Handle edge case where path might be empty after cleaning
    if (!cleanPath) {
      return cleanBase;
    }

    return `${cleanBase}/${cleanPath}`;
  }
  /**
   * Makes a chat completion request to the LLM API
   * @param {Object} config - API configuration
   * @param {string} config.apiKey - API key for authentication
   * @param {string} config.apiEndpoint - API endpoint URL
   * @param {string} config.model - Model to use
   * @param {Array} messages - Array of messages for the conversation
   * @param {Object} options - Additional options
   * @param {number} options.temperature - Sampling temperature (default: 0.3)
   * @param {number} options.maxTokens - Maximum completion tokens (default: 2000)
   * @param {number} options.timeout - Request timeout in ms (default: 30000)
   * @returns {Promise<Object>} API response with success/error status
   */
  static async chatCompletion(config, messages, options = {}) {
    const {
      temperature = 0.3,
      maxTokens = 2000,
      timeout = 30000,
      reasoningEffort = 'off',
    } = options;

    // Validate required config
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.apiEndpoint) {
      throw new Error('API endpoint is required');
    }
    if (!config.model) {
      throw new Error('Model is required');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages array is required and must not be empty');
    }

    const requestBody = {
      model: config.model,
      messages: messages,
      temperature: temperature,
      max_completion_tokens: maxTokens,
    };

    // Only add reasoning_effort if enabled (not 'off')
    if (reasoningEffort && reasoningEffort !== 'off') {
      requestBody.reasoning_effort = reasoningEffort;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(this.joinUrl(config.apiEndpoint, 'chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || response.statusText;

        const error = new Error(`API Error: ${response.status} - ${errorMessage}`);
        error.status = response.status;
        error.type = this.categorizeError(response.status);
        error.isRetryable = response.status >= 500 || response.status === 429;
        error.apiMessage = errorMessage;
        error.retryAfter = response.headers.get('retry-after');

        throw error;
      }

      const data = await response.json();

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid API response format');
      }

      // Safe content extraction
      const messageContent = data.choices?.[0]?.message?.content;
      const content = (typeof messageContent === 'string' ? messageContent : '').trim();

      return {
        success: true,
        content: content,
        usage: data.usage,
        model: data.model,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle fetch/network errors
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${timeout}ms`);
        timeoutError.type = 'timeout';
        timeoutError.isRetryable = true;
        throw timeoutError;
      }

      // Re-throw API errors as-is
      if (error.status) {
        throw error;
      }

      // Handle other network errors
      const errorMessage = error.message || error.toString() || 'Unknown network error';
      const networkError = new Error(`Network error: ${errorMessage}`);
      networkError.type = 'network';
      networkError.isRetryable = true;
      throw networkError;
    }
  }

  /**
   * Test API connection with a simple request
   * @param {Object} config - API configuration
   * @param {Object} options - Additional options
   * @param {string} options.reasoningEffort - Reasoning effort level (default: 'off')
   * @returns {Promise<Object>} Test result with success status and response
   */
  static async testConnection(config, options = {}) {
    try {
      const messages = [
        {
          role: 'user',
          content: 'Hello, please respond with just "OK" to test the connection.',
        },
      ];

      const result = await this.chatCompletion(config, messages, {
        maxTokens: 50,
        temperature: 1,
        timeout: 15000, // Shorter timeout for connection test
        reasoningEffort: options.reasoningEffort || 'off',
      });

      return {
        success: true,
        response: result.content,
        model: result.model,
        usage: result.usage,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorType: error.type || 'unknown',
        errorStatus: error.status,
        isRetryable: error.isRetryable || false,
        apiMessage: error.apiMessage,
        retryAfter: error.retryAfter,
      };
    }
  }

  /**
   * Make a JSON-based translation request
   * @param {Object} config - API configuration
   * @param {Object} translationData - Structured translation data
   * @param {string} translationData.targetLanguage - Target language for translation
   * @param {Array} translationData.blocks - Array of {id, items} objects
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Translation result with parsed blocks
   */
  static async translate(config, translationData, options = {}) {
    // Validate translationData structure
    if (!translationData || !translationData.blocks || !Array.isArray(translationData.blocks)) {
      return {
        success: false,
        error: 'Invalid translation data: missing blocks array',
        errorType: 'client_error',
        isRetryable: false,
      };
    }

    const { targetLanguage, blocks } = translationData;

    // Build system prompt optimized for JSON output
    const systemPrompt = `You are a professional translator. Translate the JSON input to ${targetLanguage}.

OUTPUT FORMAT: Valid JSON only. No markdown, no explanation, no code blocks.

CRITICAL RULES:
1. Output ONLY valid JSON - no \`\`\` markers, no extra text
2. Keep exact structure: same block count, same item count per block
3. Keep [LINK_N]...[/LINK_N] markers exactly, translate only text inside
4. Keep HTML tags, numbers, URLs, brand names unchanged
5. Translate naturally for ${targetLanguage} speakers

STRUCTURE:
Input:  {"blocks":[{"id":0,"items":["text1","text2"]},{"id":1,"items":["text3"]}]}
Output: {"blocks":[{"id":0,"items":["譯文1","譯文2"]},{"id":1,"items":["譯文3"]}]}

EXAMPLE:
Input:  {"blocks":[{"id":0,"items":["Hello world","Click [LINK_1]here[/LINK_1] to continue"]}]}
Output: {"blocks":[{"id":0,"items":["你好世界","點擊 [LINK_1]這裡[/LINK_1] 繼續"]}]}

Translate naturally - not word-for-word. Match the tone of the original.`;

    const messages = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: JSON.stringify({ blocks }),
      },
    ];

    try {
      const result = await this.chatCompletion(config, messages, {
        temperature: options.temperature !== undefined ? options.temperature : 0.3,
        maxTokens: options.maxTokens || 4000,
        timeout: options.timeout || 60000,
        reasoningEffort: options.reasoningEffort || 'off',
      });

      // Parse JSON response
      const parsedResponse = this.parseJSONResponse(result.content, blocks.length);

      return {
        success: true,
        blocks: parsedResponse.blocks,
        usage: result.usage,
        model: result.model,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorType: error.type || 'unknown',
        errorStatus: error.status,
        isRetryable: error.isRetryable || false,
        apiMessage: error.apiMessage,
        retryAfter: error.retryAfter,
      };
    }
  }

  /**
   * Parse JSON response from LLM, handling common formatting issues
   * @param {string} content - Raw response content
   * @param {number} expectedBlockCount - Expected number of blocks
   * @returns {Object} Parsed response with blocks array
   */
  static parseJSONResponse(content, expectedBlockCount) {
    const jsonStr = content.trim();

    // Try direct parse first
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.blocks && Array.isArray(parsed.blocks)) {
        return parsed;
      }
    } catch (e) {
      // Continue to fallback methods
    }

    // Try to extract JSON from markdown code block
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (parsed.blocks && Array.isArray(parsed.blocks)) {
          return parsed;
        }
      } catch (e) {
        // Continue to next fallback
      }
    }

    // Try to find JSON object in the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*"blocks"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.blocks && Array.isArray(parsed.blocks)) {
          return parsed;
        }
      } catch (e) {
        // Continue to error
      }
    }

    // If all parsing fails, throw error
    throw new Error(
      `Failed to parse JSON response. Expected ${expectedBlockCount} blocks. Raw response: ${jsonStr.substring(0, 200)}...`
    );
  }

  /**
   * Categorize HTTP error status codes
   * @param {number} status - HTTP status code
   * @returns {string} Error category
   */
  static categorizeError(status) {
    if (status === 401) return 'authentication';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limit';
    if (status >= 400 && status < 500) return 'client_error';
    if (status >= 500) return 'server_error';
    return 'unknown';
  }
}
