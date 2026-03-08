const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let requestCount = 0;
let shouldError = false;
let errorType = null;
let delay = 0;
// Translation mode: 'json' (understands JSON blocks with segment arrays), 'reverse' (legacy)
let translationMode = 'json';

/**
 * Mock-translate a single text segment.
 * Prefixes each word with "TR_".
 */
function mockTranslateSegment(text) {
  if (typeof text !== 'string') return String(text);
  return text.replace(/\b([a-zA-Z]+)\b/g, 'TR_$1');
}

/**
 * Simple mock translation: prefix each word with "TR_"
 */
function prefixWords(text) {
  return text.replace(/\b([a-zA-Z]+)\b/g, 'TR_$1');
}

// Mock OpenAI-compatible API endpoint
app.post('/v1/chat/completions', async (req, res) => {
  requestCount++;

  // Add artificial delay if specified
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Handle error scenarios
  if (shouldError) {
    switch (errorType) {
      case '429':
        return res.status(429).json({
          error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
        });
      case '500':
        return res.status(500).json({
          error: { message: 'Internal server error', type: 'server_error' },
        });
      case '401':
        return res.status(401).json({
          error: { message: 'Invalid API key', type: 'authentication_error' },
        });
      default:
        return res.status(500).json({
          error: { message: 'Unknown error', type: 'unknown_error' },
        });
    }
  }

  const { messages, model } = req.body;

  // Extract text to translate from the last user message
  const userMessage = messages.find(m => m.role === 'user');
  if (!userMessage) {
    return res.status(400).json({
      error: { message: 'No user message found', type: 'invalid_request' },
    });
  }

  let mockTranslation;

  if (translationMode === 'json') {
    // Parse as JSON translation request with segment arrays
    try {
      const input = JSON.parse(userMessage.content);
      if (input.blocks && Array.isArray(input.blocks)) {
        // Process each block — items are arrays of segment arrays
        const translatedBlocks = input.blocks.map(block => ({
          id: block.id,
          items: block.items.map(item => {
            if (Array.isArray(item)) {
              // Segment array: translate each segment individually
              return item.map(segment => mockTranslateSegment(segment));
            }
            // Legacy flat string (shouldn't happen with new format, but handle gracefully)
            return [mockTranslateSegment(item)];
          }),
        }));
        mockTranslation = JSON.stringify({ blocks: translatedBlocks });
      } else {
        mockTranslation = prefixWords(userMessage.content);
      }
    } catch {
      mockTranslation = prefixWords(userMessage.content);
    }
  } else {
    // Legacy mode: reverse the text character by character
    mockTranslation = userMessage.content
      .split('\n')
      .map(line => line.split('').reverse().join(''))
      .join('\n');
  }

  console.log(`[Mock] Request #${requestCount} (mode=${translationMode})`);

  res.json({
    id: `mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'gpt-4',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: mockTranslation },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: userMessage.content.length,
      completion_tokens: mockTranslation.length,
      total_tokens: userMessage.content.length + mockTranslation.length,
    },
  });
});

// Control endpoints for testing
app.post('/test/reset', (req, res) => {
  requestCount = 0;
  shouldError = false;
  errorType = null;
  delay = 0;
  translationMode = 'json';
  res.json({ message: 'Mock server reset' });
});

app.post('/test/error', (req, res) => {
  const { type } = req.body;
  shouldError = true;
  errorType = type;
  res.json({ message: `Mock server will return ${type} errors` });
});

app.post('/test/delay', (req, res) => {
  const { ms } = req.body;
  delay = ms;
  res.json({ message: `Mock server will delay responses by ${ms}ms` });
});

app.post('/test/mode', (req, res) => {
  const { mode } = req.body;
  if (mode) translationMode = mode;
  res.json({ message: `Mode: ${translationMode}` });
});

app.get('/test/stats', (req, res) => {
  res.json({
    requestCount,
    shouldError,
    errorType,
    delay,
    translationMode,
  });
});

// Serve test pages for E2E tests (content scripts need HTTP, not file://)
app.use('/test-pages', express.static(path.join(__dirname, '../e2e')));

app.listen(PORT, () => {
  console.log(`Mock API server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST /v1/chat/completions - Mock translation API');
  console.log('  POST /test/reset          - Reset server state');
  console.log('  POST /test/error          - Set error mode (body: {type: "429"|"500"|"401"})');
  console.log('  POST /test/delay          - Set response delay (body: {ms: number})');
  console.log('  POST /test/mode           - Set translation mode (body: {mode})');
  console.log('    mode: "json" (default) | "reverse" (legacy)');
  console.log('  GET  /test/stats          - Get server stats');
});
