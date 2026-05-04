/**
 * Unit tests for TranslationCache IndexedDB wrapper (shared/cache-db.js).
 *
 * IndexedDB is provided by fake-indexeddb loaded via tests/setup.js.
 */

const fs = require('fs');
const path = require('path');

// Load cache-db.js
const cacheSource = fs.readFileSync(path.resolve(__dirname, '../../../shared/cache-db.js'), 'utf8');
eval(cacheSource + '\nglobal.TranslationCache = TranslationCache;\n');

describe('TranslationCache', () => {
  afterEach(async () => {
    // Close open connection, delete the database, then re-create the wrapper.
    // Closing first is required by fake-indexeddb — deleteDatabase blocks
    // if any connection to the named database is still open.
    if (global.TranslationCache) {
      await TranslationCache.closeDB();
    }
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('llm-translation-cache');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    global.TranslationCache = null;
    eval(cacheSource + '\nglobal.TranslationCache = TranslationCache;\n');
  });

  test('get returns null for missing key', async () => {
    const result = await TranslationCache.get('nonexistent');
    expect(result).toBeNull();
  });

  test('put + get round-trips correctly', async () => {
    const cacheKey = 'abc123_zh-TW';
    const targetLanguage = 'zh-TW';
    const blocks = [
      { id: 0, items: [['譯文1'], ['譯文2']] },
      { id: 1, items: [['譯文3']] },
    ];
    const totalBlocks = 2;

    await TranslationCache.put(cacheKey, targetLanguage, blocks, totalBlocks);

    const result = await TranslationCache.get(cacheKey);
    expect(result).not.toBeNull();
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].id).toBe(0);
    expect(result.blocks[0].items[0][0]).toBe('譯文1');
    expect(result.totalBlocks).toBe(2);
  });

  test('remove deletes entry', async () => {
    const cacheKey = 'def456_es';
    await TranslationCache.put(cacheKey, 'es', [{ id: 0, items: [['hola']] }], 1);

    let result = await TranslationCache.get(cacheKey);
    expect(result).not.toBeNull();

    await TranslationCache.remove(cacheKey);

    result = await TranslationCache.get(cacheKey);
    expect(result).toBeNull();
  });

  test('different cache keys do not collide', async () => {
    await TranslationCache.put('key1_en', 'en', [{ id: 0, items: [['hello']] }], 1);
    await TranslationCache.put('key2_ja', 'ja', [{ id: 0, items: [['こんにちは']] }], 1);

    const en = await TranslationCache.get('key1_en');
    const ja = await TranslationCache.get('key2_ja');

    expect(en.blocks[0].items[0][0]).toBe('hello');
    expect(ja.blocks[0].items[0][0]).toBe('こんにちは');
  });

  test('put overwrites existing entry with same key', async () => {
    const cacheKey = 'hash_fr';
    await TranslationCache.put(cacheKey, 'fr', [{ id: 0, items: [['v1']] }], 1);
    await TranslationCache.put(cacheKey, 'fr', [{ id: 0, items: [['v2']] }], 1);

    const result = await TranslationCache.get(cacheKey);
    expect(result.blocks[0].items[0][0]).toBe('v2');
  });

  test('list returns empty array when no entries', async () => {
    const result = await TranslationCache.list();
    expect(result).toEqual([]);
  });

  test('list returns all entries sorted by createdAt desc', async () => {
    await TranslationCache.put('key1_en', 'en', [{ id: 0, items: [['hello']] }], 1);
    // Insert with a slight delay so createdAt timestamps differ
    await new Promise(r => setTimeout(r, 10));
    await TranslationCache.put('key2_ja', 'ja', [{ id: 0, items: [['konnichiwa']] }], 1);

    const result = await TranslationCache.list();
    expect(result).toHaveLength(2);
    expect(result[0].cacheKey).toBe('key2_ja');
    expect(result[1].cacheKey).toBe('key1_en');
  });

  test('put round-trips metadata', async () => {
    const cacheKey = 'hash_meta_zh-TW';
    const metadata = {
      url: 'https://example.com/article',
      title: 'Test Article',
      sourceText: 'Once upon a time...',
    };

    await TranslationCache.put(cacheKey, 'zh-TW', [{ id: 0, items: [['測試']] }], 1, metadata);

    const records = await TranslationCache.list();
    const record = records.find(r => r.cacheKey === cacheKey);
    expect(record).toBeDefined();
    expect(record.url).toBe('https://example.com/article');
    expect(record.title).toBe('Test Article');
    expect(record.sourceText).toBe('Once upon a time...');
  });
});
