import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewDirectory = new URL('./', import.meta.url);

test('cross-team search follows the shared design system', async () => {
    const [html, css, javascript] = await Promise.all([
        readFile(new URL('imo-search.html', viewDirectory), 'utf8'),
        readFile(new URL('imo-search.css', viewDirectory), 'utf8'),
        readFile(new URL('imo-search.js', viewDirectory), 'utf8'),
    ]);

    assert.match(html, /class="search-filter-grid"/);
    assert.match(html, /id="searchStatsModal" class="modal"/);
    assert.doesNotMatch(css, /^\.modal\s*\{/m);

    for (const token of [
        '--surface-0',
        '--surface-1',
        '--text-strong',
        '--text-default',
        '--text-muted',
        '--border-subtle',
        '--primary',
    ]) {
        assert.match(css, new RegExp(`var\\(${token}\\)`));
    }

    const renderedUi = html + javascript;
    for (const legacyColor of [
        '#007cba',
        '#005a87',
        '#333',
        '#666',
        '#888',
        '#999',
        '#374151',
        '#6b7280',
        '#e5e7eb',
        '#f8f9fa',
        '#f9f9f9',
        '#ffffff',
    ]) {
        assert.doesNotMatch(renderedUi, new RegExp(legacyColor, 'i'));
    }
});
