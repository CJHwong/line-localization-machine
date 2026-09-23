const fs = require('fs');
const path = require('path');

eval(
  fs.readFileSync(path.resolve(__dirname, '../../../content/animation.js'), 'utf8') +
    '\nglobal.Animation = Animation;'
);

function createItem() {
  document.body.innerHTML = '<p>Choose <button>Benchmarks</button></p>';
  const element = document.querySelector('p');
  const button = element.querySelector('button');
  const onClick = jest.fn();
  button.addEventListener('click', onClick);
  return { element, textNodes: [element.firstChild, button.firstChild], button, onClick };
}

test('translation toggles preserve controls and their event handlers', async () => {
  const item = createItem();
  const translation = await Animation.animateLineTransition(item, ['Select ', 'Demos'], {});
  Animation.addGlobalToggleButton(new Map([[item.element, translation]]));
  await new Promise(resolve => setTimeout(resolve, 1550));
  const toggle = document.querySelector('.llm-toggle-btn');
  toggle.click();
  expect(item.element.textContent).toBe('Choose Benchmarks');
  expect(item.element.querySelector('button')).toBe(item.button);
  toggle.click();
  expect(item.element.textContent).toBe('Select Demos');
  item.element.querySelector('button').click();
  expect(item.onClick).toHaveBeenCalledTimes(1);
});

test('segment mismatch preserves the original controls and text', async () => {
  const item = createItem();
  const translation = await Animation.animateLineTransition(item, ['Select Demos'], {});
  expect(item.element.querySelector('button')).toBe(item.button);
  expect(item.element.textContent).toBe('Choose Benchmarks');
  expect(translation).toBeNull();
});

test('the panel collapses without changing the translation', async () => {
  const item = createItem();
  const translation = await Animation.animateLineTransition(item, ['Select ', 'Demos'], {});
  Animation.addGlobalToggleButton(new Map([[item.element, translation]]));
  await new Promise(resolve => setTimeout(resolve, 1550));
  const collapse = document.querySelector('.llm-collapse-btn');
  const controls = document.querySelector('#llm-translation-controls');
  collapse.click();
  expect(controls.hidden).toBe(true);
  expect(collapse.getAttribute('aria-expanded')).toBe('false');
  expect(item.element.textContent).toBe('Select Demos');
  collapse.click();
  expect(controls.hidden).toBe(false);
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  document.querySelector('.llm-toggle-btn').click();
  expect(item.element.textContent).toBe('Choose Benchmarks');
});

test('restoration leaves text changed by the page intact', async () => {
  const item = createItem();
  const translation = await Animation.animateLineTransition(item, ['Select ', 'Demos'], {});
  item.button.firstChild.textContent = 'Updated by page';
  Animation.restoreTranslation(item.element, translation, true);
  expect(item.element.textContent).toBe('Choose Updated by page');
});

test('translation skips nodes replaced during the animation delay', async () => {
  const item = createItem();
  const pending = Animation.animateLineTransition(item, ['Select ', 'Demos'], {});
  item.button.textContent = 'Updated by page';
  expect(await pending).toBeNull();
  expect(item.element.textContent).toBe('Choose Updated by page');
});

test('in-place items translate text without styling their container', async () => {
  document.body.innerHTML = '<div>Orphan text in a container<p>Block</p></div>';
  const element = document.querySelector('div');
  const item = { element, textNodes: [element.firstChild], inPlace: true };
  Animation.animateBlockStart([item]);
  const translation = await Animation.animateLineTransition(item, ['容器中的文字'], {});
  expect(element.firstChild.textContent).toBe('容器中的文字');
  expect(element.className).toBe('');
  expect(element.hasAttribute('data-llm-state')).toBe(false);
  expect(translation.inPlace).toBe(true);
  Animation.addGlobalToggleButton(new Map([[element, translation]]));
  await new Promise(resolve => setTimeout(resolve, 1550));
  document.querySelector('.llm-toggle-btn').click();
  expect(element.firstChild.textContent).toBe('Orphan text in a container');
  expect(element.className).toBe('');
  expect(element.hasAttribute('data-llm-state')).toBe(false);
});
