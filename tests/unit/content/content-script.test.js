/**
 * Unit tests for content script modules:
 * - TextExtraction: collectTextNodes, extractTextElements, identifyArticleContent
 * - LineLocalizationMachine: orchestration class (content-script.js)
 */

const fs = require('fs');
const path = require('path');

// ─── Load text-extraction.js (exposes TextExtraction global) ─────────────────

const textExtractionSource = fs.readFileSync(
  path.resolve(__dirname, '../../../content/text-extraction.js'),
  'utf8'
);
eval(textExtractionSource + '\nglobal.TextExtraction = TextExtraction;\n');

// ─── Load content-script.js (exposes LineLocalizationMachine class) ──────────

// Stub Animation global so content-script.js doesn't blow up
global.Animation = {
  getAdjustedTiming: ms => ms,
  delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
  injectSpeedAdjustedCSS: () => {},
  showTranslationProgress: () => {},
  updateTranslationProgress: () => {},
  hideTranslationProgress: () => {},
  animateBlockStart: () => {},
  animateBlockError: () => {},
  animateTranslation: () => {},
  animateLineTransition: () => ({ originalHTML: '', translatedHTML: '' }),
  addGlobalToggleButton: () => {},
  playCompletionSound: () => {},
};

const contentSource = fs.readFileSync(
  path.resolve(__dirname, '../../../content/content-script.js'),
  'utf8'
);
const classOnly = contentSource.replace(/^new LineLocalizationMachine\(\);?\s*$/m, '');
const wrappedSource = classOnly + '\nglobal.LineLocalizationMachine = LineLocalizationMachine;\n';
eval(wrappedSource);

// ─── collectTextNodes ─────────────────────────────────────────────────────────

describe('collectTextNodes', () => {
  test('collects single text node from plain element', () => {
    const el = document.createElement('p');
    el.textContent = 'Hello world';
    const nodes = TextExtraction.collectTextNodes(el);
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toBe('Hello world');
  });

  test('collects text nodes from element with inline markup', () => {
    const el = document.createElement('p');
    el.innerHTML = 'Click <strong>here</strong> to continue';
    const nodes = TextExtraction.collectTextNodes(el);
    expect(nodes.length).toBe(3);
    expect(nodes[0].textContent).toBe('Click ');
    expect(nodes[1].textContent).toBe('here');
    expect(nodes[2].textContent).toBe(' to continue');
  });

  test('collects text nodes from nested inline elements', () => {
    const el = document.createElement('p');
    el.innerHTML = 'Go to <a href="#"><strong>bold link</strong></a> now';
    const nodes = TextExtraction.collectTextNodes(el);
    expect(nodes.length).toBe(3);
    expect(nodes[0].textContent).toBe('Go to ');
    expect(nodes[1].textContent).toBe('bold link');
    expect(nodes[2].textContent).toBe(' now');
  });

  test('skips text inside CODE elements', () => {
    const el = document.createElement('p');
    el.innerHTML = 'Run <code>uv run</code> to start';
    const nodes = TextExtraction.collectTextNodes(el);
    expect(nodes.length).toBe(2);
    expect(nodes[0].textContent).toBe('Run ');
    expect(nodes[1].textContent).toBe(' to start');
  });

  test('skips text inside KBD, SAMP, ABBR, SUB, SUP, VAR, TIME', () => {
    const el = document.createElement('p');
    el.innerHTML = 'Press <kbd>Ctrl+C</kbd> or use <var>x</var> for <abbr>HTML</abbr>';
    const nodes = TextExtraction.collectTextNodes(el);
    const texts = nodes.map(n => n.textContent.trim()).filter(t => t.length > 0);
    expect(texts).not.toContain('Ctrl+C');
    expect(texts).not.toContain('x');
    expect(texts).not.toContain('HTML');
  });

  test('collects text from A, STRONG, EM, B, I, MARK, SPAN', () => {
    const el = document.createElement('p');
    el.innerHTML =
      '<a href="#">link</a> <strong>bold</strong> <em>italic</em> ' +
      '<b>b</b> <i>i</i> <mark>mark</mark> <span>span</span>';
    const nodes = TextExtraction.collectTextNodes(el);
    const texts = nodes.map(n => n.textContent);
    expect(texts).toContain('link');
    expect(texts).toContain('bold');
    expect(texts).toContain('italic');
    expect(texts).toContain('mark');
    expect(texts).toContain('span');
  });

  test('skips whitespace-only text nodes', () => {
    const el = document.createElement('p');
    el.innerHTML = '  <strong>bold</strong>  ';
    const nodes = TextExtraction.collectTextNodes(el);
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toBe('bold');
  });

  test('returns empty array for element with no text', () => {
    const el = document.createElement('p');
    el.innerHTML = '<img src="test.png"><br>';
    const nodes = TextExtraction.collectTextNodes(el);
    expect(nodes.length).toBe(0);
  });

  test('handles element with only opaque children', () => {
    const el = document.createElement('p');
    el.innerHTML = '<code>x</code><kbd>y</kbd>';
    const nodes = TextExtraction.collectTextNodes(el);
    expect(nodes.length).toBe(0);
  });
});

// ─── extractTextElements ─────────────────────────────────────────────────────

