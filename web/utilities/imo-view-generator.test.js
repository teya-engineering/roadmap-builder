import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IMOViewGenerator } from './imo-view-generator.js';

test('transformStoriesToRoadmapData keeps the story FTE', () => {
    const stories = [
        { title: 'With FTE', teamName: 'Alpha', startDate: '01/03/26', endDate: '30/04/26', fte: 1.5 },
        { title: 'Without FTE', teamName: 'Alpha', startDate: '01/03/26', endDate: '30/04/26' },
    ];

    const data = IMOViewGenerator.transformStoriesToRoadmapData(stories, 'CP');
    const byTitle = Object.fromEntries(
        data.epics.flatMap((epic) => epic.stories).map((story) => [story.title, story])
    );

    assert.equal(byTitle['With FTE'].fte, 1.5);
    assert.equal(byTitle['Without FTE'].fte, undefined);
});

test('transformStoriesToRoadmapData orders teams by the saved order', () => {
    const story = (teamName) => ({ title: teamName, teamName, startDate: '01/03/26', endDate: '30/04/26' });
    const stories = ['Alpha', 'Beta', 'Gamma'].map(story);

    const teamNames = (order) =>
        IMOViewGenerator.transformStoriesToRoadmapData(stories, 'CP', null, order).epics.map((epic) => epic.name);

    assert.deepEqual(teamNames(undefined), ['Alpha', 'Beta', 'Gamma']);
    assert.deepEqual(teamNames(['Gamma', 'Alpha']), ['Gamma', 'Alpha', 'Beta']);
});
