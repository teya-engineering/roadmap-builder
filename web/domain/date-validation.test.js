import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isImpossibleDate } from './dates.js';
import { describeImpossibleDates, findImpossibleDates } from './date-validation.js';

test('isImpossibleDate flags days the calendar does not have', () => {
    assert.equal(isImpossibleDate('31/06/26'), true);
    assert.equal(isImpossibleDate('30/02/2026'), true);
    assert.equal(isImpossibleDate('29/02/25'), true);
    assert.equal(isImpossibleDate('2026-06-31'), true);
    assert.equal(isImpossibleDate('2026-13-01'), true);
});

test('isImpossibleDate accepts real dates', () => {
    assert.equal(isImpossibleDate('30/06/26'), false);
    assert.equal(isImpossibleDate('29/02/24'), false);
    assert.equal(isImpossibleDate('2026-06-30'), false);
    assert.equal(isImpossibleDate('1-3-26'), false);
});

test('isImpossibleDate uses the roadmap year for dates without one', () => {
    assert.equal(isImpossibleDate('29/02', 2024), false);
    assert.equal(isImpossibleDate('29/02', 2026), true);
});

test('isImpossibleDate ignores values that are not dates', () => {
    assert.equal(isImpossibleDate('MAR'), false);
    assert.equal(isImpossibleDate(''), false);
    assert.equal(isImpossibleDate(null), false);
    assert.equal(isImpossibleDate(undefined), false);
});

test('findImpossibleDates returns nothing for a clean roadmap', () => {
    const teamData = {
        roadmapYear: 2026,
        epics: [
            {
                stories: [
                    {
                        title: 'A',
                        startDate: '01/04/26',
                        endDate: '30/06/26',
                        roadmapChanges: {
                            changes: [{ date: '01/05/26', prevEndDate: 'MAY', newEndDate: 'JUN' }],
                            doneInfo: { date: '05/06/26', notes: '' },
                            cancelInfo: null,
                        },
                    },
                    { title: 'B', startMonth: 'JAN', endMonth: 'MAR' },
                ],
            },
        ],
        btlSwimlane: { stories: [] },
    };
    assert.deepEqual(findImpossibleDates(teamData), []);
});

test('findImpossibleDates reports story, change, status and BTL dates', () => {
    const teamData = {
        roadmapYear: 2026,
        epics: [
            {
                stories: [
                    {
                        title: 'Reliability exercise',
                        startDate: '01/04/26',
                        endDate: '31/06/26',
                        roadmapChanges: {
                            changes: [{ date: '30/02/26', newEndDate: '30/06/26' }],
                            infoInfo: [
                                { date: '10/04/26', notes: 'ok' },
                                { date: '31/04/26', notes: 'bad' },
                            ],
                        },
                    },
                ],
            },
        ],
        btlSwimlane: { stories: [{ title: 'Later', dateAdded: '31/09/26' }] },
    };
    assert.deepEqual(findImpossibleDates(teamData), [
        { story: 'Reliability exercise', field: 'end date', value: '31/06/26' },
        { story: 'Reliability exercise', field: 'timeline change date', value: '30/02/26' },
        { story: 'Reliability exercise', field: 'info date', value: '31/04/26' },
        { story: 'Later', field: 'date added', value: '31/09/26' },
    ]);
});

test('findImpossibleDates copes with missing sections', () => {
    assert.deepEqual(findImpossibleDates({}), []);
    assert.deepEqual(findImpossibleDates(null), []);
    assert.deepEqual(findImpossibleDates({ epics: [{ stories: [null] }] }), []);
});

test('describeImpossibleDates lists each problem under a one-line summary', () => {
    const one = describeImpossibleDates([{ story: 'A', field: 'end date', value: '31/06/26' }]);
    assert.equal(one, '1 date does not exist on the calendar\n\n- "A": end date 31/06/26');

    const two = describeImpossibleDates([
        { story: 'A', field: 'end date', value: '31/06/26' },
        { story: 'B', field: 'done date', value: '30/02/26' },
    ]);
    assert.equal(two.split('\n')[0], '2 dates do not exist on the calendar');
    assert.match(two, /- "B": done date 30\/02\/26$/);
});