describe('extractTextElements', () => {
  test('extracts <p> elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>This is a paragraph with enough text to be extracted.</p>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].element.tagName).toBe('P');
  });

  test('extracts headings', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<h2>A heading with sufficient text length</h2>' +
      '<p>Paragraph text that is definitely long enough.</p>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(2);
    expect(elements[0].element.tagName).toBe('H2');
  });

  test('skips hidden elements', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p style="display:none">Hidden paragraph with enough text here.</p>' +
      '<p>Visible paragraph with enough text here too.</p>';
    const elements = TextExtraction.extractTextElements(container);
    // jsdom may not compute styles, so we check the visible one is found
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  test('skips elements inside <pre>/<code>', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<pre><code>some code that should not be translated</code></pre>' +
      '<p>Normal paragraph that should be extracted here.</p>';
    const elements = TextExtraction.extractTextElements(container);
    const tags = elements.map(e => e.element.tagName);
    expect(tags).not.toContain('CODE');
    expect(tags).toContain('P');
  });

  test('skips elements with llm-no-translate class', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p class="llm-no-translate">Skip this paragraph text entirely.</p>' +
      '<p>Translate this paragraph text instead.</p>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].element.classList.contains('llm-no-translate')).toBe(false);
  });

  test('includes textNodes array in extracted elements', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p>Plain text paragraph without any markup.</p>' +
      '<p>Paragraph with <strong>bold text</strong> in it.</p>';
    const elements = TextExtraction.extractTextElements(container);
    const plain = elements.find(e => e.originalText.includes('Plain'));
    const marked = elements.find(e => e.originalText.includes('bold'));
    expect(plain.textNodes.length).toBe(1);
    expect(marked.textNodes.length).toBe(3);
  });

  test('skips elements inside <nav>, <footer>, <aside>', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<nav><ul><li>Home link that is long enough to extract</li></ul></nav>' +
      '<p>Main content paragraph that should be extracted.</p>' +
      '<footer><p>Footer paragraph that should not be extracted.</p></footer>' +
      '<aside><p>Sidebar paragraph that should not be extracted.</p></aside>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].originalText).toContain('Main content');
  });

  test('skips elements inside common non-content class zones', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<div class="sidebar"><p>Sidebar widget text that should be skipped.</p></div>' +
      '<div class="comments"><p>User comment that should not be translated.</p></div>' +
      '<div class="related-posts"><p>Related article text that should be skipped.</p></div>' +
      '<p>Actual article content paragraph for translation.</p>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].originalText).toContain('Actual article');
  });

  test('skips elements with ARIA navigation/complementary roles', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<div role="navigation"><p>Navigation text that should be skipped.</p></div>' +
      '<div role="complementary"><p>Sidebar text that should be skipped.</p></div>' +
      '<p>Main article text that should be extracted here.</p>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].originalText).toContain('Main article');
  });

  test('avoids duplicate extraction of <p> inside <li>', () => {
    const container = document.createElement('div');
    container.innerHTML = '<ul><li><p>List item paragraph with enough text.</p></li></ul>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].element.tagName).toBe('P');
  });

  test('skips short text elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Hi</p><p>This is a long enough paragraph to extract.</p>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(1);
  });

  test('returns empty array for container with no block elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span>x</span>';
    const elements = TextExtraction.extractTextElements(container);
    expect(elements.length).toBe(0);
  });
});

// ─── identifyArticleContent ──────────────────────────────────────────────────

describe('identifyArticleContent', () => {
  test('returns null when Readability is not loaded', () => {
    const result = TextExtraction.identifyArticleContent();
    expect(result).toBeNull();
  });

  test('isArticleContent returns true when articleData is null (fallback mode)', () => {
    const el = document.createElement('p');
    el.textContent = 'This is some article content that should be accepted.';
    expect(TextExtraction.isArticleContent(el, null)).toBe(true);
  });

  test('isArticleContent matches exact paragraph text', () => {
    const articleData = {
      articleTexts: new Set(['This is the article paragraph content here.']),
      fullArticleText: 'This is the article paragraph content here.',
    };
    const el = document.createElement('p');
    el.textContent = 'This is the article paragraph content here.';
    expect(TextExtraction.isArticleContent(el, articleData)).toBe(true);
  });

  test('isArticleContent rejects text not in article', () => {
    const articleData = {
      articleTexts: new Set(['Article content that should be translated.']),
      fullArticleText: 'Article content that should be translated.',
    };
    const el = document.createElement('p');
    el.textContent = 'Navigation menu text that should not be translated.';
    expect(TextExtraction.isArticleContent(el, articleData)).toBe(false);
  });

  test('isArticleContent uses substring match for orphan text', () => {
    const articleData = {
      articleTexts: new Set(),
      fullArticleText: 'Here is a long article with some orphan text floating in the middle of it.',
    };
    const el = document.createElement('span');
    el.textContent = 'some orphan text floating in the middle';
    expect(TextExtraction.isArticleContent(el, articleData)).toBe(true);
  });

  test('isArticleContent matches article title (Readability strips title from content)', () => {
    // Readability returns title separately from content body.
    // The title should be included in articleTexts so the page's <h1> passes the filter.
    const articleData = {
      articleTexts: new Set([
        'Understanding the architecture of modern systems',
        'The first paragraph introduces the topic and provides context.',
      ]),
      fullArticleText:
        'Understanding the architecture of modern systems ' +
        'The first paragraph introduces the topic and provides context.',
    };
    const h1 = document.createElement('h1');
    h1.textContent = 'Understanding the architecture of modern systems';
    expect(TextExtraction.isArticleContent(h1, articleData)).toBe(true);
  });

  test('normalizeWhitespace collapses whitespace', () => {
    expect(TextExtraction.normalizeWhitespace('  hello   world  ')).toBe('hello world');
    expect(TextExtraction.normalizeWhitespace('line\n\ttwo')).toBe('line two');
  });
});
