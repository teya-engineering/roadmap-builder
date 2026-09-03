// Pure formatter: turns the change records from roadmap-diff.js into the Slack
// message text posted on save. Uses Slack mrkdwn + :emoji: shortcodes and a
// blank-line-free block-per-change layout. No DOM/window access so it stays
// unit-testable under `node --test`.

import { parseEuropean } from './dates.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const EMOJI = Object.freeze({
    date: ':calendar:',
    status: ':loudspeaker:',
    changelog: ':memo:',
});

// status key -> wording for the on/off transition.
const STATUS_TEXT = Object.freeze({
    atrisk: { on: 'At Risk', off: 'No longer At Risk' },
    done: { on: 'Marked Done', off: 'No longer Done' },
    cancelled: { on: 'Cancelled', off: 'No longer Cancelled' },
    newstory: { on: 'New story', off: 'No longer marked New' },
    proposed: { on: 'Proposed', off: 'No longer Proposed' },
    transferredin: { on: 'Transferred In', off: 'No longer Transferred In' },
    transferredout: { on: 'Transferred Out', off: 'No longer Transferred Out' },
});

// '31/05/26' -> '31 May'. Falls back to the raw string when unparseable.
function shortDate(dateStr) {
    if (!dateStr) return '';
    const normalized = String(dateStr).replace(/-/g, '/');
    const d = parseEuropean(normalized);
    if (!(d instanceof Date) || Number.isNaN(d.getTime()) || d.getTime() === 0) {
        return String(dateStr);
    }
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// '22 May 2026, 15:56'
function formatTimestamp(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

function detailLine(change) {
    switch (change.type) {
        case 'date':
            return `End date moved  ${shortDate(change.prevEndDate)}  →  ${shortDate(change.newEndDate)}`;
        case 'status': {
            const text = STATUS_TEXT[change.status];
            if (!text) return change.on ? 'Status changed' : 'Status cleared';
            return change.on ? text.on : text.off;
        }
        case 'changelog': {
            const n = change.addedCount || 1;
            return `${n} new roadmap change ${n === 1 ? 'entry' : 'entries'} added`;
        }
        default:
            return '';
    }
}

/**
 * Render the Slack message for a set of changes. Returns '' when there are no
 * changes (the caller should skip sending).
 *
 * @param {object} [opts]
 * @param {string} [opts.teamName]
 * @param {Array<object>} [opts.changes] - records from diffRoadmap()
 * @param {string[]} [opts.authors] - e.g. [em, pm]; empty/falsy entries dropped
 * @param {Date} [opts.savedAt]
 * @returns {string}
 */
export function formatSlackMessage({ teamName, changes, authors = [], savedAt } = {}) {
    if (!Array.isArray(changes) || changes.length === 0) return '';

    const lines = [`*Roadmap Update - ${teamName || 'Untitled'}*`];

    for (const change of changes) {
        const emoji = EMOJI[change.type] || ':information_source:';
        lines.push(`${emoji}  ${change.title || ''}`);
        lines.push(detailLine(change));
    }

    const who = authors.filter(Boolean).join('  ·  ');
    const stamp = formatTimestamp(savedAt);
    lines.push(who ? `:bust_in_silhouette: ${who}  ·  ${stamp}` : `:bust_in_silhouette: ${stamp}`);

    return lines.join('\n');
}
