const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let requestCount = 0;
let shouldError = false;
let errorType = null;
let delay = 0;

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
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
          },
        });
      case '500':
        return res.status(500).json({
          error: {
            message: 'Internal server error',
            type: 'server_error',
          },
        });
      case '401':
        return res.status(401).json({
          error: {
            message: 'Invalid API key',
            type: 'authentication_error',
          },
        });
      default:
        return res.status(500).json({
          error: {
            message: 'Unknown error',
            type: 'unknown_error',
          },
        });
    }
  }

  const { messages, model } = req.body;

  // Extract text to translate from the last user message
  const userMessage = messages.find(m => m.role === 'user');
  if (!userMessage) {
    return res.status(400).json({
      error: {
        message: 'No user message found',
        type: 'invalid_request',
      },
    });
  }

  // Simple mock translation (reverse the text for testing)
  const textToTranslate = userMessage.content;
  const mockTranslation = textToTranslate
    .split('\n')
    .map(line => {
      // Reverse each line character by character
      return line.split('').reverse().join('');
    })
    .join('\n');

  res.json({
    id: `mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'gpt-4',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: mockTranslation,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: textToTranslate.length,
      completion_tokens: mockTranslation.length,
      total_tokens: textToTranslate.length + mockTranslation.length,
    },
  });
});

// Control endpoints for testing
app.post('/test/reset', (req, res) => {
  requestCount = 0;
  shouldError = false;
  errorType = null;
  delay = 0;
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

app.get('/test/stats', (req, res) => {
  res.json({
    requestCount,
    shouldError,
    errorType,
    delay,
  });
});

app.listen(PORT, () => {
  console.log(`Mock API server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST /v1/chat/completions - Mock translation API');
  console.log('  POST /test/reset - Reset server state');
  console.log('  POST /test/error - Set error mode (body: {type: "429"|"500"|"401"})');
  console.log('  POST /test/delay - Set response delay (body: {ms: number})');
  console.log('  GET /test/stats - Get server stats');
});
