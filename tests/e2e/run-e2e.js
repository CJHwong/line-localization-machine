/* eslint-env browser */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const TEST_PAGE_PATH = path.join(__dirname, 'the_bitter_lesson.html');

// Mock API server controller
class MockAPIController {
  constructor() {
    this.baseUrl = 'http://localhost:3001';
  }

  async isRunning() {
    try {
      const response = await fetch(`${this.baseUrl}/test/stats`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStats() {
    try {
      const response = await fetch(`${this.baseUrl}/test/stats`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Silently fail
    }
    return null;
  }

  async testTranslation(input = 'Test Content') {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: input }],
        }),
      });

      if (response.ok) {
        const result = await response.json();
        return result.choices[0].message.content;
      }
    } catch {
      // Silently fail
    }
    return null;
  }

  async reset() {
    try {
      await fetch(`${this.baseUrl}/test/reset`, { method: 'POST' });
    } catch {
      // Silently fail
    }
  }
}

// E2E test runner
class E2ETestRunner {
  constructor() {
    this.browser = null;
    this.page = null;
    this.extensionId = null;
    this.mockAPI = new MockAPIController();
    this.beforeState = null;
  }

  async setup() {
    console.log('🚀 Setting up E2E tests...');

    // Check if test page exists
    if (!fs.existsSync(TEST_PAGE_PATH)) {
      throw new Error(`Test page not found: ${TEST_PAGE_PATH}`);
    }

    // Launch browser with extension
    console.log(`📁 Loading extension from: ${EXTENSION_PATH}`);

    this.browser = await puppeteer.launch({
      headless: false,
      devtools: false,
      defaultViewport: null,
      timeout: 30000,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    });

    // Wait for extension to load
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Get extension ID
    const targets = await this.browser.targets();
    const extensionTarget = targets.find(
      target =>
        target.url().startsWith('chrome-extension://') && target.url().includes('background')
    );

    if (!extensionTarget) {
      throw new Error('Extension failed to load');
    }

    this.extensionId = extensionTarget.url().split('/')[2];
    console.log('✅ Extension loaded successfully');
    console.log(`🎯 Extension ID: ${this.extensionId}`);

    const extensionTargets = targets.filter(
      target =>
        target.url().startsWith('chrome-extension://') ||
        target.type() === 'service_worker' ||
        target.type() === 'background_page'
    );

    console.log(`📊 Found ${extensionTargets.length} extension targets`);
  }

  async testMockServer() {
    console.log('\n🧪 Testing Mock Server Integration...');

    const isRunning = await this.mockAPI.isRunning();
    if (!isRunning) {
      console.log('⚠️ Mock server not running - skipping translation tests');
      return { available: false };
    }

    console.log('✅ Mock server is running');

    // Test the translation functionality
    const testInput = 'Hello World';
    const result = await this.mockAPI.testTranslation(testInput);

    if (result) {
      const expected = testInput.split('').reverse().join('');
      const reversalWorks = result === expected;
      console.log(`🔄 Translation test: "${testInput}" → "${result}"`);
      console.log(`🔍 Reversal working: ${reversalWorks ? '✅' : '❌'}`);
      return { available: true, reversalWorks };
    } else {
      console.log('❌ Failed to test mock server translation');
      return { available: true, reversalWorks: false };
    }
  }

