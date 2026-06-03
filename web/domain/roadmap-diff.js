// Pure diff between two roadmap teamData snapshots. Produces a flat list of
// human-meaningful changes (end-date moves, status flips, new changelog
// entries) for the Slack save-notifier. No DOM/window access so it stays
// unit-testable under `node --test`.

// Story status booleans -> the short status key used by the message formatter.
const STATUS_FLAGS = Object.freeze({
    isAtRisk: 'atrisk',
    isDone: 'done',
    isCancelled: 'cancelled',
    isNewStory: 'newstory',
    isProposed: 'proposed',
    isTransferredIn: 'transferredin',
    isTransferredOut: 'transferredout',
});

// Flatten epics[].stories[] into a Map keyed by storyId.
function indexStories(teamData) {
    const map = new Map();
    const epics = teamData && Array.isArray(teamData.epics) ? teamData.epics : [];
    for (const epic of epics) {
        const stories = epic && Array.isArray(epic.stories) ? epic.stories : [];
        for (const story of stories) {
            if (story && story.storyId != null) map.set(story.storyId, story);
        }
    }
    return map;
}

function changesCount(story) {
    const changes = story && story.roadmapChanges && story.roadmapChanges.changes;
    return Array.isArray(changes) ? changes.length : 0;
}

/**
 * Diff two teamData snapshots, matching stories by storyId.
 *
 * @param {object|null} prevTeamData - baseline snapshot
 * @param {object|null} nextTeamData - current snapshot
 * @returns {Array<object>} change records, one per detected change:
 *   { type:'date',      storyId, title, prevEndDate, newEndDate }
 *   { type:'status',    storyId, title, status, on }
 *   { type:'changelog', storyId, title, addedCount }
 */
export function diffRoadmap(prevTeamData, nextTeamData) {
    const prev = indexStories(prevTeamData);
    const next = indexStories(nextTeamData);
    const changes = [];

    for (const [storyId, story] of next) {
        const before = prev.get(storyId);
        const title = story.title || '';

        // Story is new since the baseline: there's nothing to diff against, so
        // only surface it when it's explicitly flagged as a new story.
        if (!before) {
            if (story.isNewStory) {
                changes.push({ type: 'status', storyId, title, status: 'newstory', on: true });
            }
            continue;
        }

        // End-date move.
        if ((before.endDate || '') !== (story.endDate || '')) {
            changes.push({
                type: 'date',
                storyId,
                title,
                prevEndDate: before.endDate || '',
                newEndDate: story.endDate || '',
            });
        }

        // Status flips (on and off).
        for (const [flag, status] of Object.entries(STATUS_FLAGS)) {
            const was = !!before[flag];
            const now = !!story[flag];
            if (was !== now) changes.push({ type: 'status', storyId, title, status, on: now });
        }

        // New changelog entries.
        const added = changesCount(story) - changesCount(before);
        if (added > 0) changes.push({ type: 'changelog', storyId, title, addedCount: added });
    }

    return changes;
}
