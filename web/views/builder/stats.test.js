import test from 'node:test';
import assert from 'node:assert/strict';

import { createStatsHandlers } from './stats.js';

test('stats content uses theme-aware colors', () => {
    const handlers = createStatsHandlers({ collectFormData: () => ({}) });
    const story = { teamName: 'Payments', epicName: 'Checkout', title: 'Retry payments' };
    const stats = {
        totalEpics: 1,
        totalStories: 4,
        onTime: 1,
        totalDelayed: 1,
        accelerated: 1,
        cancelled: 1,
        onTimeStories: { done: [story], notDone: [] },
        acceleratedStories: { done: [], notDone: [story] },
        cancelledStories: [story],
        delayBreakdown: { 1: 1 },
        delayStories: { 1: { done: [story], notDone: [] } },
    };

    const html = [
        handlers.renderStatsHtml(stats),
        handlers.renderOntimeBreakdown(stats, stats.totalStories),
        handlers.renderAcceleratedBreakdown(stats, stats.totalStories),
        handlers.renderCancelledBreakdown(stats),
        handlers.renderDelayBreakdown(stats, stats.totalStories),
        handlers.card('Total', stats.totalStories),
    ].join('');

    assert.match(html, /var\(--surface-0\)/);
    assert.match(html, /var\(--surface-1\)/);
    assert.match(html, /var\(--text-strong\)/);
    assert.match(html, /var\(--text-default\)/);
    assert.match(html, /var\(--text-muted\)/);
    assert.match(html, /var\(--stats-on-time\)/);
    assert.match(html, /var\(--stats-delayed\)/);
    assert.match(html, /var\(--stats-accelerated\)/);
    assert.match(html, /var\(--stats-cancelled\)/);
    assert.match(html, /var\(--stats-pending\)/);

    for (const fixedNeutral of [
        '#333',
        '#666',
        '#999',
        '#111827',
        '#374151',
        '#6b7280',
        '#e5e7eb',
        '#f9fafb',
        '#fafafa',
        '#ffffff',
    ]) {
        assert.doesNotMatch(html, new RegExp(fixedNeutral, 'i'));
    }
});

function teamWithFte(stories) {
    return { epics: [{ name: 'Acceptance', stories }] };
}

test('people roll-up sums only stories that have an FTE', () => {
    const handlers = createStatsHandlers({ collectFormData: () => ({}) });
    const stats = handlers.computeRoadmapStats(
        teamWithFte([{ title: 'a', fte: 1.5 }, { title: 'b', fte: 2 }, { title: 'c' }])
    );

    assert.equal(stats.people.total, 3.5);
    assert.equal(stats.people.counted, 2);
    assert.equal(stats.people.eligible, 3);
    assert.deepEqual(stats.people.byEpic, [{ name: 'Acceptance', fte: 3.5 }]);
});

test('people roll-up counts a zero FTE and excludes cancelled stories', () => {
    const handlers = createStatsHandlers({ collectFormData: () => ({}) });
    const stats = handlers.computeRoadmapStats(
        teamWithFte([
            { title: 'a', fte: 0 },
            { title: 'b', fte: 1 },
            { title: 'c', fte: 4, isCancelled: true },
        ])
    );

    assert.equal(stats.people.total, 1);
    assert.equal(stats.people.counted, 2);
    assert.equal(stats.people.eligible, 2);
});

test('people roll-up splits the total per EPIC, biggest first', () => {
    const handlers = createStatsHandlers({ collectFormData: () => ({}) });
    const stats = handlers.computeRoadmapStats({
        epics: [
            { name: 'Settlement', stories: [{ title: 'a', fte: 0.5 }] },
            { name: 'Acceptance', stories: [{ title: 'b', fte: 3.5 }] },
            { name: 'Unstaffed', stories: [{ title: 'c' }] },
        ],
    });

    assert.deepEqual(stats.people.byEpic, [
        { name: 'Acceptance', fte: 3.5 },
        { name: 'Settlement', fte: 0.5 },
    ]);

    const html = handlers.renderPeopleHtml(stats.people);
    assert.match(html, /People on this roadmap/);
    assert.match(html, />4</);
    assert.match(html, /FTE across 2 of 3 stories/);
    assert.match(html, /Acceptance/);
});

test('people roll-up renders nothing when no story is staffed', () => {
    const handlers = createStatsHandlers({ collectFormData: () => ({}) });
    const stats = handlers.computeRoadmapStats(teamWithFte([{ title: 'a' }]));

    assert.equal(stats.people.counted, 0);
    assert.match(handlers.renderPeopleHtml(stats.people), /No FTE set on any story yet/);
    assert.equal(handlers.renderPeopleHtml({ total: 0, counted: 0, eligible: 0, byEpic: [] }), '');
});
