// Story sorting toggles for the Builder. Two mutually-exclusive toggles
// reorder stories within each epic by start date or end date; turning both
// off restores the original order captured at first reorder.
//
// originalStoryOrders is internal to this module; storeOriginalStoryOrder
// is also called from loadTeamData (after a save file finishes loading) to
// snapshot the freshly-loaded order, so we expose it on the return value.
//
// The "force text below" toggle is a separate concern (its state is read
// cross-module by roadmap-generator.js) and stays in builder.js.

import { showToast } from './notifications.js';
import { ConfigUtility } from '../../utilities/config-utility.js';
import { DateUtility } from '../../utilities/date-utility.js';

/**
 * @param {object} deps
 * @param {(storyId: string) => any} deps.collectStoryData
 *        Reads a story's form fields into a plain object. Used during the
 *        in-place reorder to know each story's start/end dates.
 * @param {() => void} deps.generatePreview
 */
export function createSortingHandlers({ collectStoryData, generatePreview }) {
    /** @type {Map<string, string[]>} */
    const originalStoryOrders = new Map();

    function storeOriginalStoryOrder(epicId) {
        const epicEl = document.getElementById(`epic-${epicId}`);
        if (!epicEl) return;
        const order = Array.from(epicEl.querySelectorAll('.story-section')).map((el) => el.id);
        originalStoryOrders.set(epicId, order);
    }

    function reorderStoriesInUI(sortByEnd = false) {
        const year = parseInt(document.getElementById('roadmapYear').value) || 2025;
        const dateUtility = DateUtility;

        document.querySelectorAll('.epic-section').forEach((epicEl) => {
            const epicId = epicEl.id.split('-')[1];
            const storyEls = epicEl.querySelectorAll('.story-section');
            if (storyEls.length <= 1) return;

            // Snapshot the original order on the first sort attempt so we can
            // restore it later when both toggles are disabled.
            if (!originalStoryOrders.has(epicId)) storeOriginalStoryOrder(epicId);

            const stories = [];
            storyEls.forEach((el) => {
                const storyId = el.id.replace('story-', '');
                try {
                    const story = collectStoryData(storyId);
                    story._element = el;
                    stories.push(story);
                } catch {
                    // Skip stories whose form fields fail to read (partially-rendered).
                }
            });

            stories.sort((a, b) => {
                const aStart = a.startDate || a.startMonth || 'JAN';
                const bStart = b.startDate || b.startMonth || 'JAN';
                const aEnd = a.endDate || a.endMonth || 'MAR';
                const bEnd = b.endDate || b.endMonth || 'MAR';

                if (sortByEnd) {
                    const byEnd = dateUtility.compareDateOrMonth(aEnd, bEnd, year);
                    if (byEnd !== 0) return byEnd;
                    return dateUtility.compareDateOrMonth(aStart, bStart, year);
                }
                const byStart = dateUtility.compareDateOrMonth(aStart, bStart, year);
                if (byStart !== 0) return byStart;
                return dateUtility.compareDateOrMonth(aEnd, bEnd, year);
            });

            const container = document.getElementById(`stories-container-${epicId}`);
            if (container) {
                stories.forEach((story) => {
                    if (story._element) container.appendChild(story._element);
                });
            }
        });
    }

    function restoreOriginalStoryOrder() {
        document.querySelectorAll('.epic-section').forEach((epicEl) => {
            const epicId = epicEl.id.split('-')[1];
            const order = originalStoryOrders.get(epicId);
            if (!order) return;
            const container = document.getElementById(`stories-container-${epicId}`);
            if (!container) return;
            order.forEach((storyId) => {
                const el = document.getElementById(storyId);
                if (el) container.appendChild(el);
            });
        });
    }

    function showSortingNotification(isEnabled) {
        showToast(`Story sorting ${isEnabled ? 'ENABLED' : 'DISABLED'}`, {
            color: isEnabled ? '#28a745' : '#6c757d',
            topOffset: 60,
        });
    }

    function handleSortingToggle() {
        const startToggle = document.getElementById('story-sorting-toggle');
        if (!startToggle) return;
        const config = ConfigUtility;

        config.setSortStories(startToggle.checked);
        if (startToggle.checked) {
            // Mutex with the end-sort toggle.
            const endToggle = document.getElementById('story-sorting-end-toggle');
            if (endToggle) {
                endToggle.checked = false;
                config.setSortByEnd(false);
            }
            config.setSortByStart(true);
            reorderStoriesInUI();
        } else {
            config.setSortByStart(false);
            restoreOriginalStoryOrder();
        }

        generatePreview();
        showSortingNotification(startToggle.checked);
    }

    function handleEndSortingToggle() {
        const endToggle = document.getElementById('story-sorting-end-toggle');
        if (!endToggle) return;
        const config = ConfigUtility;

        config.setSortByEnd(endToggle.checked);
        if (endToggle.checked) {
            const startToggle = document.getElementById('story-sorting-toggle');
            if (startToggle) {
                startToggle.checked = false;
                config.setSortStories(false);
                config.setSortByStart(false);
            }
            reorderStoriesInUI(true);
        } else {
            restoreOriginalStoryOrder();
        }

        generatePreview();
        showSortingNotification(endToggle.checked);
    }

    return {
        handleSortingToggle,
        handleEndSortingToggle,
        storeOriginalStoryOrder,
        reorderStoriesInUI,
        restoreOriginalStoryOrder,
        showSortingNotification,
    };
}
