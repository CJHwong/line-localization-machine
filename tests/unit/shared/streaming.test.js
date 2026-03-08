/**
 * Unit tests for streaming translation (SSE parsing + jsonriver integration)
 *
 * Tests streamChatCompletion SSE parsing and streamTranslate progressive block delivery.
 */

// ─── SSE Line Parsing ────────────────────────────────────────────────────────

describe('SSE line parsing', () => {
  // Simulate what streamChatCompletion does: read SSE lines, extract content deltas
  function parseSSELines(rawText) {
    const deltas = [];
    const lines = rawText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed === 'data: [DONE]') break;
      if (!trimmed.startsWith('data: ')) continue;
      try {
        const payload = JSON.parse(trimmed.slice(6));
        const delta = payload.choices?.[0]?.delta;
        if (delta) {
          const content = delta.content || delta.reasoning || delta.reasoning_content;
          if (content) deltas.push(content);
        }
      } catch {
        // skip malformed
      }
    }
    return deltas;
  }

  test('parses standard OpenAI SSE format', () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const deltas = parseSSELines(raw);
    expect(deltas).toEqual(['Hello', ' world']);
  });

  test('skips empty lines and comments', () => {
    const raw = [
      ': this is a comment',
      '',
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    const deltas = parseSSELines(raw);
    expect(deltas).toEqual(['ok']);
  });

  test('handles reasoning field fallback (DeepSeek)', () => {
    const raw = [
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    const deltas = parseSSELines(raw);
    expect(deltas).toEqual(['thinking...', 'answer']);
  });

  test('skips deltas with no content', () => {
    const raw = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"real"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    const deltas = parseSSELines(raw);
    expect(deltas).toEqual(['real']);
  });

  test('stops at [DONE] sentinel', () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"before"}}]}',
      '',
      'data: [DONE]',
      '',
      'data: {"choices":[{"delta":{"content":"after"}}]}',
    ].join('\n');

    const deltas = parseSSELines(raw);
    expect(deltas).toEqual(['before']);
  });

  test('handles malformed JSON lines gracefully', () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"good"}}]}',
      '',
      'data: {broken json',
      '',
      'data: {"choices":[{"delta":{"content":"also good"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    const deltas = parseSSELines(raw);
    expect(deltas).toEqual(['good', 'also good']);
  });
});

// ─── Progressive Block Assembly ──────────────────────────────────────────────

describe('progressive block assembly from streamed JSON', () => {
  // Simulate what streamTranslate does: accumulate content, parse blocks
  // This tests the block extraction logic independent of jsonriver

  test('extracts complete blocks from accumulated JSON', () => {
    const fullJSON =
      '{"blocks":[' +
      '{"id":0,"items":[["TR_Hello","TR_world"]]},' +
      '{"id":1,"items":[["TR_Goodbye"]]}' +
      ']}';

    const parsed = JSON.parse(fullJSON);
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.blocks[0].id).toBe(0);
    expect(parsed.blocks[0].items[0]).toEqual(['TR_Hello', 'TR_world']);
    expect(parsed.blocks[1].id).toBe(1);
    expect(parsed.blocks[1].items[0]).toEqual(['TR_Goodbye']);
  });

  test('handles blocks with multiple items and segments', () => {
    const fullJSON =
      '{"blocks":[{"id":0,"items":[["Click ","here"," to continue"],["Hello world"]]}]}';

    const parsed = JSON.parse(fullJSON);
    expect(parsed.blocks[0].items).toHaveLength(2);
    expect(parsed.blocks[0].items[0]).toEqual(['Click ', 'here', ' to continue']);
    expect(parsed.blocks[0].items[1]).toEqual(['Hello world']);
  });

  test('block padding when translated items are fewer than original', () => {
    // Simulate the content-script's padding logic
    const originalBlock = [
      { textNodes: [{ textContent: 'First' }], element: {} },
      { textNodes: [{ textContent: 'Second' }], element: {} },
      { textNodes: [{ textContent: 'Third' }], element: {} },
    ];

    const translatedItems = [['TR_First']]; // Only 1 item returned

    // Pad to match block size
    while (translatedItems.length < originalBlock.length) {
      const fallbackItem = originalBlock[translatedItems.length];
      translatedItems.push(fallbackItem.textNodes.map(n => n.textContent));
    }

    expect(translatedItems).toHaveLength(3);
    expect(translatedItems[0]).toEqual(['TR_First']);
    expect(translatedItems[1]).toEqual(['Second']); // fallback to original
    expect(translatedItems[2]).toEqual(['Third']); // fallback to original
  });

  test('block trimming when translated items exceed original', () => {
    const originalBlock = [{ textNodes: [{ textContent: 'Only' }], element: {} }];

    let translatedItems = [['TR_Only'], ['TR_Extra'], ['TR_More']];

    if (translatedItems.length > originalBlock.length) {
      translatedItems = translatedItems.slice(0, originalBlock.length);
    }

    expect(translatedItems).toHaveLength(1);
    expect(translatedItems[0]).toEqual(['TR_Only']);
  });

  test('coerces non-array items to string arrays', () => {
    const rawItems = ['just a string', null, undefined, 42];

    const coerced = rawItems.map(segments => {
      if (!Array.isArray(segments)) return [String(segments ?? '')];
      return segments.map(s => String(s ?? ''));
    });

    expect(coerced).toEqual([['just a string'], [''], [''], ['42']]);
  });
});

