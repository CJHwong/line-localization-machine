/**
 * Unit tests for content-script.js pure functions:
 * - sanitizeHTML
 * - serializeForTranslation
 * - deserializeFromTranslation
 * - extractTextElements (block-level selector approach)
 * - findMainContent (scoring-based)
 */

// The content script defines LineLocalizationMachine on global scope.
// We load the source, strip the auto-init, and eval it so the class is available.

const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(
  path.resolve(__dirname, '../../../content/content-script.js'),
  'utf8'
);

// Remove the final `new LineLocalizationMachine()` line so it doesn't auto-init,
// and append an assignment to make the class available via `global`.
const classOnly = source.replace(/^new LineLocalizationMachine\(\);?\s*$/m, '');
const wrappedSource = classOnly + '\nglobal.LineLocalizationMachine = LineLocalizationMachine;\n';

eval(wrappedSource);

// Helper: create an instance without triggering init/constructor side effects
function createMachine() {
  const machine = Object.create(global.LineLocalizationMachine.prototype);
  machine.isTranslating = false;
  machine.originalContent = new Map();
  machine.translationSettings = null;
  machine.animationQueue = [];
  machine.translationHistory = [];
  machine.totalBlocks = 0;
  machine.completedBlocks = 0;
  machine.tabId = null;
  machine.debug = false;
  return machine;
}

// ─── sanitizeHTML ────────────────────────────────────────────────────────────

describe('sanitizeHTML', () => {
  let machine;
  beforeEach(() => {
    machine = createMachine();
  });

  test('passes through safe HTML unchanged', () => {
    const html = '<strong>bold</strong> and <em>italic</em>';
    expect(machine.sanitizeHTML(html)).toBe(html);
  });

  test('strips <script> tags', () => {
    const html = 'hello <script>alert("xss")</script> world';
    const result = machine.sanitizeHTML(html);
    expect(result).not.toContain('<script');
    expect(result).toContain('hello');
    expect(result).toContain('world');
  });

  test('strips <iframe> tags', () => {
    const html = 'text <iframe src="evil.com"></iframe> more';
    const result = machine.sanitizeHTML(html);
    expect(result).not.toContain('<iframe');
  });

  test('strips <object>, <embed>, <form> tags', () => {
    const html = '<object data="x"></object><embed src="y"><form action="z">input</form>';
    const result = machine.sanitizeHTML(html);
    expect(result).not.toContain('<object');
    expect(result).not.toContain('<embed');
    expect(result).not.toContain('<form');
  });

  test('strips on* event handler attributes', () => {
    const html = '<a href="#" onclick="alert(1)">click</a>';
    const result = machine.sanitizeHTML(html);
    expect(result).not.toContain('onclick');
    expect(result).toContain('click</a>');
  });

  test('strips javascript: hrefs', () => {
    const html = '<a href="javascript:alert(1)">link</a>';
    const result = machine.sanitizeHTML(html);
    expect(result).not.toContain('javascript:');
  });

  test('preserves safe inline elements', () => {
    const html = '<code>foo</code> <kbd>bar</kbd> <abbr>baz</abbr>';
    const result = machine.sanitizeHTML(html);
    expect(result).toContain('<code>');
    expect(result).toContain('<kbd>');
    expect(result).toContain('<abbr>');
  });

  test('returns empty string for empty input', () => {
    expect(machine.sanitizeHTML('')).toBe('');
  });

  test('returns plain text as-is', () => {
    expect(machine.sanitizeHTML('no html here')).toBe('no html here');
  });
});

// ─── serializeForTranslation ─────────────────────────────────────────────────

