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
    const { temperature = 0.3, maxTokens = 2000, timeout = 30000 } = options;

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
      reasoning_effort: 'low',
    };

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
   * @returns {Promise<Object>} Test result with success status and response
   */
  static async testConnection(config) {
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
        reasoning_effort: 'low',
        timeout: 15000, // Shorter timeout for connection test
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
   * Make a translation request
   * @param {Object} config - API configuration
   * @param {string} text - Text to translate
   * @param {string} targetLanguage - Target language for translation
   * @param {Object} options - Additional options
   * @param {Array} options.translationHistory - Previous translations for context
   * @returns {Promise<Object>} Translation result
   */
  static async translate(config, text, targetLanguage, options = {}) {
    const { translationHistory = [] } = options;
    // Detect if this is a batch translation with separators
    const hasBatchSeparators =
      text.includes('===BLOCK_SEPARATOR===') || text.includes('||ITEM_SEPARATOR||');

    let systemPrompt;
    if (hasBatchSeparators) {
      // Enhanced prompt for batch translation with separators
      systemPrompt = `# Role and Context
You are a professional website translator specializing in natural, culturally-appropriate localization. You're translating webpage content for real users browsing in their native language.

# Core Translation Principles
1. **Natural fluency**: Translate for meaning and readability, not word-for-word
2. **Cultural adaptation**: Use terminology and phrasing that feels native to ${targetLanguage} speakers
3. **Context preservation**: Maintain the original's tone, style, and intent
4. **User experience**: Ensure translations read as if originally written in ${targetLanguage}

# Technical Requirements (CRITICAL - Must Follow Exactly)

## Separators - NEVER modify these:
- \`===BLOCK_SEPARATOR===\` - Keep exactly as-is with same newlines
- \`||ITEM_SEPARATOR||\` - Keep exactly as-is with same newlines
- Count separators in input, ensure same count in output

## Link Placeholders - Translate content but preserve markers:
- Format: \`[LINK_1]clickable text[/LINK_1]\`
- PRESERVE: \`[LINK_1]\` and \`[/LINK_1]\` markers exactly
- TRANSLATE: The text between markers
- Example: \`[LINK_1]Click here[/LINK_1]\` → \`[LINK_1]點擊這裡[/LINK_1]\`

## Content Types - Handle appropriately:
- **Navigation/UI**: Use standard ${targetLanguage} interface terms
- **Articles/Blog posts**: Natural, flowing prose
- **Technical content**: Keep technical terms, add translations in parentheses if needed
- **Marketing content**: Adapt messaging for cultural appropriateness
- **Numbers/Dates/URLs**: Preserve exactly (don't localize formats)

# Quality Guidelines
- **Consistency**: Related blocks should use consistent terminology
- **Readability**: Prioritize clear, natural language over literal accuracy  
- **Completeness**: Translate ALL content, don't skip difficult phrases
- **Formatting**: Preserve HTML tags, punctuation, spacing exactly${
        translationHistory.length > 0
          ? `

# Context from Previous Translations
Use these for consistency:
${translationHistory
  .slice(-3)
  .map(h => `"${h.original}" → "${h.translated}"`)
  .join('\n')}`
          : ''
      }

# Output Rules
- Return ONLY the translated text
- NO explanations, comments, or meta-text
- Maintain exact same structure as input
- All separators and placeholders must be identical to input`;
    } else {
      // Standard prompt for simple translation
      systemPrompt = `# Role and Context
You are a professional website translator specializing in natural, culturally-appropriate localization. You're translating webpage content for real users browsing in their native language.

# Core Translation Principles
1. **Natural fluency**: Translate for meaning and readability, not word-for-word
2. **Cultural adaptation**: Use terminology and phrasing that feels native to ${targetLanguage} speakers
3. **Context preservation**: Maintain the original's tone, style, and intent
4. **User experience**: Ensure translations read as if originally written in ${targetLanguage}

# Content Guidelines
- **Navigation/UI elements**: Use standard ${targetLanguage} interface terminology
- **Articles/Blog posts**: Create natural, flowing prose that engages readers
- **Technical content**: Preserve technical terms, add clarification in parentheses if helpful
- **Marketing content**: Adapt messaging for cultural appropriateness and effectiveness
- **Proper nouns**: Keep brand names, preserve or adapt person/place names as appropriate
- **Numbers/Dates/Measurements**: Preserve exactly (don't change formats)
- **HTML/Formatting**: Maintain all tags, spacing, and structure precisely

# Quality Standards
- **Readability**: Prioritize clear, natural language over literal word-for-word translation
- **Completeness**: Translate ALL content, don't skip challenging phrases
- **Tone matching**: Professional content stays professional, casual stays casual${
        translationHistory.length > 0
          ? `

# Context from Previous Translations
Use these for consistent terminology:
${translationHistory
  .slice(-3)
  .map(h => `"${h.original}" → "${h.translated}"`)
  .join('\n')}`
          : ''
      }

# Output Rules
- Return ONLY the translated text
- NO explanations, comments, or meta-text
- Preserve exact formatting and structure`;
    }

    const messages = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];

    // Add recent translation history as conversation context (like original implementation)
    if (translationHistory.length > 0) {
      const recentHistory = translationHistory.slice(-2); // Last 2 translations for context
      for (const historyItem of recentHistory) {
        messages.push(
          { role: 'user', content: historyItem.original },
          { role: 'assistant', content: historyItem.translated }
        );
      }
    }

    // Add current text to translate
    messages.push({
      role: 'user',
      content: text,
    });

    try {
      const result = await this.chatCompletion(config, messages, {
        temperature: options.temperature !== undefined ? options.temperature : 0.3,
        maxTokens: options.maxTokens || 2000,
        timeout: options.timeout || 30000,
      });

      return {
        success: true,
        translatedText: result.content,
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
