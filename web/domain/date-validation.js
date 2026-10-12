// Finds dates in a roadmap that don't exist on the calendar. The renderer
// can't place such a date, so it falls back to the first column and draws
// the story and its status box in the wrong place. Rejecting them on save
// keeps them out of the files. No DOM access so it stays unit-testable
// under `node --test`.

import { isImpossibleDate } from './dates.js';

const STORY_FIELDS = [
    ['startDate', 'start date'],
    ['endDate', 'end date'],
    ['dateAdded', 'date added'],
];

const CHANGE_FIELDS = [
    ['date', 'timeline change date'],
    ['prevStartDate', 'timeline change previous start'],
    ['newStartDate', 'timeline change new start'],
    ['prevEndDate', 'timeline change previous end'],
    ['newEndDate', 'timeline change new end'],
];

const STATUS_FIELDS = [
    ['doneInfo', 'done date'],
    ['cancelInfo', 'cancelled date'],
    ['atRiskInfo', 'at risk date'],
    ['newStoryInfo', 'new story date'],
    ['infoInfo', 'info date'],
    ['transferredOutInfo', 'transferred out date'],
    ['transferredInInfo', 'transferred in date'],
    ['proposedInfo', 'proposed date'],
];

/**
 * @param {object} teamData  The roadmap's teamData object.
 * @returns {{ story: string, field: string, value: string }[]}
 */
export function findImpossibleDates(teamData) {
    const year = Number(teamData?.roadmapYear) || null;
    const stories = [
        ...(teamData?.epics ?? []).flatMap((epic) => epic?.stories ?? []),
        ...(teamData?.btlSwimlane?.stories ?? []),
    ];

    const problems = [];
    for (const story of stories) {
        if (!story) continue;
        const title = story.title || 'Untitled story';
        const check = (value, field) => {
            if (isImpossibleDate(value, year)) problems.push({ story: title, field, value });
        };

        for (const [key, label] of STORY_FIELDS) check(story[key], label);

        const rc = story.roadmapChanges;
        if (!rc) continue;
        for (const change of rc.changes ?? []) {
            for (const [key, label] of CHANGE_FIELDS) check(change?.[key], label);
        }
        for (const [key, label] of STATUS_FIELDS) {
            const entries = Array.isArray(rc[key]) ? rc[key] : [rc[key]];
            for (const entry of entries) check(entry?.date, label);
        }
    }
    return problems;
}

/**
 * A plain-text summary for alerts and status lines. The first line stands
 * on its own so it can be shown alone where space is short.
 *
 * @param {{ story: string, field: string, value: string }[]} problems
 * @returns {string}
 */
export function describeImpossibleDates(problems) {
    const count = problems.length;
    const lines = problems.map(({ story, field, value }) => `- "${story}": ${field} ${value}`);
    return `${count} ${count === 1 ? 'date does' : 'dates do'} not exist on the calendar\n\n${lines.join('\n')}`;
}