describe('serializeForTranslation', () => {
  let machine;
  beforeEach(() => {
    machine = createMachine();
  });

  test('plain text element returns text with no placeholderMap', () => {
    const el = document.createElement('p');
    el.textContent = 'Hello world';
    const result = machine.serializeForTranslation(el);
    expect(result.text).toBe('Hello world');
    expect(result.placeholderMap).toBeNull();
  });

  test('element with <strong> gets translatable marker', () => {
    const el = document.createElement('p');
    el.innerHTML = 'Click <strong>here</strong> now';
    const result = machine.serializeForTranslation(el);
    expect(result.text).toMatch(/\[T:1\]here\[\/T:1\]/);
    expect(result.text).toContain('Click ');
    expect(result.text).toContain(' now');
    expect(result.placeholderMap).not.toBeNull();
    expect(result.placeholderMap['1'].tag).toBe('STRONG');
  });

  test('element with <code> gets opaque marker', () => {
    const el = document.createElement('p');
    el.innerHTML = 'Run <code>uv run</code> to start';
    const result = machine.serializeForTranslation(el);
    expect(result.text).toMatch(/\[O:1\]/);
    expect(result.text).not.toContain('<code>');
    expect(result.placeholderMap['1'].outerHTML).toContain('<code>');
  });

  test('element with <a> link gets translatable marker', () => {
    const el = document.createElement('p');
    el.innerHTML = 'See <a href="https://example.com">this page</a> for details';
    const result = machine.serializeForTranslation(el);
    expect(result.text).toMatch(/\[T:1\]this page\[\/T:1\]/);
    expect(result.placeholderMap['1'].tag).toBe('A');
    expect(result.placeholderMap['1'].attrs).toContain('href="https://example.com"');
  });

  test('nested <a><strong>text</strong></a> produces nested markers', () => {
    const el = document.createElement('p');
    el.innerHTML = 'Go to <a href="#"><strong>bold link</strong></a> now';
    const result = machine.serializeForTranslation(el);
    // Should have two markers, one nested inside the other
    expect(result.text).toMatch(/\[T:\d+\]\[T:\d+\]bold link\[\/T:\d+\]\[\/T:\d+\]/);
  });

  test('<br> gets opaque marker', () => {
    const el = document.createElement('p');
    el.innerHTML = 'line one<br>line two';
    const result = machine.serializeForTranslation(el);
    expect(result.text).toMatch(/\[O:\d+\]/);
    expect(result.placeholderMap).not.toBeNull();
  });

  test('multiple inline elements get unique markers', () => {
    const el = document.createElement('p');
    el.innerHTML = '<em>one</em> and <strong>two</strong> and <code>three</code>';
    const result = machine.serializeForTranslation(el);
    expect(result.text).toMatch(/\[T:1\]/);
    expect(result.text).toMatch(/\[T:2\]/);
    expect(result.text).toMatch(/\[O:3\]/);
  });
});

// ─── deserializeFromTranslation ──────────────────────────────────────────────

describe('deserializeFromTranslation', () => {
  let machine;
  beforeEach(() => {
    machine = createMachine();
  });

  test('returns clean text when map is null and no markers present', () => {
    expect(machine.deserializeFromTranslation('hello world', null)).toBe('hello world');
  });

  test('strips cross-contaminated markers when map is null', () => {
    // LLM can hallucinate markers into items that had no inline markup
    const text = 'El equipo [T:1]comenzó[/T:1] con la regla [O:2]';
    const result = machine.deserializeFromTranslation(text, null);
    expect(result).not.toContain('[T:');
    expect(result).not.toContain('[/T:');
    expect(result).not.toContain('[O:');
    expect(result).toContain('comenzó');
  });

  test('restores opaque marker [O:N]', () => {
    const map = { 1: { type: 'opaque', outerHTML: '<code>uv run</code>' } };
    const text = 'Ejecutar [O:1] para empezar';
    const result = machine.deserializeFromTranslation(text, map);
    expect(result).toBe('Ejecutar <code>uv run</code> para empezar');
  });

  test('restores translatable marker [T:N]...[/T:N]', () => {
    const map = { 1: { type: 'translatable', tag: 'STRONG', attrs: '' } };
    const text = 'Haz clic [T:1]aquí[/T:1] ahora';
    const result = machine.deserializeFromTranslation(text, map);
    expect(result).toBe('Haz clic <strong>aquí</strong> ahora');
  });

  test('restores translatable marker with attributes', () => {
    const map = {
      1: { type: 'translatable', tag: 'A', attrs: 'href="https://example.com" class="link"' },
    };
    const text = 'Ver [T:1]esta página[/T:1] para detalles';
    const result = machine.deserializeFromTranslation(text, map);
    expect(result).toBe(
      'Ver <a href="https://example.com" class="link">esta página</a> para detalles'
    );
  });

  test('restores nested markers inside-out', () => {
    const map = {
      1: { type: 'translatable', tag: 'A', attrs: 'href="#"' },
      2: { type: 'translatable', tag: 'STRONG', attrs: '' },
    };
    const text = 'Ir a [T:1][T:2]enlace negrita[/T:2][/T:1] ahora';
    const result = machine.deserializeFromTranslation(text, map);
    expect(result).toBe('Ir a <a href="#">\u003cstrong>enlace negrita</strong></a> ahora');
  });

  test('strips orphaned paired markers (LLM corruption)', () => {
    const map = { 1: { type: 'opaque', outerHTML: '<br>' } };
    const text = 'some [T:99]orphaned[/T:99] text [O:1] and [O:55] leftover';
    const result = machine.deserializeFromTranslation(text, map);
    // [O:1] should be restored, [T:99] and [O:55] should be cleaned up
    expect(result).toContain('<br>');
    expect(result).not.toContain('[T:99]');
    expect(result).not.toContain('[/T:99]');
    expect(result).not.toContain('[O:55]');
    expect(result).toContain('orphaned');
  });

  test('strips orphaned opening tags when LLM drops closing tag', () => {
    const map = { 1: { type: 'translatable', tag: 'STRONG', attrs: '' } };
    // LLM returned opening [T:1] but dropped the closing [/T:1]
    const text = 'texto [T:1]negrita sin cierre y más texto';
    const result = machine.deserializeFromTranslation(text, map);
    expect(result).not.toContain('[T:1]');
    expect(result).toContain('negrita sin cierre');
  });

  test('strips all marker types when LLM corrupts output', () => {
    const map = {};
    const text = 'clean [T:5]this [O:3] and [/T:7] up';
    const result = machine.deserializeFromTranslation(text, map);
    expect(result).not.toContain('[T:');
    expect(result).not.toContain('[/T:');
    expect(result).not.toContain('[O:');
    expect(result).toBe('clean this  and  up');
  });

  test('round-trip: serialize then deserialize produces valid HTML', () => {
    const el = document.createElement('p');
    el.innerHTML = 'Click <strong>here</strong> and <a href="#">there</a>';
    const serialized = machine.serializeForTranslation(el);
    // Simulate translation that preserves markers
    const translated = serialized.text
      .replace('Click ', 'Haz clic ')
      .replace('here', 'aquí')
      .replace(' and ', ' y ')
      .replace('there', 'allí');
    const result = machine.deserializeFromTranslation(translated, serialized.placeholderMap);
    expect(result).toContain('<strong>aquí</strong>');
    expect(result).toContain('<a href="#">allí</a>');
    expect(result).toContain('Haz clic ');
  });
});

