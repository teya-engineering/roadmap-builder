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
