import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffRoadmap } from './roadmap-diff.js';

function team(stories) {
    return { epics: [{ name: 'E1', epicId: 'e1', stories }] };
}

function story(over = {}) {
    return {
        title: 'S',
        storyId: 's1',
        startDate: '01/01/26',
        endDate: '31/03/26',
        isAtRisk: false,
        isDone: false,
        isCancelled: false,
        isNewStory: false,
        isProposed: false,
        isTransferredIn: false,
        isTransferredOut: false,
        roadmapChanges: { changes: [] },
        ...over,
    };
}

test('no changes -> empty', () => {
    assert.deepEqual(diffRoadmap(team([story()]), team([story()])), []);
});

test('end-date move', () => {
    const d = diffRoadmap(
        team([story({ endDate: '15/05/26' })]),
        team([story({ endDate: '30/05/26' })])
    );
    assert.deepEqual(d, [
        {
            type: 'date',
            storyId: 's1',
            title: 'S',
            prevEndDate: '15/05/26',
            newEndDate: '30/05/26',
        },
    ]);
});

test('At Risk on and off', () => {
    const off = team([story({ isAtRisk: false })]);
    const on = team([story({ isAtRisk: true })]);
    assert.deepEqual(diffRoadmap(off, on), [
        { type: 'status', storyId: 's1', title: 'S', status: 'atrisk', on: true },
    ]);
    assert.deepEqual(diffRoadmap(on, off), [
        { type: 'status', storyId: 's1', title: 'S', status: 'atrisk', on: false },
    ]);
});

test('changelog growth reports the added count', () => {
    const a = team([story({ roadmapChanges: { changes: [{}] } })]);
    const b = team([story({ roadmapChanges: { changes: [{}, {}, {}] } })]);
    assert.deepEqual(diffRoadmap(a, b), [
        { type: 'changelog', storyId: 's1', title: 'S', addedCount: 2 },
    ]);
});

test('multiple changes on one story coalesce into one diff', () => {
    const a = team([story({ endDate: '15/05/26', isAtRisk: true })]);
    const b = team([story({ endDate: '30/05/26', isAtRisk: false })]);
    const d = diffRoadmap(a, b);
    assert.equal(d.length, 2);
    assert.ok(d.some((c) => c.type === 'date' && c.newEndDate === '30/05/26'));
    assert.ok(d.some((c) => c.type === 'status' && c.status === 'atrisk' && c.on === false));
});

test('new story since baseline is reported only when flagged', () => {
    const a = team([story()]);
    const b = team([story(), story({ storyId: 's2', title: 'New', isNewStory: true })]);
    assert.deepEqual(diffRoadmap(a, b), [
        { type: 'status', storyId: 's2', title: 'New', status: 'newstory', on: true },
    ]);
});

test('handles missing/empty shapes safely', () => {
    assert.deepEqual(diffRoadmap(null, null), []);
    assert.deepEqual(diffRoadmap({}, {}), []);
    assert.deepEqual(diffRoadmap({ epics: [] }, { epics: [] }), []);
});
