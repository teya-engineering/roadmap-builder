import { DateUtility } from '../../utilities/date-utility.js';

// Timeline change tracking. Two parallel implementations:
//   - createTimelineChangeHandlers: story-form rows, with per-story DOM ids
//     (changes-container-${storyId}, change-${changeId}-* fields).
//   - createEditTimelineChangeHandlers: Edit Story modal rows, with fixed
//     ids (editChangesContainer, edit-change-${n}-* fields).
//
// applyPendingTimelineChanges (the bulk apply driven by window.pendingTimeline*
// global state) stays in builder.js for now.

const MAX_CHANGES = 5;
const ADD_BUTTON_DISABLE_THRESHOLD = 4;

/**
 * @param {object} deps
 * @param {(element: Element) => void} deps.addListenersToElement
 *        Wires the auto-update listeners that refresh the preview on input.
 * @param {(element: Element, allowMonthOnly: boolean) => void} deps.initializeDatePicker
 *        Sets up a hidden native date input alongside the text input.
 * @param {() => string} deps.getToday  DD/MM/YY format.
 */
export function createTimelineChangeHandlers({
    addListenersToElement,
    initializeDatePicker,
    getToday,
}) {
    // Module-local counter included in the change id alongside Date.now() to
    // disambiguate changes added within the same millisecond. Body code can
    // reset it via the returned resetCounter() to mirror the legacy behavior
    // of newRoadmap/loadRoadmap clearing it.
    let changeCounter = 0;

    function resetCounter() {
        changeCounter = 0;
    }

    function existingChanges(container, storyId) {
        return container.querySelectorAll(`div[id^="change-${storyId}-change-"]`);
    }

    function updateChangeButton(storyId) {
        const container = document.getElementById(`changes-container-${storyId}`);
        const addButton = document.getElementById(`add-change-btn-${storyId}`);
        if (!container || !addButton) return;

        if (existingChanges(container, storyId).length >= ADD_BUTTON_DISABLE_THRESHOLD) {
            addButton.disabled = true;
            addButton.textContent = '+ Add Change (Max 4 reached)';
            addButton.style.opacity = '0.5';
            addButton.style.cursor = 'not-allowed';
        } else {
            addButton.disabled = false;
            addButton.textContent = '+ Add Change';
            addButton.style.opacity = '1';
            addButton.style.cursor = 'pointer';
        }
    }

    function addChange(storyId) {
        const container = document.getElementById(`changes-container-${storyId}`);
        if (existingChanges(container, storyId).length >= MAX_CHANGES) return;

        const currentEndDateEl = document.getElementById(`story-end-${storyId}`);
        const currentEndDate = currentEndDateEl ? currentEndDateEl.value : '';
        const currentStartDateEl = document.getElementById(`story-start-${storyId}`);
        const currentStartDate = currentStartDateEl ? currentStartDateEl.value : '';

        const entryNumber = existingChanges(container, storyId).length + 1;
        changeCounter++;
        const changeId = `${storyId}-change-${Date.now()}-${changeCounter}`;

        container.insertAdjacentHTML('beforeend', `
            <div class="form-group" id="change-${changeId}" style="border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; border-radius: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <strong>Timeline #${entryNumber}</strong>
                    <button class="danger" onclick="removeChange('${changeId}', '${storyId}')" tabindex="-1">Remove</button>
                </div>
                <div class="inline-group">
                    <div class="form-group">
                        <label>Change Date:</label>
                        <input type="text" id="change-date-${changeId}" placeholder="15/12 or 15/12/24 or 15-12-2024" value="${getToday()}">
                    </div>
                    <div class="form-group">
                        <label>Description:</label>
                        <input type="text" id="change-desc-${changeId}" placeholder="Reason for change">
                    </div>
                </div>
                <div class="inline-group">
                    <div class="form-group">
                        <label>Previous Start Date:</label>
                        <input type="text" id="change-prevstart-${changeId}" placeholder="01/03 or 01-03" style="margin-bottom: 1px;" value="${currentStartDate}">
                    </div>
                    <div class="form-group">
                        <label>New Start Date:</label>
                        <input type="text" id="change-newstart-${changeId}" placeholder="15/03 or 15-03" style="margin-bottom: 1px;" value="${currentStartDate}">
                    </div>
                </div>
                <div class="inline-group">
                    <div class="form-group">
                        <label>Previous End Date:</label>
                        <input type="text" id="change-prev-${changeId}" placeholder="31/03 or 31-03" style="margin-bottom: 1px;" value="${currentEndDate}">
                    </div>
                    <div class="form-group">
                        <label>New End Date:</label>
                        <input type="text" id="change-new-${changeId}" placeholder="15/04 or 15-04" style="margin-bottom: 1px;" value="${currentEndDate}">
                    </div>
                </div>
            </div>
        `);

        // Wire auto-updates and date pickers on every newly-added field.
        const fieldIds = [
            `change-date-${changeId}`,
            `change-desc-${changeId}`,
            `change-prevstart-${changeId}`,
            `change-newstart-${changeId}`,
            `change-prev-${changeId}`,
            `change-new-${changeId}`,
        ];
        for (const fieldId of fieldIds) {
            const element = document.getElementById(fieldId);
            if (!element) continue;
            addListenersToElement(element);
            if (fieldId.includes('-date-') || fieldId.includes('-prevstart-') || fieldId.includes('-newstart-') || fieldId.includes('-prev-') || fieldId.includes('-new-')) {
                // Date pickers on timeline rows accept full dates only,
                // not month-level entries (allowMonthOnly = false).
                initializeDatePicker(element, false);
            }
        }

        updateChangeButton(storyId);
    }

    function removeChange(changeId, storyId) {
        const el = document.getElementById(`change-${changeId}`);
        if (el) el.remove();

        // Renumber remaining entries to keep #1, #2, #3... contiguous.
        const container = document.getElementById(`changes-container-${storyId}`);
        if (container) {
            existingChanges(container, storyId).forEach((change, index) => {
                const header = change.querySelector('strong');
                if (header) header.textContent = `Timeline #${index + 1}`;
            });
        }

        updateChangeButton(storyId);
    }

    function toggleChanges(storyId) {
        const checkbox = document.getElementById(`story-changes-${storyId}`);
        const section = document.getElementById(`changes-section-${storyId}`);
        if (!checkbox || !section) return;

        if (checkbox.checked) {
            section.style.display = 'block';
            // Auto-seed the first entry so the user has something to fill in.
            const container = document.getElementById(`changes-container-${storyId}`);
            if (container && existingChanges(container, storyId).length === 0) {
                addChange(storyId);
            }
            return;
        }

        section.style.display = 'none';
        const container = document.getElementById(`changes-container-${storyId}`);
        if (container) container.innerHTML = '';
        updateChangeButton(storyId);
    }

    /**
     * Bulk-apply pending timeline changes captured during a roadmap load.
     * The legacy load pipeline stashes per-story change arrays on
     * window.pendingTimelineChanges (string-keyed by "epicName - storyTitle")
     * and window.pendingTimelineChangesByIds (id-keyed by "epicId:storyId").
     * After all stories are rendered, we walk the DOM, match each story
     * against either index, and replay the saved entries by triggering
     * toggleChanges + addChange and then setting the field values.
     *
     * Async coordination is via a `pendingOperations` counter; we call
     * `callback` exactly once after every story's setTimeout-deferred batch
     * has finished. Errors fall through to the callback so the caller's
     * progress chain doesn't stall.
     *
     * @param {() => void} [callback]
     */
    function applyPendingTimelineChanges(callback) {
        const byIds = window.pendingTimelineChangesByIds;
        const byString = window.pendingTimelineChanges;
        const hasIdBased = byIds && Object.keys(byIds).length > 0;
        const hasStringBased = byString && Object.keys(byString).length > 0;

        if (!hasIdBased && !hasStringBased) {
            if (callback) callback();
            return;
        }

        const cleanupAndDone = () => {
            delete window.pendingTimelineChanges;
            delete window.pendingTimelineChangesByIds;
            delete window.loadedEpicIds;
            delete window.loadedStoryIds;
            if (callback) callback();
        };

        try {
            const storyEls = document.querySelectorAll('.story-section');
            let pendingOperations = 0;

            storyEls.forEach((storyEl) => {
                const storyId = storyEl.id.replace('story-', '');
                const titleEl = document.getElementById(`story-title-${storyId}`);
                if (!titleEl) return;

                const epicEl = storyEl.closest('.epic-section');
                const storyIdEl = document.getElementById(`story-id-${storyId}`);
                const epicIdEl = epicEl ? epicEl.querySelector('input[id^="epic-id-"]') : null;
                const epicTitleEl = epicEl ? epicEl.querySelector('input[id^="epic-name-"]') : null;
                const actualStoryId = storyIdEl ? storyIdEl.value : '';
                const actualEpicId = epicIdEl ? epicIdEl.value : '';
                const epicName = epicTitleEl ? epicTitleEl.value : '';
                const storyReference = `${epicName} - ${titleEl.value}`;

                let changes = null;
                if (hasIdBased && actualEpicId && actualStoryId) {
                    changes = byIds[`${actualEpicId}:${actualStoryId}`] || null;
                }
                if (!changes && hasStringBased) {
                    changes = byString[storyReference] || null;
                }
                if (!changes) return;

                const checkbox = document.getElementById(`story-changes-${storyId}`);
                if (!checkbox) return;

                pendingOperations++;
                checkbox.checked = true;
                toggleChanges(storyId);

                // toggleChanges auto-creates one empty entry; clear it before
                // replaying the saved ones so we don't double-render.
                const container = document.getElementById(`changes-container-${storyId}`);
                if (container) container.innerHTML = '';

                // Defer one tick so the cleared container is settled before we
                // start appending. addChange uses Date.now() in the entry id,
                // so successive synchronous calls would collide.
                setTimeout(() => {
                    changes.forEach((change) => {
                        addChange(storyId);
                        const containers = document.querySelectorAll(`#changes-container-${storyId} > div[id^="change-${storyId}-change-"]`);
                        const latest = containers[containers.length - 1];
                        if (!latest) return;

                        const fullChangeId = latest.id.replace('change-', '');
                        const dateEl = document.getElementById(`change-date-${fullChangeId}`);
                        const prevStartEl = document.getElementById(`change-prevstart-${fullChangeId}`);
                        const newStartEl = document.getElementById(`change-newstart-${fullChangeId}`);
                        const prevEl = document.getElementById(`change-prev-${fullChangeId}`);
                        const newEl = document.getElementById(`change-new-${fullChangeId}`);
                        const descEl = document.getElementById(`change-desc-${fullChangeId}`);
                        if (dateEl) dateEl.value = change.date;
                        if (prevStartEl) prevStartEl.value = change.prevStartDate || '';
                        if (newStartEl) newStartEl.value = change.newStartDate || '';
                        if (prevEl) prevEl.value = change.prevEndDate;
                        if (newEl) newEl.value = change.newEndDate;
                        if (descEl) descEl.value = change.description;
                    });
                    updateChangeButton(storyId);

                    pendingOperations--;
                    if (pendingOperations === 0) cleanupAndDone();
                }, 100);
            });

            // No story matched any pending change.
            if (pendingOperations === 0) cleanupAndDone();
        } catch {
            if (callback) callback();
        }
    }

    return {
        toggleChanges, addChange, removeChange, updateChangeButton,
        resetCounter, applyPendingTimelineChanges,
    };
}

