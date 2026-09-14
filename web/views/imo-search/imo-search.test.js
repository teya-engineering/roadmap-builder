import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { init } from './imo-search.js';

const viewDirectory = new URL('./', import.meta.url);

function mountSearchView(t, controls = {}) {
    for (const id of ['searchInput', 'titleSearchInput', 'directorVPIdSearchInput']) {
        controls[id] ??= { value: '', addEventListener() {} };
    }
    const viewWindow = { location: { search: '' }, addEventListener() {} };
    const viewDocument = {
        addEventListener() {},
        getElementById(id) {
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
    const cleanup = init(null);
    t.after(cleanup);
    return viewWindow;
}

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
    const errors = t.mock.method(console, 'error');
    const viewWindow = mountSearchView(t, { ...controls, searchFlagUK: { checked: true } });

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

test('advanced IMO wildcards include prefixes and exclude IMO2 stories', (t) => {
    const controls = {
        advancedFilterExpression: { value: 'IMO* && !IMO2*', addEventListener() {} },
    };
    const errors = t.mock.method(console, 'error');
    const viewWindow = mountSearchView(t, controls);
    const stories = [
        { imo: 'IMO1', isDone: true },
        { imo: ' imo10 ', priority: 'High' },
        { imo: 'IMO3' },
        { imo: 'IMO2' },
        { imo: 'IMO20' },
        { imo: 'CP-1' },
        { imo: '' },
        { imo: null },
        {},
    ];

    for (const { expression, expected } of [
        { expression: 'IMO* && !IMO2*', expected: stories.slice(0, 3) },
        { expression: 'imo*&&!imo2*', expected: stories.slice(0, 3) },
        { expression: 'IMO && !IMO2', expected: stories.slice(0, 3) },
        { expression: 'IMO1', expected: stories.slice(0, 2) },
        { expression: 'IMO1*', expected: stories.slice(0, 2) },
        { expression: '!IMO*', expected: stories.slice(5) },
        { expression: '(IMO1* || IMO3*) && !Done', expected: stories.slice(1, 3) },
        { expression: 'IMO* && !IMO2* && High', expected: [stories[1]] },
    ]) {
        controls.advancedFilterExpression.value = expression;
        assert.deepEqual(
            Reflect.get(viewWindow, 'applyAdditionalFilters')(stories, []),
            expected,
            expression
        );
    }
    assert.equal(errors.mock.calls.length, 0);
});

test('advanced IMO prefixes leave quoted field values literal', (t) => {
    const errors = t.mock.method(console, 'error');
    const viewWindow = mountSearchView(t);
    const evaluate = Reflect.get(viewWindow, 'evaluateFilterExpression');
    const story = { imo: 'IMO1', title: 'IMO2* launch', teamName: 'IMO2 team' };

    assert.equal(evaluate('TITLE="IMO2*" && IMO1*', story), true);
    assert.equal(evaluate('TEAM="IMO2" && IMO1', story), true);
    assert.equal(evaluate('TITLE="IMO1"', story), false);
    assert.equal(evaluate('IMO="1"', story), true);
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
