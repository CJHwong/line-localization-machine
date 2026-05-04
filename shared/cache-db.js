/**
 * IndexedDB cache for translation results.
 * Exposed as global `TranslationCache` (non-module, matches project pattern).
 */

// eslint-disable-next-line no-unused-vars
const TranslationCache = (() => {
  const DB_NAME = 'llm-translation-cache';
  const STORE_NAME = 'translations';
  const DB_VERSION = 1;

  let dbPromise = null;

  function initDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = event => resolve(event.target.result);
      request.onerror = event => reject(event.target.error);
    });

    return dbPromise;
  }

  async function get(cacheKey) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(cacheKey);

      request.onsuccess = () => {
        const record = request.result;
        if (!record) {
          resolve(null);
          return;
        }
        resolve({ blocks: record.blocks, totalBlocks: record.totalBlocks });
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function put(cacheKey, targetLanguage, blocks, totalBlocks) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = { cacheKey, targetLanguage, blocks, totalBlocks, createdAt: Date.now() };
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function remove(cacheKey) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(cacheKey);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  return { initDB, get, put, remove };
})();