  async configureExtension() {
    if (!this.mockAPI.isRunning()) {
      console.log('⚠️ Skipping extension configuration - no mock server');
      return false;
    }

    console.log('⚙️ Configuring extension settings...');

    const settingsPage = await this.browser.newPage();
    await settingsPage.goto(`chrome-extension://${this.extensionId}/settings/settings.html`);

    try {
      await settingsPage.waitForSelector('input[id="apiKey"]', { timeout: 10000 });

      await settingsPage.evaluate(mockServerUrl => {
        const endpointInput = document.querySelector('input[id="apiEndpoint"]');
        if (endpointInput) {
          endpointInput.value = mockServerUrl + '/v1';
          // eslint-disable-next-line no-undef
          endpointInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const apiKeyInput = document.querySelector('input[id="apiKey"]');
        if (apiKeyInput) {
          apiKeyInput.value = 'mock-api-key-for-testing';
          // eslint-disable-next-line no-undef
          apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const modelSelect = document.querySelector('select[id="model"]');
        if (modelSelect) {
          modelSelect.value = 'gpt-4o-mini';
          // eslint-disable-next-line no-undef
          modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const languageSelect = document.querySelector('select[id="targetLanguage"]');
        if (languageSelect) {
          languageSelect.value = 'spanish';
          // eslint-disable-next-line no-undef
          languageSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const blocksSelect = document.querySelector('select[id="blocksPerRequest"]');
        if (blocksSelect) {
          blocksSelect.value = '3';
          // eslint-disable-next-line no-undef
          blocksSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, this.mockAPI.baseUrl);

      await settingsPage.click('button#saveSettings');
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('✅ Extension configured to use mock server');
      return true;
    } catch (error) {
      console.log('❌ Failed to configure extension:', error.message);
      return false;
    } finally {
      await settingsPage.close();
    }
  }

  async openTestPageAndCaptureBefore() {
    console.log('\n🧪 Testing Page Content...');

    this.page = await this.browser.newPage();
    const testPageUrl = `file://${TEST_PAGE_PATH}`;
    await this.page.goto(testPageUrl, { waitUntil: 'networkidle0' });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const title = await this.page.title();
    if (title !== 'The Bitter Lesson') {
      throw new Error(`Expected page title 'The Bitter Lesson', got '${title}'`);
    }

    this.beforeState = await this.page.evaluate(() => {
      const getElementText = selector => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : '';
      };

      return {
        title: getElementText('h1'),
        author: getElementText('h2'),
        bodyText: document.body.textContent.substring(0, 500),
        elementCounts: {
          h1: document.querySelectorAll('h1').length,
          h2: document.querySelectorAll('h2').length,
          h3: document.querySelectorAll('h3').length,
          span: document.querySelectorAll('span').length,
          br: document.querySelectorAll('br').length,
        },
        hasTranslationClasses:
          document.querySelectorAll(
            '.llm-translated, .llm-preparing, .llm-fading-out, .llm-settled'
          ).length > 0,
      };
    });

    console.log('📝 Page content verified:');
    console.log(`   Title: "${this.beforeState.title}"`);
    console.log(`   Author: "${this.beforeState.author}"`);
    console.log(`   Elements: ${JSON.stringify(this.beforeState.elementCounts)}`);
    console.log(`   Has translation classes: ${this.beforeState.hasTranslationClasses}`);

    if (!this.beforeState.title.includes('Bitter Lesson')) {
      throw new Error('Expected article title not found');
    }

    if (!this.beforeState.author.includes('Rich Sutton')) {
      throw new Error('Expected author not found');
    }

    if (!this.beforeState.bodyText.includes('AI research')) {
      throw new Error('Expected article content not found');
    }

    return this.beforeState;
  }

  async waitForManualTranslation() {
    if (!(await this.mockAPI.isRunning())) {
      console.log('\n💡 Extension is ready for testing!');
      console.log('   (Mock server not available for automated translation test)');
      return false;
    }

    console.log('\n🎯 MANUAL TRANSLATION TEST:');
    console.log('============================');
    console.log('1. 📍 Click the extension icon in Chrome toolbar');
    console.log('2. 🔘 Click "Translate Page" button');
    console.log('3. ⏳ Watch the text reverse with animations');
    console.log('');
    console.log('💡 Expected results:');
    console.log('   • "The Bitter Lesson" → "nosseL rettiB ehT"');
    console.log('   • "Rich Sutton" → "nottuS hciR"');
    console.log('   • All text should reverse character-by-character');
    console.log('');
    console.log('⏳ Monitoring for translation changes (60 seconds max)...');

    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000));

      const currentState = await this.page.evaluate(() => {
        const hasTranslationClasses =
          document.querySelectorAll(
            '.llm-translated, .llm-preparing, .llm-fading-out, .llm-settled'
          ).length > 0;
        const title = document.querySelector('h1')
          ? document.querySelector('h1').textContent.trim()
          : '';
        const author = document.querySelector('h2')
          ? document.querySelector('h2').textContent.trim()
          : '';
        const bodyText = document.body.textContent.substring(0, 500);

        return {
          hasTranslationClasses,
          title,
          author,
          titleChanged: title !== 'The Bitter Lesson',
          authorChanged: author !== 'Rich Sutton',
          bodyChanged: !bodyText.includes(
            'The biggest lesson that can be read from 70 years of AI research'
          ),
        };
      });

      const anyChange =
        currentState.titleChanged ||
        currentState.authorChanged ||
        currentState.bodyChanged ||
        currentState.hasTranslationClasses;

      if (anyChange) {
        console.log(`✅ Translation detected after ${attempts * 2} seconds!`);
        console.log(`   Title changed: ${currentState.titleChanged}`);
        console.log(`   Author changed: ${currentState.authorChanged}`);
        console.log(`   Body changed: ${currentState.bodyChanged}`);
        console.log(`   Animation classes: ${currentState.hasTranslationClasses}`);

        await new Promise(resolve => setTimeout(resolve, 10000));
        return true;
      } else if (attempts % 5 === 0) {
        console.log(`   Still waiting... (${attempts * 2}s elapsed)`);
      }
    }

    console.log('⏰ No translation detected - manual step may not have been performed');
    return false;
  }

  async verifyResults() {
    if (!this.beforeState) {
      return { success: false, message: 'No initial state captured' };
    }

    console.log('\n📊 VERIFICATION RESULTS:');
    console.log('========================');

    const afterState = await this.page.evaluate(() => {
      const getElementText = selector => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : '';
      };

      return {
        title: getElementText('h1'),
        author: getElementText('h2'),
        bodyText: document.body.textContent.substring(0, 500),
        elementCounts: {
          h1: document.querySelectorAll('h1').length,
          h2: document.querySelectorAll('h2').length,
          h3: document.querySelectorAll('h3').length,
          span: document.querySelectorAll('span').length,
          br: document.querySelectorAll('br').length,
        },
        hasTranslationClasses:
          document.querySelectorAll(
            '.llm-translated, .llm-preparing, .llm-fading-out, .llm-settled'
          ).length > 0,
      };
    });

    const results = {
      structureIntact:
        JSON.stringify(this.beforeState.elementCounts) === JSON.stringify(afterState.elementCounts),
      titleReversed: afterState.title === this.beforeState.title.split('').reverse().join(''),
      authorReversed: afterState.author === this.beforeState.author.split('').reverse().join(''),
      bodyChanged: this.beforeState.bodyText !== afterState.bodyText,
      classesApplied: afterState.hasTranslationClasses,
    };

    console.log(`🏗️  Page structure intact: ${results.structureIntact ? '✅' : '❌'}`);
    console.log(`🔄 Title reversed correctly: ${results.titleReversed ? '✅' : '❌'}`);
    console.log(`🔄 Author reversed correctly: ${results.authorReversed ? '✅' : '❌'}`);
    console.log(`📝 Content changed: ${results.bodyChanged ? '✅' : '❌'}`);
    console.log(`🎨 Translation classes applied: ${results.classesApplied ? '✅' : '❌'}`);

    // Check mock server usage
    const stats = await this.mockAPI.getStats();
    if (stats) {
      const requestsMade = stats.requestCount > 1;
      console.log(
        `🖥️  Mock server used: ${requestsMade ? '✅' : '❌'} (${stats.requestCount} requests)`
      );
      results.mockServerUsed = requestsMade;
    }

    const success = results.titleReversed || results.authorReversed || results.bodyChanged;
    return { success, results, beforeState: this.beforeState, afterState };
  }

  async cleanup() {
    console.log('\n🧹 Test Complete');
    console.log('💡 Browser will remain open for inspection');
    console.log('   Close manually when finished');

    // Keep browser open for inspection
    // if (this.browser) {
    //   await this.browser.close();
    // }
  }

  async run() {
    try {
      await this.setup();

      // Test 1: Mock server integration
      const mockServerResult = await this.testMockServer();

      // Test 2: Extension configuration (if mock server available)
      let configured = false;
      if (mockServerResult.available) {
        configured = await this.configureExtension();
      }

      // Test 3: Page content verification
      await this.openTestPageAndCaptureBefore();

      // Test 4: Manual translation (if configured)
      let translationTested = false;
      if (configured) {
        translationTested = await this.waitForManualTranslation();
      }

      // Test 5: Results verification
      let verificationResult = { success: false };
      if (translationTested) {
        verificationResult = await this.verifyResults();
      }

      // Print summary
      console.log('\n🎯 FINAL TEST SUMMARY:');
      console.log('======================');

      console.log(`📦 Extension loaded: ✅`);
      console.log(`📄 Test page loaded: ✅`);
      console.log(`🖥️  Mock server available: ${mockServerResult.available ? '✅' : '❌'}`);

      if (mockServerResult.available) {
        console.log(`🔄 Mock server reversal: ${mockServerResult.reversalWorks ? '✅' : '❌'}`);
        console.log(`⚙️ Extension configured: ${configured ? '✅' : '❌'}`);
        console.log(`🔧 Translation tested: ${translationTested ? '✅' : '❌'}`);

        if (verificationResult.success) {
          console.log(`🎉 Translation verification: ✅`);
          console.log('\n✨ SUCCESS! End-to-end translation is working correctly!');
        } else if (translationTested) {
          console.log(`🎉 Translation verification: ❌`);
          console.log('\n⚠️ Translation was attempted but verification failed');
        } else {
          console.log('\n💡 Manual translation step was not completed');
        }
      } else {
        console.log('\n💡 To test translation: Start mock server with `npm run test:mock-server`');
      }

      return (
        mockServerResult.available && configured && translationTested && verificationResult.success
      );
    } catch (error) {
      console.error('\n❌ Test failed:', error.message);
      return false;
    } finally {
      await this.cleanup();
    }
  }
}

// Run the tests
if (require.main === module) {
  const runner = new E2ETestRunner();
  runner.run().catch(error => {
    console.error('E2E test runner failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  });
}

module.exports = E2ETestRunner;
