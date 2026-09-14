import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { init } from './imo-search.js';

const viewDirectory = new URL('./', import.meta.url);

test('project exclusions work alongside the other cross-team search filters', (t) => {
    const controls = Object.fromEntries(
        Object.entries({
            searchInput: '!CP* && !Bet*',
            titleSearchInput: 'Keep',
            directorVPIdSearchInput: '',
            endDateInput: '2026-09-30',
            searchModeSelect: 'range',
            advancedFilterExpression: '!Done',
        }).map(([id, value]) => [id, { value, addEventListener() {} }])
    );
    const viewWindow = { location: { search: '' }, addEventListener() {} };
    const viewDocument = {
        addEventListener() {},
        getElementById(id) {
            if (id === 'searchFlagUK') return { checked: true };
            return controls[id] || null;
        },
    };
    for (const [name, value] of Object.entries({ window: viewWindow, document: viewDocument })) {
        const original = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { value, configurable: true });
        t.after(() => {
            if (original) Object.defineProperty(globalThis, name, original);
            else Reflect.deleteProperty(globalThis, name);
        });
    }
    const errors = t.mock.method(console, 'error');
    const cleanup = init(null);
    t.after(cleanup);

    const common = { title: 'Keep project', countryFlags: ['UK'], endDate: '15/09/26' };
    const stories = [
        { ...common, imo: 'CP-123' },
        { ...common, imo: 'Bet 42' },
        { ...common, imo: 'IMO-1' },
        { ...common },
        { ...common, imo: 'IMO-2', isDone: true },
        { ...common, imo: 'IMO-3', countryFlags: ['Portugal'] },
        { ...common, imo: 'IMO-4', endDate: '01/10/26' },
        { ...common, imo: 'IMO-5', title: 'Different title' },
    ];

    assert.deepEqual(
        Reflect.get(viewWindow, 'applyAdditionalFilters')(stories, []),
        stories.slice(2, 4)
    );
    assert.equal(errors.mock.calls.length, 0);
});

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
