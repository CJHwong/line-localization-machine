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

    // Build system prompt optimized for JSON output with segment arrays
    const systemPrompt = `You are a professional translator. Translate the JSON input to ${targetLanguage}.

OUTPUT FORMAT: Valid JSON only. No markdown, no explanation, no code blocks.

CRITICAL RULES:
1. Output ONLY valid JSON - no \`\`\` markers, no extra text
2. Keep exact structure: same block count, same item count per block, same segment count per item
3. Each item is an array of text segments from one paragraph — they form a continuous sentence. Translate naturally but return the exact same number of segments per item
4. Keep numbers, URLs, brand names unchanged
5. Translate naturally for ${targetLanguage} speakers — not word-for-word
6. ESCAPE all double quotes inside translated strings with backslash: use \\" not ". For example: "他說\\"你好\\"" NOT "他說"你好""

STRUCTURE:
Input:  {"blocks":[{"id":0,"items":[["text1"],["text2","text3"]]},{"id":1,"items":[["text4"]]}]}
Output: {"blocks":[{"id":0,"items":[["譯文1"],["譯文2","譯文3"]]},{"id":1,"items":[["譯文4"]]}]}

EXAMPLE:
Input:  {"blocks":[{"id":0,"items":[["Click ","here"," to continue"],["Hello world"]]}]}
Output: {"blocks":[{"id":0,"items":[["點擊","這裡","繼續"],["你好世界"]]}]}

Match the tone and register of the original text.`;

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
        maxTokens: options.maxTokens || 8000,
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
    // Strip markdown code fences (handles truncated responses missing the closing fence)
    const stripped = content
      .trim()
      .replace(/^```(?:json)?\s*\n?/, '')
      .replace(/\n?```\s*$/, '');

    console.log(
      `[APIClient] parseJSONResponse: ${stripped.length} chars, expected ${expectedBlockCount} blocks`
    );

    // Try direct parse
    let firstParseError;
    try {
      const parsed = JSON.parse(stripped);
      if (parsed.blocks && Array.isArray(parsed.blocks)) {
        console.log(`[APIClient] Direct parse OK: ${parsed.blocks.length} blocks`);
        return parsed;
      }
      console.warn(`[APIClient] Parsed OK but no blocks array. Keys: ${Object.keys(parsed)}`);
    } catch (e) {
      firstParseError = e;
      console.warn(`[APIClient] Direct parse failed: ${e.message}`);
      // Log the end of the response to see if it's truncated
      console.log(
        `[APIClient] Response tail (last 200 chars): ${stripped.substring(stripped.length - 200)}`
      );
    }

    // Repair unescaped double quotes inside JSON string values.
    // LLMs translating to CJK languages often produce bare quotes like "命令" inside strings.
    // Strategy: walk the string character by character, tracking whether we're inside a JSON
    // string value. Any quote that isn't a structural delimiter gets escaped.
    const repaired = this.repairUnescapedQuotes(stripped);
    if (repaired !== stripped) {
      try {
        const parsed = JSON.parse(repaired);
        if (parsed.blocks && Array.isArray(parsed.blocks)) {
          console.log(`[APIClient] Quote-repair parse OK: ${parsed.blocks.length} blocks`);
          return parsed;
        }
      } catch (e) {
        console.warn(`[APIClient] Quote-repair parse failed: ${e.message}`);
      }
    }

    // Try to find a JSON object containing "blocks" in the response
    const jsonMatch = stripped.match(/\{[\s\S]*"blocks"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.blocks && Array.isArray(parsed.blocks)) {
          console.log(`[APIClient] Regex extraction OK: ${parsed.blocks.length} blocks`);
          return parsed;
        }
      } catch (e) {
        console.warn(`[APIClient] Regex extraction failed: ${e.message}`);
      }
    }

    // Truncation recovery: LLM hit max_tokens before finishing the JSON.
    // Try appending common closing sequences to salvage complete blocks.
    const closings = [']}]}', '"]}]}', '"]]}]}', '""]}]}', '"]]]}]}'];
    for (const closing of closings) {
      try {
        const repaired = stripped + closing;
        const parsed = JSON.parse(repaired);
        if (parsed.blocks && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
          // Drop the last block — it's likely the one that got cut off mid-item
          if (parsed.blocks.length > 1) {
            parsed.blocks.pop();
          }
          console.log(
            `[APIClient] Truncation recovery OK with "${closing}": ${parsed.blocks.length} blocks`
          );
          return parsed;
        }
      } catch (e) {
        // Try next closing
      }
    }

    const parseError = firstParseError ? firstParseError.message : 'unknown';
    throw new Error(
      `Failed to parse JSON response (${parseError}). ` +
        `Expected ${expectedBlockCount} blocks, response ${stripped.length} chars. ` +
        `Head: ${stripped.substring(0, 100)}... Tail: ${stripped.substring(stripped.length - 100)}`
    );
  }

  /**
   * Repair unescaped double quotes inside JSON string values.
   *
   * LLMs often embed bare " characters in translated text (e.g. Chinese quotation marks
   * like "命令"). This breaks JSON.parse. We walk the string tracking JSON structure
   * and escape any quote that appears mid-value (i.e. not a structural delimiter).
   *
   * @param {string} json - Raw JSON string that may contain unescaped quotes
   * @returns {string} Repaired JSON string
   */
  static repairUnescapedQuotes(json) {
    const result = [];
    let inString = false;
    let i = 0;

    while (i < json.length) {
      const ch = json[i];

      if (!inString) {
        result.push(ch);
        if (ch === '"') inString = true;
        i++;
        continue;
      }

      // Inside a string value
      if (ch === '\\') {
        // Escaped character — copy both the backslash and next char
        result.push(ch);
        if (i + 1 < json.length) {
          result.push(json[i + 1]);
          i += 2;
        } else {
          i++;
        }
        continue;
      }

      if (ch === '"') {
        // Is this the real closing quote, or a bare quote embedded in text?
        // Look ahead: after a closing string quote, JSON expects , ] } or :
        const after = json.substring(i + 1).match(/^\s*(.)/);
        const nextChar = after ? after[1] : '';

        if (nextChar === '' || ',]}: \n\r\t'.includes(nextChar)) {
          // Structural closing quote
          result.push(ch);
          inString = false;
        } else {
          // Bare quote inside string — escape it
          result.push('\\"');
        }
        i++;
        continue;
      }

      result.push(ch);
      i++;
    }

    return result.join('');
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