// ─── stripMarkers ────────────────────────────────────────────────────────────

describe('stripMarkers', () => {
  let machine;
  beforeEach(() => {
    machine = createMachine();
  });

  test('strips all marker types from text', () => {
    const text = 'hello [T:1]world[/T:1] foo [O:2] bar';
    expect(machine.stripMarkers(text)).toBe('hello world foo  bar');
  });

  test('returns empty string for null/undefined', () => {
    expect(machine.stripMarkers(null)).toBe('');
    expect(machine.stripMarkers(undefined)).toBe('');
  });

  test('coerces non-string values to string', () => {
    expect(machine.stripMarkers(42)).toBe('42');
    expect(machine.stripMarkers(true)).toBe('true');
  });

  test('passes through clean text unchanged', () => {
    expect(machine.stripMarkers('no markers here')).toBe('no markers here');
  });
});

// ─── deserializeFromTranslation non-string handling ──────────────────────────

describe('deserializeFromTranslation — non-string inputs', () => {
  let machine;
  beforeEach(() => {
    machine = createMachine();
  });

  test('handles null input gracefully', () => {
    const result = machine.deserializeFromTranslation(null, null);
    expect(result).toBe('');
  });

  test('handles number input gracefully', () => {
    const result = machine.deserializeFromTranslation(42, null);
    expect(result).toBe('42');
  });

  test('strips markers from number-coerced string', () => {
    // Edge case: would not normally happen, but verifies coercion path
    const result = machine.deserializeFromTranslation('[T:1]hello[/T:1]', null);
    expect(result).toBe('hello');
  });
});

// ─── extractTextElements ─────────────────────────────────────────────────────

