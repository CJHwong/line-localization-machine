/**
 * Automated E2E test for the translation pipeline.
 *
 * Tests:
 * 1. Translation applied to DOM (text nodes replaced)
 * 2. Links (<a> tags) preserved after translation
 * 3. Inline elements (<strong>, <em>, <code>) preserved
 * 4. Non-content zones (nav, sidebar, footer) excluded
 * 5. Toggle button works correctly
 *
 * Usage:
 *   # Terminal 1: start mock server
 *   npm run test:mock-server
 *
 *   # Terminal 2: run this test
 *   node tests/e2e/test-translation-pipeline.js
 *
 * Options:
 *   --headed     Show browser window (default: headless)
 *   --keep-open  Keep browser open after test
 *   --live       Use real LLM API instead of mock server
 *   --endpoint=URL     API endpoint (default: https://api.openai.com/v1)
 *   --model=MODEL      Model name (default: gpt-4o-mini)
 *   --api-key-env=VAR  Env var for API key (default: OPENAI_API_KEY)
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const os = require('os');

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const MOCK_SERVER = 'http://localhost:3001';

const args = process.argv.slice(2);
const _HEADED = args.includes('--headed'); // reserved for future headless support
const KEEP_OPEN = args.includes('--keep-open');
const LIVE_MODE = args.includes('--live');
const CUSTOM_URL =
  (args.find(a => a.startsWith('--url=')) || '').split('=').slice(1).join('=') || '';
const TARGET_LANG = (args.find(a => a.startsWith('--lang=')) || '').split('=')[1] || 'spanish';
const API_ENDPOINT =
  (args.find(a => a.startsWith('--endpoint=')) || '').split('=').slice(1).join('=') || '';
const MODEL_NAME = (args.find(a => a.startsWith('--model=')) || '').split('=')[1] || '';
const API_KEY_ENV =
  (args.find(a => a.startsWith('--api-key-env=')) || '').split('=')[1] || 'OPENAI_API_KEY';

class PipelineTest {
  constructor() {
    this.context = null;
    this.page = null;
    this.serviceWorker = null;
    this.passed = 0;
    this.failed = 0;
    this.errors = [];
  }

  assert(condition, message) {
    if (condition) {
      this.passed++;
      console.log(`  ✅ ${message}`);
    } else {
      this.failed++;
      this.errors.push(message);
      console.log(`  ❌ ${message}`);
    }
  }

  async setup() {
    console.log('🚀 Setting up pipeline test...');
    console.log(`   Mode: ${LIVE_MODE ? 'LIVE (real OpenAI API)' : 'mock server'}`);

    if (LIVE_MODE) {
      // Validate API key from environment (never log the key)
      const apiKey = process.env[API_KEY_ENV];
      if (!apiKey) {
        console.error(`❌ $${API_KEY_ENV} not set. Required for --live mode.`);
        process.exit(1);
      }
      const endpoint = API_ENDPOINT || 'https://api.openai.com/v1';
      const model = MODEL_NAME || 'gpt-4o-mini';
      console.log(`   API key: $${API_KEY_ENV} (${apiKey.length} chars)`);
      console.log(`   Endpoint: ${endpoint}`);
      console.log(`   Model: ${model}`);
    } else {
      // Verify mock server is running
      try {
        const res = await fetch(`${MOCK_SERVER}/test/stats`);
        if (!res.ok) throw new Error('Mock server not responding');
      } catch {
        console.error('❌ Mock server not running. Start it first: npm run test:mock-server');
        process.exit(1);
      }

      // Reset and configure mock server
      await fetch(`${MOCK_SERVER}/test/reset`, { method: 'POST' });
      await fetch(`${MOCK_SERVER}/test/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'json' }),
      });
    }

    // Launch browser with extension using Playwright's persistent context
    const tmpDir = path.join(os.tmpdir(), `llm-test-profile-${Date.now()}`);
    this.context = await chromium.launchPersistentContext(tmpDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1280, height: 900 },
    });

    // Wait for the extension's service worker
    console.log('   Waiting for extension service worker...');
    this.serviceWorker =
      this.context.serviceWorkers().find(sw => sw.url().includes('background/background.js')) ||
      (await this.context.waitForEvent('serviceworker', {
        predicate: sw => sw.url().includes('background/background.js'),
        timeout: 15000,
      }));

    const extensionId = this.serviceWorker.url().split('/')[2];
    console.log(`   Extension ID: ${extensionId}`);
    console.log('   Setup complete');
  }

  async triggerTranslation() {
    console.log('🌐 Opening test page and triggering translation...');
    this.page = await this.context.newPage();

    // Collect console output for debugging
    const consoleLogs = [];
    this.page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes('[LLM DEBUG]') || text.includes('[TabID Debug]')) {
        console.log(`   [DEBUG] ${text.substring(0, 200)}`);
      }
    });

    // Navigate to test page (custom URL, or test page served by mock server)
    const pageUrl = CUSTOM_URL || `${MOCK_SERVER}/test-pages/test-inline-elements.html`;
    await this.page.goto(pageUrl, { waitUntil: 'networkidle' });
    console.log(`   Page loaded: ${pageUrl}`);

    // Find the tab ID for our test page
    const pageHostname = new URL(pageUrl).hostname;
    const tabId = await this.serviceWorker.evaluate(async hostname => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes(hostname));
      return tab ? tab.id : null;
    }, pageHostname);
    if (!tabId) throw new Error('Could not find test page tab');
    console.log(`   Tab ID: ${tabId}`);

    // Wait for content script to be ready (PING until it responds)
    console.log('   Waiting for content script...');
    let csReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const ping = await this.serviceWorker.evaluate(async tabId => {
          return await chrome.tabs.sendMessage(tabId, { action: 'PING' });
        }, tabId);
        if (ping && ping.success) {
          csReady = true;
          break;
        }
      } catch {
        // Content script not ready yet
      }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!csReady) throw new Error('Content script did not respond to PING after 15s');
    console.log('   Content script ready');

    // Send START_TRANSLATION
    const settings = LIVE_MODE
      ? {
          apiKey: process.env[API_KEY_ENV],
          apiEndpoint: API_ENDPOINT || 'https://api.openai.com/v1',
          model: MODEL_NAME || 'gpt-4o-mini',
          targetLanguage: TARGET_LANG,
          temperature: 0.3,
        }
      : {
          apiKey: 'mock-api-key',
          apiEndpoint: `${MOCK_SERVER}/v1`,
          model: 'gpt-4o-mini',
          targetLanguage: TARGET_LANG,
          temperature: 0.3,
        };
    console.log('   Sending START_TRANSLATION...');
    await this.serviceWorker.evaluate(
      async ({ tabId, settings }) => {
        chrome.tabs.sendMessage(tabId, {
          action: 'START_TRANSLATION',
          tabId,
          settings,
        });
      },
      { tabId, settings }
    );
    console.log('   START_TRANSLATION message sent');

    // Wait for translation to complete (toggle button appears when done)
    console.log('   Waiting for translation to complete...');
    try {
      const timeout = LIVE_MODE ? 120000 : 60000;
      await this.page.waitForSelector('#llm-original-toggle', { timeout });
      console.log('   Translation complete (toggle button appeared)');
      // Extra wait for final animations to settle
      await this.page.waitForTimeout(3000);
    } catch {
      const translatedCount = await this.page.evaluate(() => {
        return document.querySelectorAll('[data-llm-state="translated"]').length;
      });
      if (translatedCount > 0) {
        console.log(`   Translation detected: ${translatedCount} elements (no toggle button yet)`);
        await this.page.waitForTimeout(3000);
      } else {
        console.log('   ⚠️ No translation detected after timeout');
        const pageState = await this.page.evaluate(() => ({
          llmElements: document.querySelectorAll('[data-llm-state]').length,
          paragraphs: document.querySelectorAll('p').length,
          bodySnippet: document.body.textContent.substring(0, 200),
        }));
        console.log(`   Page state: ${JSON.stringify(pageState)}`);
      }
    }

    return consoleLogs;
  }

  async verifyTranslationApplied() {
    console.log('\n📋 Test: Translation applied to DOM');

    const results = await this.page.evaluate(() => {
      const translated = document.querySelectorAll('[data-llm-state="translated"]');
      return { translatedCount: translated.length };
    });

    this.assert(
      results.translatedCount > 0,
      `Found ${results.translatedCount} translated elements`
    );
  }

  async verifyLinksPreserved() {
    console.log('\n📋 Test: Links preserved after translation');

    const results = await this.page.evaluate(() => {
      const translated = document.querySelectorAll('[data-llm-state="translated"]');
      let totalLinks = 0;
      const linkDetails = [];

      translated.forEach(el => {
        const links = el.querySelectorAll('a[href]');
        totalLinks += links.length;
        links.forEach(link => {
          linkDetails.push({
            href: link.getAttribute('href'),
            text: link.textContent.substring(0, 50),
            parentTag: el.tagName,
          });
        });
      });

      return { translatedCount: translated.length, totalLinks, linkDetails };
    });

    console.log(`   Links in translated DOM: ${results.totalLinks}`);
    this.assert(
      results.totalLinks > 0,
      `Links exist in translated DOM (${results.totalLinks} found)`
    );

    if (results.linkDetails.length > 0) {
      console.log('   Sample links:');
      results.linkDetails.slice(0, 5).forEach(link => {
        console.log(`     <a href="${link.href}">${link.text}</a> in ${link.parentTag}`);
      });
    }
  }

  async verifyInlineElements() {
    console.log('\n📋 Test: Inline elements preserved after translation');

    const results = await this.page.evaluate(() => {
      const translated = document.querySelectorAll('[data-llm-state="translated"]');
      const counts = { strong: 0, em: 0, code: 0 };

      translated.forEach(el => {
        counts.strong += el.querySelectorAll('strong').length;
        counts.em += el.querySelectorAll('em').length;
        counts.code += el.querySelectorAll('code').length;
      });

      return { counts };
    });

    console.log(
      `   Preserved: strong=${results.counts.strong}, em=${results.counts.em}, code=${results.counts.code}`
    );

    this.assert(
      results.counts.strong > 0,
      `<strong> elements preserved (${results.counts.strong})`
    );
    this.assert(results.counts.em > 0, `<em> elements preserved (${results.counts.em})`);
    this.assert(results.counts.code > 0, `<code> elements preserved (${results.counts.code})`);
  }

  async verifyNonContentExcluded() {
    if (CUSTOM_URL) {
      console.log('\n📋 Test: Non-content zones excluded (skipped for custom URL)');
      return;
    }
    console.log('\n📋 Test: Non-content zones excluded');

    const results = await this.page.evaluate(() => ({
      navTranslated: document.querySelectorAll('nav [data-llm-state]').length,
      sidebarTranslated: document.querySelectorAll('.sidebar [data-llm-state]').length,
      footerTranslated: document.querySelectorAll('footer [data-llm-state]').length,
      articleTranslated: document.querySelectorAll('article [data-llm-state]').length,
    }));

    this.assert(
      results.navTranslated === 0,
      `Nav not translated (${results.navTranslated} elements)`
    );
    this.assert(
      results.sidebarTranslated === 0,
      `Sidebar not translated (${results.sidebarTranslated} elements)`
    );
    this.assert(
      results.footerTranslated === 0,
      `Footer not translated (${results.footerTranslated} elements)`
    );
    this.assert(
      results.articleTranslated > 0,
      `Article content translated (${results.articleTranslated} elements)`
    );
  }

  async verifyToggle() {
    console.log('\n📋 Test: Toggle button works');

    const toggleExists = await this.page.evaluate(
      () => !!document.getElementById('llm-original-toggle')
    );
    if (!toggleExists) {
      console.log('   ⚠️ Toggle button not found, skipping toggle tests');
      return;
    }

    // Click "Show Originals"
    await this.page.click('#llm-original-toggle .llm-toggle-btn');
    await this.page.waitForTimeout(500);

    const afterOriginals = await this.page.evaluate(() => {
      const elements = document.querySelectorAll('[data-llm-state="showing-original"]');
      return { showingOriginal: elements.length };
    });

    this.assert(
      afterOriginals.showingOriginal > 0,
      `Elements showing originals (${afterOriginals.showingOriginal})`
    );

    // Click "Show Translations" (toggle back)
    await this.page.click('#llm-original-toggle .llm-toggle-btn');
    await this.page.waitForTimeout(500);

    const afterTranslations = await this.page.evaluate(() => {
      const elements = document.querySelectorAll('[data-llm-state="translated"]');
      let linksFound = 0;
      elements.forEach(el => {
        linksFound += el.querySelectorAll('a[href]').length;
      });
      return { showingTranslated: elements.length, linksFound };
    });

    this.assert(
      afterTranslations.showingTranslated > 0,
      `Elements showing translations (${afterTranslations.showingTranslated})`
    );
    this.assert(
      afterTranslations.linksFound > 0,
      `Links preserved after toggle (${afterTranslations.linksFound})`
    );
  }

  async run() {
    try {
      await this.setup();
      const consoleLogs = await this.triggerTranslation();

      await this.verifyTranslationApplied();
      await this.verifyLinksPreserved();
      await this.verifyInlineElements();
      await this.verifyNonContentExcluded();
      await this.verifyToggle();

      // Print summary
      console.log('\n' + '='.repeat(50));
      console.log(`📊 Results: ${this.passed} passed, ${this.failed} failed`);
      if (this.errors.length > 0) {
        console.log('\nFailed assertions:');
        this.errors.forEach(e => console.log(`  ❌ ${e}`));
      }

      const debugLogs = consoleLogs.filter(l => l.includes('[LLM DEBUG]'));
      if (debugLogs.length > 0) {
        console.log(`\n📝 ${debugLogs.length} debug log entries captured`);
      }

      if (!LIVE_MODE) {
        const stats = await fetch(`${MOCK_SERVER}/test/stats`).then(r => r.json());
        console.log(`\n🖥️  Mock server: ${stats.requestCount} API requests served`);
      }
      console.log('\n' + (this.failed === 0 ? '✨ ALL TESTS PASSED' : '💥 SOME TESTS FAILED'));

      return this.failed === 0;
    } catch (error) {
      console.error('\n💥 Test error:', error.message);
      console.error(error.stack);
      return false;
    } finally {
      if (!KEEP_OPEN && this.context) {
        await this.context.close();
      } else if (this.context) {
        console.log('\n💡 Browser kept open for inspection. Close manually when done.');
      }
    }
  }
}

// Run
if (require.main === module) {
  const test = new PipelineTest();
  test.run().then(success => {
    if (!KEEP_OPEN) process.exit(success ? 0 : 1);
  });
}

module.exports = PipelineTest;
