const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function checkTabControls(page) {
  await page.goto('about:blank');
  await page.setContent(
    '<div id="tabs"><button>Benchmarks</button><button>Demonstrations</button></div><p id="panel">Benchmarks</p>'
  );
  await page.addScriptTag({ path: path.resolve(__dirname, '../../content/animation.js') });
  await page.evaluate(() => {
    const element = document.querySelector('#tabs');
    for (const button of element.children) {
      const label = button.textContent;
      button.addEventListener('click', () => {
        document.querySelector('#panel').textContent = label;
      });
    }
    window.tabItem = { element, textNodes: [...element.children].map(button => button.firstChild) };
  });
  await page.getByRole('button', { name: 'Demonstrations', exact: true }).click();
  const before = await page.locator('#panel').textContent();
  await page.evaluate(async () => {
    const translation = await Animation.animateLineTransition(window.tabItem, ['評測', '示範'], {});
    Animation.addGlobalToggleButton(new Map([[window.tabItem.element, translation]]));
  });
  const panel = page.locator('#llm-original-toggle');
  await panel.waitFor();
  const expandedWidth = (await panel.boundingBox()).width;
  await page.getByRole('button', { name: 'Collapse translation controls' }).click();
  assert.equal(await page.locator('.llm-toggle-btn').isVisible(), false);
  assert.ok((await panel.boundingBox()).width < expandedWidth);
  await page.getByRole('button', { name: 'Expand translation controls' }).press('Enter');
  assert.equal(await page.locator('.llm-toggle-btn').isVisible(), true);
  await page.locator('.llm-toggle-btn').click();
  await page.getByRole('button', { name: 'Benchmarks', exact: true }).click();
  const afterToggle = await page.locator('#panel').textContent();
  await page.locator('.llm-toggle-btn').click();
  await page.getByRole('button', { name: '示範', exact: true }).click();
  const afterSecondToggle = await page.locator('#panel').textContent();
  await page.evaluate(async () => {
    const translation = await Animation.animateLineTransition(window.tabItem, ['測試', '展示'], {});
    Animation.restoreTranslation(window.tabItem.element, translation, true);
  });
  await page.getByRole('button', { name: '評測', exact: true }).click();
  const afterRestore = await page.locator('#panel').textContent();
  const mismatch = await page.evaluate(async () => {
    await Animation.animateLineTransition(window.tabItem, ['評測和示範'], {});
    return document.querySelectorAll('#tabs button').length;
  });
  return {
    before,
    afterToggle,
    afterSecondToggle,
    afterRestore,
    controlsAfterMismatch: mismatch,
    passed:
      before === 'Demonstrations' &&
      afterToggle === 'Benchmarks' &&
      afterSecondToggle === 'Demonstrations' &&
      afterRestore === 'Benchmarks' &&
      mismatch === 2,
  };
}

async function main() {
  const browser = await chromium.launch();
  try {
    const result = await checkTabControls(await browser.newPage());
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.passed, true, 'Translation must preserve tab controls');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
