/**
 * Basic E2E smoke test for the extension.
 *
 * Verifies:
 * - Extension loads and service worker starts
 * - Content script injects on web pages
 * - Translation can be triggered and produces results
 *
 * Usage:
 *   # Terminal 1: start mock server
 *   npm run test:mock-server
 *
 *   # Terminal 2: run this test
 *   npm run test:e2e
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const TEST_PAGE_PATH = path.join(__dirname, 'test-inline-elements.html');
const MOCK_SERVER = 'http://localhost:3001';

async function run() {
  console.log('🚀 Setting up E2E tests...');

  // Check if test page exists
  if (!fs.existsSync(TEST_PAGE_PATH)) {
    throw new Error(`Test page not found: ${TEST_PAGE_PATH}`);
  }

  // Check mock server
  let mockAvailable = false;
  try {
    const res = await fetch(`${MOCK_SERVER}/test/stats`);
    mockAvailable = res.ok;
  } catch {
    // not available
  }
  console.log(`📡 Mock server: ${mockAvailable ? 'running' : 'not running'}`);

  // Launch browser with extension
  console.log(`📁 Loading extension from: ${EXTENSION_PATH}`);
  const tmpDir = path.join(os.tmpdir(), `llm-e2e-${Date.now()}`);
  const context = await chromium.launchPersistentContext(tmpDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    // Wait for service worker
    const sw =
      context.serviceWorkers().find(s => s.url().includes('background/background.js')) ||
      (await context.waitForEvent('serviceworker', {
        predicate: s => s.url().includes('background/background.js'),
        timeout: 15000,
      }));

    const extensionId = sw.url().split('/')[2];
    console.log(`✅ Extension loaded (ID: ${extensionId})`);

    if (!mockAvailable) {
      console.log('\n💡 Extension is ready. Start mock server for automated translation test.');
      console.log('   npm run test:mock-server');
      console.log('\n   Browser kept open for manual inspection. Close when done.');
      await new Promise(() => {}); // Block forever
    }

    // Reset mock server
    await fetch(`${MOCK_SERVER}/test/reset`, { method: 'POST' });
    await fetch(`${MOCK_SERVER}/test/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'json' }),
    });

    // Open test page via HTTP
    const page = await context.newPage();
    const testPageUrl = `${MOCK_SERVER}/test-pages/test-inline-elements.html`;
    await page.goto(testPageUrl, { waitUntil: 'networkidle' });
    console.log('📄 Test page loaded');

    // Find tab and wait for content script
    const tabId = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('test-inline-elements'));
      return tab ? tab.id : null;
    });

    let csReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const ping = await sw.evaluate(async tabId => {
          return await chrome.tabs.sendMessage(tabId, { action: 'PING' });
        }, tabId);
        if (ping?.success) {
          csReady = true;
          break;
        }
      } catch {
        // not ready
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!csReady) throw new Error('Content script not ready');
    console.log('✅ Content script injected and ready');

    // Trigger translation
    await sw.evaluate(
      async ({ tabId }) => {
        chrome.tabs.sendMessage(tabId, {
          action: 'START_TRANSLATION',
          tabId,
          settings: {
            apiKey: 'mock-api-key',
            apiEndpoint: 'http://localhost:3001/v1',
            model: 'gpt-4o-mini',
            targetLanguage: 'spanish',
          },
        });
      },
      { tabId }
    );

    // Wait for results
    await page.waitForSelector('#llm-original-toggle', { timeout: 30000 });
    const translatedCount = await page.evaluate(
      () => document.querySelectorAll('[data-llm-state="translated"]').length
    );

    const stats = await fetch(`${MOCK_SERVER}/test/stats`).then(r => r.json());

    console.log(`\n🎯 RESULTS:`);
    console.log(`   Translated elements: ${translatedCount}`);
    console.log(`   API requests: ${stats.requestCount}`);
    console.log(`   ✅ E2E smoke test passed`);
  } finally {
    await context.close();
  }
}

run().catch(error => {
  console.error('❌ E2E test failed:', error.message);
  process.exit(1);
});
