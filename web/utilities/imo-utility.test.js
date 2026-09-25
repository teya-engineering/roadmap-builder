import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IMOUtility } from './imo-utility.js';

const projectStories = [
    { title: 'Core project', imo: 'CP-123' },
    { title: 'Another core project', imo: ' cp456 ' },
    { title: 'Bet project', imo: 'Bet 42' },
    { title: 'Another bet project', imo: 'BET-99' },
    { title: 'Other project', imo: 'IMO-0043' },
    { title: 'Prefix inside ID', imo: 'Project-CP-Bet' },
    { title: 'Empty ID', imo: '' },
    { title: 'Blank ID', imo: '  ' },
    { title: 'Null ID', imo: null },
    { title: 'Missing ID' },
];

test('project ID exclusions remove both prefixes and keep stories without IDs', () => {
    for (const query of ['!CP* && !Bet*', ' !cp && !BET ', '!CP*||!Bet*']) {
        assert.deepEqual(
            IMOUtility.filterStoriesByIMO(projectStories, query),
            projectStories.slice(4),
            query
        );
    }
});

test('project ID searches support single exclusions and positive alternatives', () => {
    assert.deepEqual(
        IMOUtility.filterStoriesByIMO(projectStories, '!CP*'),
        projectStories.slice(2)
    );
    assert.deepEqual(
        IMOUtility.filterStoriesByIMO(projectStories, 'CP* || Bet*'),
        projectStories.slice(0, 4)
    );
    for (const query of ['CP* || Bet* && !CP*', 'CP* || Bet* || !CP*']) {
        assert.deepEqual(
            IMOUtility.filterStoriesByIMO(projectStories, query),
            projectStories.slice(2, 4)
        );
    }
});

test('project ID searches preserve plain prefixes, numeric substrings, and all IDs', () => {
    for (const query of ['CP', ' cp* ']) {
        assert.deepEqual(
            IMOUtility.filterStoriesByIMO(projectStories, query),
            projectStories.slice(0, 2)
        );
    }
    assert.deepEqual(IMOUtility.filterStoriesByIMO(projectStories, '0043'), [projectStories[4]]);
    for (const query of ['all', '*', 'all && !CP* && !Bet*']) {
        const start = query.includes('!') ? 4 : 0;
        assert.deepEqual(
            IMOUtility.filterStoriesByIMO(projectStories, query),
            projectStories.slice(start, 6)
        );
    }
});

test('explicit numeric wildcards match prefixes and treat punctuation literally', () => {
    const stories = [
        { title: 'Numeric prefix', imo: '0043-CP' },
        { title: 'Numeric suffix', imo: 'CP-0043' },
        { title: 'Punctuation', imo: 'CP.1' },
        { title: 'No punctuation', imo: 'CPX1' },
        { title: 'Month as project prefix', imo: 'May-project' },
    ];

    assert.deepEqual(IMOUtility.filterStoriesByIMO(stories, '0043*'), [stories[0]]);
    assert.deepEqual(IMOUtility.filterStoriesByIMO(stories, 'CP.*'), [stories[2]]);
    assert.deepEqual(IMOUtility.filterStoriesByIMO(stories, 'May*'), [stories[4]]);
});

test('project ID filtering treats stories independently when titles match', () => {
    const stories = [
        { title: 'Same title', teamName: 'Payments', imo: 'CP-1' },
        { title: 'Same title', teamName: 'Payments', imo: 'IMO-2' },
    ];

    assert.deepEqual(IMOUtility.filterStoriesByIMO(stories, '!CP*'), [stories[1]]);
    assert.deepEqual(IMOUtility.filterStoriesByIMO(stories, 'CP* || IMO*'), stories);
});

test('empty or incomplete project ID queries do not return unrelated stories', () => {
    for (const query of ['', ' ', '!', '&&', '||', '!CP* &&', 'CP* || !']) {
        assert.deepEqual(IMOUtility.filterStoriesByIMO(projectStories, query), [], query);
    }
});

test('general search also recognizes explicit project ID wildcards', () => {
    for (const query of ['!CP* && !Bet*', '!CP* || !Bet*']) {
        assert.deepEqual(
            IMOUtility.searchStories(projectStories, query),
            projectStories.slice(4),
            query
        );
    }
    assert.deepEqual(
        IMOUtility.searchStories(projectStories, 'CP* || Bet*'),
        projectStories.slice(0, 4)
    );
    assert.deepEqual(
        IMOUtility.searchStories(projectStories, 'IMO CP*'),
        projectStories.slice(0, 2)
    );
});

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

test('parseSearchQuery reads a "CP <id>" query as a project ID search', () => {
    assert.deepEqual(IMOUtility.parseSearchQuery('CP 0043'), { type: 'imo', value: '0043' });
});

test('parseSearchQuery still accepts the legacy "IMO <id>" form', () => {
    assert.deepEqual(IMOUtility.parseSearchQuery('IMO 0043'), { type: 'imo', value: '0043' });
});
