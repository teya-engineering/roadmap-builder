import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatSlackMessage } from './slack-message.js';

const SAVED = new Date(2026, 4, 22, 15, 56); // 22 May 2026, 15:56

test('empty changes -> empty string', () => {
    assert.equal(formatSlackMessage({ teamName: 'X', changes: [] }), '');
    assert.equal(formatSlackMessage({ teamName: 'X', changes: null }), '');
});

test('date move renders short dates with an arrow + bold header + footer', () => {
    const msg = formatSlackMessage({
        teamName: 'Product Team',
        changes: [
            {
                type: 'date',
                title: 'Important Project Name',
                prevEndDate: '15/05/26',
                newEndDate: '30/05/26',
            },
        ],
        authors: ['John Citizen', 'Jane Doe'],
        savedAt: SAVED,
    });
    assert.match(msg, /^\*Roadmap Update - Product Team\*/);
    assert.match(msg, /:calendar: {2}Important Project Name/);
    assert.match(msg, /End date moved {2}15 May {2}→ {2}30 May/);
    assert.match(
        msg,
        /:bust_in_silhouette: John Citizen {2}· {2}Jane Doe {2}· {2}22 May 2026, 15:56/
    );
});

test('status-off wording', () => {
    const msg = formatSlackMessage({
        teamName: 'T',
        changes: [{ type: 'status', title: 'S', status: 'atrisk', on: false }],
        savedAt: SAVED,
    });
    assert.match(msg, /:loudspeaker: {2}S\nNo longer At Risk/);
});

test('changelog pluralization', () => {
    const one = formatSlackMessage({
        teamName: 'T',
        changes: [{ type: 'changelog', title: 'S', addedCount: 1 }],
        savedAt: SAVED,
    });
    const many = formatSlackMessage({
        teamName: 'T',
        changes: [{ type: 'changelog', title: 'S', addedCount: 3 }],
        savedAt: SAVED,
    });
    assert.match(one, /1 new roadmap change entry added/);
    assert.match(many, /3 new roadmap change entries added/);
});

test('footer without authors still has the timestamp', () => {
    const msg = formatSlackMessage({
        teamName: 'T',
        changes: [{ type: 'changelog', title: 'S', addedCount: 1 }],
        authors: [null, ''],
        savedAt: SAVED,
    });
    assert.match(msg, /:bust_in_silhouette: 22 May 2026, 15:56/);
});

test('unparseable date falls back to the raw string', () => {
    const msg = formatSlackMessage({
        teamName: 'T',
        changes: [{ type: 'date', title: 'S', prevEndDate: 'TBD', newEndDate: '30/05/26' }],
        savedAt: SAVED,
    });
    assert.match(msg, /End date moved {2}TBD {2}→ {2}30 May/);
});
