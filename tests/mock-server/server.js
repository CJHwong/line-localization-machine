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
// Translation mode: 'json' (understands JSON blocks), 'reverse' (legacy char reversal)
let translationMode = 'json';
// Marker behavior: 'preserve' (keep markers intact), 'drop' (remove markers),
// 'contaminate' (add fake markers to items that don't have them)
let markerBehavior = 'preserve';

/**
 * Mock-translate a single text item.
 * Prefixes each word with "TR_" while preserving [T:N]...[/T:N] and [O:N] markers.
 */
function mockTranslateItem(text) {
  if (typeof text !== 'string') return String(text);

  if (markerBehavior === 'drop') {
    // Strip all markers and translate
    const stripped = text
      .replace(/\[T:\d+\]/g, '')
      .replace(/\[\/T:\d+\]/g, '')
      .replace(/\[O:\d+\]/g, '');
    return prefixWords(stripped);
  }

  if (markerBehavior === 'contaminate') {
    // Add fake markers to simulate LLM cross-contamination
    const translated = translatePreservingMarkers(text);
    return `[T:99]${translated}[/T:99]`;
  }

  // Default: preserve markers, translate text between/around them
  return translatePreservingMarkers(text);
}

/**
 * Translate text while preserving marker positions.
 * Splits on markers, translates non-marker segments, reassembles.
 */
function translatePreservingMarkers(text) {
  // Match markers: [T:N], [/T:N], [O:N]
  const markerRegex = /(\[T:\d+\]|\[\/T:\d+\]|\[O:\d+\])/g;
  const parts = text.split(markerRegex);

  return parts
    .map(part => {
      // If it's a marker, keep as-is
      if (/^\[T:\d+\]$|^\[\/T:\d+\]$|^\[O:\d+\]$/.test(part)) {
        return part;
      }
      // Otherwise translate (prefix words)
      return prefixWords(part);
    })
    .join('');
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
    // Try to parse as JSON translation request (the new format)
    try {
      const input = JSON.parse(userMessage.content);
      if (input.blocks && Array.isArray(input.blocks)) {
        // Process each block and item
        const translatedBlocks = input.blocks.map(block => ({
          id: block.id,
          items: block.items.map(item => mockTranslateItem(item)),
        }));
        mockTranslation = JSON.stringify({ blocks: translatedBlocks });
      } else {
        // Not a blocks-format JSON, fall through to text mode
        mockTranslation = prefixWords(userMessage.content);
      }
    } catch {
      // Not JSON, use simple text translation
      mockTranslation = prefixWords(userMessage.content);
    }
  } else {
    // Legacy mode: reverse the text character by character
    mockTranslation = userMessage.content
      .split('\n')
      .map(line => line.split('').reverse().join(''))
      .join('\n');
  }

  console.log(
    `[Mock] Request #${requestCount} (mode=${translationMode}, markers=${markerBehavior})`
  );

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
  markerBehavior = 'preserve';
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
  const { mode, markers } = req.body;
  if (mode) translationMode = mode;
  if (markers) markerBehavior = markers;
  res.json({ message: `Mode: ${translationMode}, Markers: ${markerBehavior}` });
});

app.get('/test/stats', (req, res) => {
  res.json({
    requestCount,
    shouldError,
    errorType,
    delay,
    translationMode,
    markerBehavior,
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
  console.log('  POST /test/mode           - Set translation mode (body: {mode, markers})');
  console.log('    mode:    "json" (default) | "reverse" (legacy)');
  console.log('    markers: "preserve" (default) | "drop" | "contaminate"');
  console.log('  GET  /test/stats          - Get server stats');
});
