import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IMOUtility } from './imo-utility.js';

function roadmapFile({
    fileName = 'team.json',
    teamName = 'Payments',
    roadmapYear = undefined,
    stories,
}) {
    return {
        fileName,
        teamData: {
            teamName,
            roadmapYear,
            epics: [{ name: 'Delivery', stories }],
        },
    };
}

test('aggregateStoriesAcrossTeams uses the supplied year when a roadmap has none', () => {
    const stories = IMOUtility.aggregateStoriesAcrossTeams(
        [roadmapFile({ stories: [{ title: 'Reconciliation', endMonth: 'JUN' }] })],
        2030
    );

    assert.equal(stories.length, 1);
    assert.equal(stories[0].roadmapYear, 2030);
});

test('aggregateStoriesAcrossTeams prefers each roadmap year over the supplied year', () => {
    const stories = IMOUtility.aggregateStoriesAcrossTeams(
        [roadmapFile({ roadmapYear: 2028, stories: [{ title: 'Reconciliation' }] })],
        2030
    );

    assert.equal(stories[0].roadmapYear, 2028);
});

test('aggregateStoriesAcrossTeams keeps the newest duplicate roadmap', () => {
    const stories = IMOUtility.aggregateStoriesAcrossTeams([
        roadmapFile({
            fileName: 'payments.2028.json',
            roadmapYear: 2028,
            stories: [{ title: 'Reconciliation', endMonth: 'JUN' }],
        }),
        roadmapFile({
            fileName: 'payments.2029.json',
            roadmapYear: 2029,
            stories: [{ title: 'Reconciliation', endMonth: 'JUL' }],
        }),
    ]);

    assert.equal(stories.length, 1);
    assert.equal(stories[0].roadmapYear, 2029);
    assert.equal(stories[0].endMonth, 'JUL');
});

test('story date conversion supports named months through one validated parser', () => {
    assert.equal(IMOUtility.convertStoryDateToISO('15/AUG/25', 2030), '2025-08-15');
    assert.equal(IMOUtility.convertStoryDateToISO('AUG 2025', 2030), '2025-08-01');
    assert.equal(IMOUtility.convertStoryDateToISO('AUG', 2030), '2030-08-01');
    assert.equal(IMOUtility.convertStoryDateToISO('31/02/25', 2030), null);
    assert.equal(IMOUtility.convertStoryDateToISO('2025-02-29', 2030), null);
});

test('filterStoriesByEndDate uses the story roadmap year for dates without a year', () => {
    const stories = [
        { title: 'Match', endDate: '15/06', roadmapYear: 2027 },
        { title: 'Different day', endDate: '16/06', roadmapYear: 2027 },
    ];

    assert.deepEqual(
        IMOUtility.filterStoriesByEndDate(stories, '15/06').map((story) => story.title),
        ['Match']
    );
});