// ===========================================================================
// Edit Story modal variant. Same structure but talks to the modal's DOM ids
// (#editChangesContainer, #editEnd, #add-edit-change-btn, edit-change-N-*)
// instead of the per-story ids. Kept in the same file because it's the same
// concept; kept as a separate factory because it has its own counter and
// the addEditChange API must return the created changeId for callers to
// fill in saved values immediately after creation.
// ===========================================================================

const EDIT_DATE_FIELD_SUFFIXES = ['-date', '-prevstart', '-newstart', '-prev', '-new'];

/**
 * Sort an array of timeline change objects by their date field. Empty dates
 * sort to the end. Pure utility - no DOM access.
 *
 * @param {Array<{ date?: string }>} timelineChanges
 * @returns {Array<{ date?: string }>}
 */
export function sortTimelineChangesByDate(timelineChanges) {
    return timelineChanges.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        const dateA = DateUtility.parseEuropeanDateForTimeline(a.date);
        const dateB = DateUtility.parseEuropeanDateForTimeline(b.date);
        return dateA - dateB;
    });
}

/**
 * @param {object} deps
 * @param {(input: Element, allowMonthOnly: boolean) => void} deps.reinitializeDatePicker
 *        Force-reinitializes a date picker on an input, clearing any prior
 *        tracking. Builder.js owns the picker module's tracking Set and
 *        wraps both the `delete` and the init call.
 * @param {() => string} deps.getToday  DD/MM/YY format.
 */
