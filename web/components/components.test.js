import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const componentDirectory = new URL('./', import.meta.url);
const webDirectory = new URL('../', import.meta.url);

const read = (url) => readFile(url, 'utf8');

test('components are built from design tokens only', async () => {
    const css = await read(new URL('components.css', componentDirectory));

    // Mask declarations and the inline SVG icons they point at have to name a
    // literal colour, but a mask only supplies a shape - the colour that paints
    // comes from the element. Every other colour must be a token.
    const withoutMasks = css
        .replace(/^\s*-?(webkit-)?mask[^;]*;$/gm, '')
        .replace(/url\("data:image\/svg\+xml,[^"]*"\)/g, '');
    assert.doesNotMatch(withoutMasks, /#[0-9a-f]{3,8}\b/i);

    for (const token of [
        '--surface-0',
        '--text-muted',
        '--border-strong',
        '--primary',
        '--focus-ring',
        '--radius-sm',
        '--motion-fast',
    ]) {
        assert.match(css, new RegExp(`var\\(${token}\\)`));
    }
});

test('wrapped inputs are excluded from the standalone field box', async () => {
    const [styles, css] = await Promise.all([
        read(new URL('styles.css', webDirectory)),
        read(new URL('components.css', componentDirectory)),
    ]);

    // The wrapper draws the border and padding. If the base rule still matched
    // the input inside it, every search and number field would show two boxes.
    for (const rule of [':not(.ui-field__input)', ':not(.ui-number__input)']) {
        assert.match(styles, new RegExp(rule.replace(/[.()]/g, '\\$&')));
    }
    const baseFieldRule = styles.match(/input:not\(\[type='checkbox'\]\)[^{]*\{/)[0];
    for (const wrapper of ['.ui-field', '.ui-select', '.ui-number']) {
        assert.ok(baseFieldRule.includes(wrapper), `${wrapper} must share the field box`);
    }

    // Neither wrapper may reintroduce a border on the inner input.
    assert.match(css, /\.ui-field__input \{[^}]*border: 0;/s);
    assert.match(css, /\.ui-number__input \{[^}]*border: 0;/s);
});

test('the select keeps the native element as the source of truth', async () => {
    const select = await read(new URL('select.js', componentDirectory));

    // Every caller reads and writes `.value` on the original <select>, so it
    // has to stay in the document, out of the tab order, and in sync.
    assert.match(select, /wrapper\.appendChild\(select\)/);
    assert.match(select, /select\.tabIndex = -1/);
    assert.match(select, /Object\.defineProperty\(select, 'value'/);
    assert.match(select, /new Event\('change', \{ bubbles: true \}\)/);
    assert.doesNotMatch(select, /select\.remove\(\)/);

    // Detaching the focused menu fires blur, which closes again. The state has
    // to be cleared before the node leaves the document or the second pass
    // throws and swallows the change event.
    const close = select.match(/function close\(\{[^}]*\}[^)]*\) \{(.*?)\n {4}\}/s)[1];
    assert.ok(
        close.indexOf('menu = null') < close.indexOf('.remove()'),
        'close() must clear its state before removing the menu'
    );
});

test('enhancement skips the rendered roadmap', async () => {
    const index = await read(new URL('index.js', componentDirectory));

    // The preview is re-rendered on almost every keystroke and holds no form
    // controls, so walking it would be pure overhead.
    assert.match(index, /#roadmap-mount/);
    assert.match(index, /IGNORED_CONTAINERS/);
    assert.match(index, /new MutationObserver/);
});