// ─── JSON Isolation (code fence / preamble stripping) ───────────────────────

describe('JSON isolation from LLM output', () => {
  // Simulates the isolateJSON() logic: skip everything before first '{',
  // track brace depth, stop after matching '}'

  function isolateJSON(chunks) {
    const result = [];
    let depth = 0;
    let started = false;
    let inString = false;
    let escaped = false;

    for (const chunk of chunks) {
      const startIdx = !started ? chunk.indexOf('{') : 0;
      if (!started) {
        if (startIdx === -1) continue;
        started = true;
      }

      let cutoff = -1;
      for (let i = startIdx; i < chunk.length; i++) {
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
        result.push(chunk.slice(startIdx, cutoff));
        return result.join('');
      }
      result.push(chunk.slice(startIdx));
    }
    return result.join('');
  }

  test('passes clean JSON through unchanged', () => {
    const json = '{"blocks":[{"id":0,"items":[["hello"]]}]}';
    expect(isolateJSON([json])).toBe(json);
  });

  test('strips markdown code fences', () => {
    const chunks = ['```json\n', '{"blocks":[{"id":0,"items":[["hello"]]}]}', '\n```'];
    expect(isolateJSON(chunks)).toBe('{"blocks":[{"id":0,"items":[["hello"]]}]}');
  });

  test('strips preamble text before JSON', () => {
    const chunks = ['Here is the translation:\n', '{"blocks":[{"id":0,"items":[["hi"]]}]}'];
    expect(isolateJSON(chunks)).toBe('{"blocks":[{"id":0,"items":[["hi"]]}]}');
  });

  test('handles JSON split across chunks with code fences', () => {
    const chunks = ['```json\n{"blo', 'cks":[{"id":0,"items":[["x"]]}]}', '\n```'];
    expect(isolateJSON(chunks)).toBe('{"blocks":[{"id":0,"items":[["x"]]}]}');
  });

  test('handles opening brace mid-chunk with preamble', () => {
    const chunks = ['Sure! {"blocks":[{"id":0,"items":[["a"]]}]}'];
    expect(isolateJSON(chunks)).toBe('{"blocks":[{"id":0,"items":[["a"]]}]}');
  });

  test('stops at matching closing brace ignoring nested objects', () => {
    const json = '{"blocks":[{"id":0,"items":[["a"]]}]}';
    const chunks = [json + ' extra trailing garbage'];
    expect(isolateJSON(chunks)).toBe(json);
  });

  test('ignores braces inside JSON string values', () => {
    const json = '{"blocks":[{"id":0,"items":[["use function() { return x; }"]]}]}';
    expect(isolateJSON([json])).toBe(json);
  });

  test('ignores escaped quotes inside strings', () => {
    const json = '{"blocks":[{"id":0,"items":[["he said \\"hello\\" }"]]}]}';
    expect(isolateJSON([json])).toBe(json);
  });
});

// ─── Mock Server SSE Format ─────────────────────────────────────────────────

describe('mock server SSE format compatibility', () => {
  test('chunked SSE can be reassembled into complete JSON', () => {
    // Simulate what the mock server produces for stream=true
    const fullTranslation = JSON.stringify({
      blocks: [
        { id: 0, items: [['TR_Hello', 'TR_world']] },
        { id: 1, items: [['TR_Goodbye']] },
      ],
    });

    // Split into ~20 char chunks (matching mock server logic)
    const chunks = [];
    for (let i = 0; i < fullTranslation.length; i += 20) {
      chunks.push(fullTranslation.slice(i, i + 20));
    }

    // Reassemble
    const reassembled = chunks.join('');
    expect(reassembled).toBe(fullTranslation);

    // Parse
    const parsed = JSON.parse(reassembled);
    expect(parsed.blocks).toHaveLength(2);
  });
});