export function createEditTimelineChangeHandlers({ reinitializeDatePicker, getToday }) {
    let editChangeCounter = 0;

    function resetCounter() {
        editChangeCounter = 0;
    }

    function existingChangeEls() {
        return document.querySelectorAll('#editChangesContainer > div[id^="edit-change-"]');
    }

    function updateEditChangeButton() {
        const container = document.getElementById('editChangesContainer');
        const addButton = document.getElementById('add-edit-change-btn');
        if (!container || !addButton) return;

        const count = container.querySelectorAll('div[id^="edit-change-"]').length;
        if (count >= MAX_CHANGES) {
            addButton.disabled = true;
            addButton.textContent = `+ Add Timeline Entry (Max ${MAX_CHANGES} reached)`;
            addButton.style.opacity = '0.5';
            addButton.style.cursor = 'not-allowed';
        } else {
            addButton.disabled = false;
            addButton.textContent = '+ Add Timeline Entry';
            addButton.style.opacity = '1';
            addButton.style.cursor = 'pointer';
        }
    }

    /**
     * Append a new edit-modal change row. Returns the changeId so callers
     * can fill the freshly-created inputs with saved values without having
     * to read the module's internal counter.
     *
     * @returns {string|null} The created changeId, or null if max reached.
     */
    function addEditChange() {
        const container = document.getElementById('editChangesContainer');
        if (!container) return null;
        if (container.querySelectorAll('div[id^="edit-change-"]').length >= MAX_CHANGES) return null;

        const currentEndDateEl = document.getElementById('editEnd');
        const currentEndDate = currentEndDateEl ? currentEndDateEl.value : '';
        const currentStartDateEl = document.getElementById('editStart');
        const currentStartDate = currentStartDateEl ? currentStartDateEl.value : '';

        editChangeCounter++;
        const changeId = `edit-change-${editChangeCounter}`;
        const entryNumber = container.querySelectorAll('div[id^="edit-change-"]').length + 1;

        container.insertAdjacentHTML('beforeend', `
            <div class="form-group" id="${changeId}" style="border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; border-radius: 4px; background-color: #f8f9fa;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <strong>Timeline #${entryNumber}</strong>
                    <button type="button" class="danger" onclick="removeEditChange('${changeId}')" style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer;" tabindex="-1">Remove</button>
                </div>
                <div class="inline-group">
                    <div class="form-group">
                        <label>Change Date:</label>
                        <input type="text" id="${changeId}-date" placeholder="15/12/24" value="${getToday()}">
                    </div>
                    <div class="form-group">
                        <label>Description:</label>
                        <input type="text" id="${changeId}-desc" placeholder="Reason for change">
                    </div>
                </div>
                <div class="inline-group">
                    <div class="form-group">
                        <label>Previous Start Date:</label>
                        <input type="text" id="${changeId}-prevstart" placeholder="01/03" style="margin-bottom: 1px;" value="${currentStartDate}">
                    </div>
                    <div class="form-group">
                        <label>New Start Date:</label>
                        <input type="text" id="${changeId}-newstart" placeholder="15/03" style="margin-bottom: 1px;" value="${currentStartDate}">
                    </div>
                </div>
                <div class="inline-group">
                    <div class="form-group">
                        <label>Previous End Date:</label>
                        <input type="text" id="${changeId}-prev" placeholder="31/03" style="margin-bottom: 1px;" value="${currentEndDate}">
                    </div>
                    <div class="form-group">
                        <label>New End Date:</label>
                        <input type="text" id="${changeId}-new" placeholder="15/04" style="margin-bottom: 1px;" value="${currentEndDate}">
                    </div>
                </div>
            </div>
        `);

        // Modal date pickers stick around across openings of different stories,
        // so we force-reinitialize each one to clear stale tracking state.
        // Defer one tick so the inputs are mounted before the picker installs.
        setTimeout(() => {
            for (const suffix of EDIT_DATE_FIELD_SUFFIXES) {
                const field = document.getElementById(`${changeId}${suffix}`);
                if (field) reinitializeDatePicker(field, false);
            }
        }, 10);

        updateEditChangeButton();
        return changeId;
    }

    function removeEditChange(changeId) {
        const el = document.getElementById(changeId);
        if (el) el.remove();
        updateEditChangeButton();
    }

    function toggleEditTimelineChanges() {
        const checkbox = document.getElementById('editTimelineChanges');
        const section = document.getElementById('editTimelineChangesSection');
        if (!checkbox || !section) return;

        if (!checkbox.checked) {
            section.style.display = 'none';
            const container = document.getElementById('editChangesContainer');
            if (container) container.innerHTML = '';
            editChangeCounter = 0;
            updateEditChangeButton();
            return;
        }

        section.style.display = 'block';
        if (existingChangeEls().length === 0) addEditChange();

        // Re-fire pickers on existing rows. Modal stayed mounted across
        // story switches so prior tracking lingers.
        setTimeout(() => {
            const fields = document.querySelectorAll(
                '#editChangesContainer input[id*="-date"], #editChangesContainer input[id*="-prev"], #editChangesContainer input[id*="-new"]'
            );
            fields.forEach((input) => reinitializeDatePicker(input, false));
        }, 10);
    }

    return {
        toggleEditTimelineChanges,
        addEditChange,
        removeEditChange,
        updateEditChangeButton,
        resetCounter,
    };
}