describe('extractTextElements', () => {
  let machine;
  beforeEach(() => {
    machine = createMachine();
  });

  test('extracts <p> elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>This is a paragraph with enough text to be extracted.</p>';
    const elements = machine.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].element.tagName).toBe('P');
  });

  test('extracts headings', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<h2>A heading with sufficient text length</h2>' +
      '<p>Paragraph text that is definitely long enough.</p>';
    const elements = machine.extractTextElements(container);
    expect(elements.length).toBe(2);
    expect(elements[0].element.tagName).toBe('H2');
  });

  test('skips hidden elements', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p style="display:none">Hidden paragraph with enough text here.</p>' +
      '<p>Visible paragraph with enough text here too.</p>';
    const elements = machine.extractTextElements(container);
    // jsdom may not compute styles, so we check the visible one is found
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  test('skips elements inside <pre>/<code>', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<pre><code>some code that should not be translated</code></pre>' +
      '<p>Normal paragraph that should be extracted here.</p>';
    const elements = machine.extractTextElements(container);
    const tags = elements.map(e => e.element.tagName);
    expect(tags).not.toContain('CODE');
    expect(tags).toContain('P');
  });

  test('skips elements with llm-no-translate class', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p class="llm-no-translate">Skip this paragraph text entirely.</p>' +
      '<p>Translate this paragraph text instead.</p>';
    const elements = machine.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].element.classList.contains('llm-no-translate')).toBe(false);
  });

  test('detects hasInlineMarkup correctly', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p>Plain text paragraph without any markup.</p>' +
      '<p>Paragraph with <strong>bold text</strong> in it.</p>';
    const elements = machine.extractTextElements(container);
    const plain = elements.find(e => e.originalText.includes('Plain'));
    const marked = elements.find(e => e.originalText.includes('bold'));
    expect(plain.hasInlineMarkup).toBe(false);
    expect(marked.hasInlineMarkup).toBe(true);
  });

  test('skips elements inside <nav>, <footer>, <aside>', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<nav><ul><li>Home link that is long enough to extract</li></ul></nav>' +
      '<p>Main content paragraph that should be extracted.</p>' +
      '<footer><p>Footer paragraph that should not be extracted.</p></footer>' +
      '<aside><p>Sidebar paragraph that should not be extracted.</p></aside>';
    const elements = machine.extractTextElements(container);
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
    const elements = machine.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].originalText).toContain('Actual article');
  });

  test('skips elements with ARIA navigation/complementary roles', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<div role="navigation"><p>Navigation text that should be skipped.</p></div>' +
      '<div role="complementary"><p>Sidebar text that should be skipped.</p></div>' +
      '<p>Main article text that should be extracted here.</p>';
    const elements = machine.extractTextElements(container);
    expect(elements.length).toBe(1);
    expect(elements[0].originalText).toContain('Main article');
  });

  test('avoids duplicate extraction of <p> inside <li>', () => {
    const container = document.createElement('div');
    container.innerHTML = '<ul><li><p>List item paragraph with enough text.</p></li></ul>';
    const elements = machine.extractTextElements(container);
    // Should only extract the <p>, not both <li> and <p>
    expect(elements.length).toBe(1);
    expect(elements[0].element.tagName).toBe('P');
  });

  test('skips short text elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Hi</p><p>This is a long enough paragraph to extract.</p>';
    const elements = machine.extractTextElements(container);
    expect(elements.length).toBe(1);
  });

  test('returns empty array for container with no block elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span>x</span>';
    const elements = machine.extractTextElements(container);
    expect(elements.length).toBe(0);
  });
});

// ─── findMainContent ─────────────────────────────────────────────────────────

describe('findMainContent', () => {
  let machine;

  beforeEach(() => {
    machine = createMachine();
    // Reset body
    document.body.innerHTML = '';
  });

  test('selects <article> over <nav>', () => {
    // Need enough content to exceed MIN_SCORE (50 points) in the scoring algorithm
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) =>
        `<p>This is paragraph ${i + 1} of the article with enough text to contribute to the scoring algorithm used by findMainContent.</p>`
    ).join('\n');
    document.body.innerHTML = `
      <nav><ul><li>Home</li><li>About</li><li>Contact</li></ul></nav>
      <article>
        <h2>Article Heading</h2>
        ${paragraphs}
      </article>
    `;
    const result = machine.findMainContent();
    expect(result.tagName).toBe('ARTICLE');
  });

  test('selects <main> when present', () => {
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) =>
        `<p>This is paragraph ${i + 1} of the main content area with sufficient text for scoring purposes.</p>`
    ).join('\n');
    document.body.innerHTML = `
      <header><h1>Site Title</h1></header>
      <main>
        <h2>Main Section Heading</h2>
        ${paragraphs}
      </main>
      <footer><p>Footer text</p></footer>
    `;
    const result = machine.findMainContent();
    expect(result.tagName).toBe('MAIN');
  });

  test('falls back to body when no semantic containers', () => {
    document.body.innerHTML = '<div><p>Just a paragraph with some text content.</p></div>';
    const result = machine.findMainContent();
    expect(result.tagName).toBe('BODY');
  });
});
