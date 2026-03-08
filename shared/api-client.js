import { parse as jsonriverParse } from '../vendor/jsonriver.js';

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

      // Safe content extraction — some models (DeepSeek, QwQ) put output in
      // reasoning/reasoning_content instead of content
      const message = data.choices[0].message;
      const messageContent =
        message.content || message.reasoning || message.reasoning_content || '';
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

  // ─── Streaming Methods ───────────────────────────────────────────────────────

  /**
   * Async generator that streams chat completion deltas via SSE.
   * Yields content strings as they arrive from the API.
   *
   * @param {Object} config - API configuration (apiKey, apiEndpoint, model)
   * @param {Array} messages - Messages array
   * @param {Object} options - temperature, maxTokens, reasoningEffort
   * @param {Function} [onReasoning] - Called with {chars, elapsed} during reasoning phase
   * @yields {string} Content delta strings
   */
  static async *streamChatCompletion(config, messages, options = {}, onReasoning) {
    const { temperature = 0.3, maxTokens = 2000, reasoningEffort = 'off', signal } = options;

    if (!config.apiKey) throw new Error('API key is required');
    if (!config.apiEndpoint) throw new Error('API endpoint is required');
    if (!config.model) throw new Error('Model is required');
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages array is required and must not be empty');
    }

    const requestBody = {
      model: config.model,
      messages,
      temperature,
      max_completion_tokens: maxTokens,
      stream: true,
    };

    if (reasoningEffort && reasoningEffort !== 'off') {
      requestBody.reasoning_effort = reasoningEffort;
    }

    console.log(
      `[APIClient] stream request: model=${config.model}, ` +
        `reasoning_effort=${reasoningEffort}, temp=${temperature}, maxTokens=${maxTokens}`
    );

    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    };
    if (signal) fetchOptions.signal = signal;

    const response = await fetch(
      this.joinUrl(config.apiEndpoint, 'chat/completions'),
      fetchOptions
    );

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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reasoningChars = 0;
    let contentChars = 0;
    let firstContentTime = 0;
    const streamStartTime = Date.now();

    // Processes complete SSE lines, yielding content deltas
    const processLines = function* (lines) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') return;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const payload = JSON.parse(trimmed.slice(6));
          const delta = payload.choices?.[0]?.delta;
          if (!delta) continue;

          // Track reasoning tokens (not yielded — would corrupt JSON parser)
          if (delta.reasoning_content || delta.reasoning) {
            const text = delta.reasoning_content || delta.reasoning;
            reasoningChars += text.length;
            if (onReasoning) {
              onReasoning({
                chars: reasoningChars,
                elapsed: Date.now() - streamStartTime,
                text,
              });
            }
          }

          // Only yield actual content deltas
          if (delta.content) {
            if (!firstContentTime) {
              firstContentTime = Date.now();
              console.log(
                `[APIClient] first content after ${firstContentTime - streamStartTime}ms ` +
                  `(${reasoningChars} reasoning chars skipped)`
              );
            }
            contentChars += delta.content.length;
            yield delta.content;
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        yield* processLines(lines);
      }

      // Flush decoder and process any remaining buffered content
      buffer += decoder.decode();
      if (buffer.trim()) {
        yield* processLines(buffer.split('\n'));
      }
    } finally {
      reader.releaseLock();
      const elapsed = Date.now() - streamStartTime;
      console.log(
        `[APIClient] stream done in ${elapsed}ms: ` +
          `${contentChars} content chars, ${reasoningChars} reasoning chars skipped`
      );
    }
  }

  /**
   * Stream a translation request, calling onBlock as each block completes.
   *
   * Uses jsonriver to progressively parse the JSON response. When a complete
   * block object appears at path ['blocks', N], fires onBlock(index, block).
   *
   * @param {Object} config - API configuration
   * @param {Object} translationData - { targetLanguage, blocks: [{id, items}] }
   * @param {Object} options - temperature, maxTokens, reasoningEffort
   * @param {Function} onBlock - Called with (blockIndex, blockObject) as each block completes
   * @param {Function} [onReasoning] - Called with {chars, elapsed} during reasoning phase
   * @returns {Promise<Object>} { success, usage, model }
   */
  static async streamTranslate(config, translationData, options = {}, onBlock, onReasoning) {
    if (!translationData || !translationData.blocks || !Array.isArray(translationData.blocks)) {
      return {
        success: false,
        error: 'Invalid translation data: missing blocks array',
        errorType: 'client_error',
        isRetryable: false,
      };
    }

    const { targetLanguage, blocks } = translationData;

    const systemPrompt = `You are a native ${targetLanguage} speaker and professional translator. Your goal is to accurately convey the meaning and nuances of the original text while adhering to ${targetLanguage} grammar, vocabulary, and cultural sensitivities. The result should read as if originally written in ${targetLanguage}.

OUTPUT FORMAT: Valid JSON only. No markdown, no explanation, no code blocks.

RULES:
1. Output ONLY valid JSON - no \`\`\` markers, no extra text
2. Keep exact structure: same block count, same item count per block, same segment count per item
3. Each item is an array of text segments from one paragraph — they form a continuous sentence. Translate idiomatically but return the exact same number of segments per item
4. Keep numbers, URLs, brand names unchanged
5. ESCAPE all double quotes inside translated strings with backslash: use \\" not ". For example: "他說\\"你好\\"" NOT "他說"你好""

STRUCTURE:
Input:  {"blocks":[{"id":0,"items":[["text1"],["text2","text3"]]},{"id":1,"items":[["text4"]]}]}
Output: {"blocks":[{"id":0,"items":[["譯文1"],["譯文2","譯文3"]]},{"id":1,"items":[["譯文4"]]}]}

EXAMPLE:
Input:  {"blocks":[{"id":0,"items":[["Click ","here"," to continue"],["Hello world"]]}]}
Output: {"blocks":[{"id":0,"items":[["點擊","這裡","繼續"],["你好世界"]]}]}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ blocks }) },
    ];

    try {
      // Create an async iterable that yields content deltas from SSE
      const rawDeltaStream = this.streamChatCompletion(
        config,
        messages,
        {
          temperature: options.temperature !== undefined ? options.temperature : 0.3,
          maxTokens: options.maxTokens || 16000,
          reasoningEffort: options.reasoningEffort || 'off',
          signal: options.signal,
        },
        onReasoning
      );

      // Wrap the delta stream to isolate the JSON object.
      // Some models wrap output in ```json fences or add preamble text.
      // We skip everything before the first '{' and stop after the
      // matching '}' so jsonriver only sees valid JSON.
      const deltaStream = this.repairQuotes(this.isolateJSON(rawDeltaStream));

      // Track which blocks have been delivered to avoid duplicates
      const deliveredBlocks = new Set();

      const completeCallback = (value, pathInfo) => {
        const segments = pathInfo.segments();
        if (
          segments.length === 2 &&
          segments[0] === 'blocks' &&
          typeof segments[1] === 'number' &&
          typeof value === 'object' &&
          value !== null &&
          value.id !== undefined &&
          Array.isArray(value.items)
        ) {
          const blockIndex = segments[1];
          if (!deliveredBlocks.has(blockIndex)) {
            deliveredBlocks.add(blockIndex);
            console.log(
              `[APIClient] block ${blockIndex}/${blocks.length} parsed ` +
                `(${value.items.length} items)`
            );
            onBlock(blockIndex, value);
          }
        }
      };

      // Drain the async iterator — jsonriver does the heavy lifting.
      // jsonriver may throw "Unexpected end of content" when the SSE stream
      // closes (generator returns on [DONE]) while the tokenizer still has
      // moreContentExpected=true. This is harmless if blocks were delivered.
      try {
        for await (const _partial of jsonriverParse(deltaStream, { completeCallback })) {
          // Each yield is a progressively-complete snapshot; we only care
          // about the completeCallback firing for individual blocks.
        }
      } catch (parseError) {
        if (deliveredBlocks.size > 0) {
          // Blocks were already delivered via completeCallback — the parse
          // error is just jsonriver upset about the stream closing mid-token.
          // Log it and move on.
          console.warn(
            `[APIClient] jsonriver parse ended with ${deliveredBlocks.size}/${blocks.length} blocks delivered:`,
            parseError.message
          );
        } else {
          // No blocks delivered at all — this is a real failure
          throw parseError;
        }
      }

      console.log(
        `[APIClient] streamTranslate: ${deliveredBlocks.size}/${blocks.length} blocks delivered`
      );
      return { success: true };
    } catch (error) {
      // Abort is expected when the user navigates away — not an error
      if (error.name === 'AbortError') {
        console.log('[APIClient] stream aborted (page closed/refreshed)');
        return { success: false, error: 'aborted', errorType: 'aborted', isRetryable: false };
      }

      console.error('[APIClient] streamTranslate error:', error.message);

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
   * Wraps an async iterable of string chunks, yielding only the content
   * between the first '{' and its matching '}'. Strips markdown code fences,
   * preamble text, and trailing content that would choke a JSON parser.
   *
   * @param {AsyncIterable<string>} stream - Raw content delta stream
   * @yields {string} JSON-only content chunks
   */
  static async *isolateJSON(stream) {
    let depth = 0;
    let started = false;
    let inString = false;
    let escaped = false;

    for await (const chunk of stream) {
      if (!started) {
        // Scan for the first '{' — skip preamble/code fences
        const openIdx = chunk.indexOf('{');
        if (openIdx === -1) continue; // still in preamble
        started = true;
        // Walk from '{' onward, counting braces (skip string interiors)
        let cutoff = -1;
        for (let i = openIdx; i < chunk.length; i++) {
          const ch = chunk[i];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === '\\' && inString) {
            escaped = true;
            continue;
          }
          if (ch === '"') {
            inString = !inString;
            continue;
          }
          if (inString) continue;
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth <= 0) {
              cutoff = i + 1;
              break;
            }
          }
        }
        if (cutoff !== -1) {
          yield chunk.slice(openIdx, cutoff);
          return;
        }
        yield chunk.slice(openIdx);
        continue;
      }

      // Already inside the JSON object — check if this chunk closes it
      let cutoff = -1;
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\' && inString) {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth <= 0) {
            cutoff = i + 1;
            break;
          }
        }
      }

      if (cutoff !== -1) {
        // Top-level object closes mid-chunk — yield up to the closing '}'
        yield chunk.slice(0, cutoff);
        return;
      }

      yield chunk;
    }
  }

  /**
   * Streaming quote repair for malformed JSON from LLMs.
   *
   * Many models output bare " inside translated strings (e.g. "他說"你好"")
   * which breaks JSON parsers. This generator escapes those bare quotes
   * by checking the character AFTER each " while in a string:
   *   - Structural char (,]}: or whitespace) → real closing quote
   *   - Anything else → bare quote, escape as \"
   *
   * Uses a 1-char lookahead buffer across chunk boundaries.
   *
   * @param {AsyncIterable<string>} stream - JSON content stream
   * @yields {string} Repaired JSON chunks
   */
  static async *repairQuotes(stream) {
    const STRUCTURAL = new Set([',', ']', '}', ':', ' ', '\t', '\n', '\r']);
    let inString = false;
    let escaped = false;
    let buffer = '';

    for await (const chunk of stream) {
      buffer += chunk;

      // Process all but last char — need 1-char lookahead for quote detection
      let output = '';
      let i = 0;
      while (i < buffer.length - 1) {
        const ch = buffer[i];
        const next = buffer[i + 1];

        if (escaped) {
          output += ch;
          escaped = false;
          i++;
          continue;
        }

        if (ch === '\\' && inString) {
          output += ch;
          escaped = true;
          i++;
          continue;
        }

        if (ch === '"') {
          if (!inString) {
            inString = true;
            output += ch;
          } else if (STRUCTURAL.has(next)) {
            // Next char is structural — this is a real closing quote
            inString = false;
            output += ch;
          } else {
            // Bare quote inside string — escape it
            output += '\\"';
          }
          i++;
          continue;
        }

        output += ch;
        i++;
      }

      if (output) yield output;
      buffer = buffer.slice(i);
    }

    // Flush remaining buffer (last char)
    if (buffer) yield buffer;
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
