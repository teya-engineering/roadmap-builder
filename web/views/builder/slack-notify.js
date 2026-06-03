// Slack save-notifier. On each successful roadmap save it diffs the current
// team data against an in-memory baseline (the data as of the last notify, or
// the most recent file load) and POSTs a human-readable summary to the
// same-origin proxy at /api/roadmap-saved, which forwards it to Slack.
//
// Manual saves flush immediately. Auto-saves (debounced ~1.5s while typing)
// are coalesced: the first auto-save arms a timer and the message is sent when
// it fires, diffing baseline -> latest. Because the diff is always
// baseline-vs-current at flush time, coalescing needs no per-change
// accumulator - intermediate edits merge into one message for free.
//
// Delivery is best-effort and never blocks or fails the local save: a missing
// webhook (server returns 204) or a network error is logged to the console and
// otherwise ignored.

import { getState } from './state.js';
import { diffRoadmap } from '../../domain/roadmap-diff.js';
import { formatSlackMessage } from '../../domain/slack-message.js';

const ENDPOINT = '/api/roadmap-saved';
const COALESCE_MS = 5 * 60 * 1000; // at most one coalesced auto-save message / 5 min

let baseline = null; // clone of teamData as of the last notify / file load
let coalesceTimer = null;
let listenersAttached = false;

function clone(state) {
    if (state == null) return null;
    try {
        return structuredClone(state);
    } catch {
        return JSON.parse(JSON.stringify(state));
    }
}

// init() runs on every builder re-mount. Re-seed the baseline each time (cheap,
// and keeps it current), but attach the window-scoped listeners only once.
export function init() {
    baseline = clone(getState());
    if (listenersAttached) return;
    listenersAttached = true;

    // Reset the baseline only when a roadmap is fully loaded (file load, new
    // roadmap, or the default template). builder.js fires roadmap:loaded once
    // the load has finished syncing state.
    //
    // We deliberately do NOT key off the state store's 'replace' notification:
    // that also fires on every live edit (generatePreview re-collects the form
    // and calls setState on each keystroke) and on the save path itself
    // (prepareRoadmapForSave -> setState). Resetting the baseline there would
    // keep it pinned to the current state, making every diff empty.
    document.addEventListener('roadmap:loaded', () => {
        baseline = clone(getState());
    });

    document.addEventListener('roadmap:saved', (e) => {
        const isAuto = !!(e && e.detail && e.detail.auto);
        if (isAuto) {
            if (!coalesceTimer) coalesceTimer = setTimeout(flushNow, COALESCE_MS);
        } else {
            flushNow();
        }
    });
}

async function flushNow() {
    if (coalesceTimer) {
        clearTimeout(coalesceTimer);
        coalesceTimer = null;
    }
    const current = getState();
    if (!current) return;

    const changes = diffRoadmap(baseline, current);
    // Advance the baseline regardless of delivery outcome so the next flush
    // diffs from here and we never re-report the same change.
    baseline = clone(current);
    if (changes.length === 0) return;

    const text = formatSlackMessage({
        teamName: current.teamName,
        changes,
        authors: [current.em, current.pm],
        savedAt: new Date(),
    });
    if (!text) return;

    try {
        await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
    } catch (err) {
        // Best-effort: the local save already succeeded. Don't surface this.
        console.warn('Slack save-notify failed:', err);
    }
}
