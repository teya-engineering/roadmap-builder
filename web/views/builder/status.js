import { DateUtility } from '../../utilities/date-utility.js';

// Status checkboxes (Done, Cancelled, At Risk, New, Info, Transferred In/Out,
// Proposed) on each story. The seven simple status types share one generic
// handler `handleStatusChange`; "info" is special-cased because it manages a
// list of entries rather than a single date+notes pair.
//
// Inline onchange="handle*Change('${storyId}')" attributes in the rendered
// markup expect each handler on window, so builder.js exposes them via
// Object.assign during init().

export const STATUS_CONFIG = {
    done: {
        label: 'Done',
        sectionTitle: 'Story Complete',
        dateLabel: 'Done Date',
        notesLabel: 'Done Notes',
        datePlaceholder: '07/10 or 07/10/25 or 07-10-2025',
        notesPlaceholder: 'Completion notes',
    },
    cancelled: {
        label: 'Cancelled',
        sectionTitle: 'Story Cancellation',
        dateLabel: 'Cancel Date',
        notesLabel: 'Cancel Notes',
        datePlaceholder: '15/10 or 15/10/25 or 15-10-2025',
        notesPlaceholder: 'Cancellation reason',
    },
    atrisk: {
        label: 'At Risk',
        sectionTitle: 'Story At Risk',
        dateLabel: 'Risk Date',
        notesLabel: 'Risk Notes',
        datePlaceholder: '20/10 or 20/10/25 or 20-10-2025',
        notesPlaceholder: 'Risk details',
    },
    newstory: {
        label: 'New',
        sectionTitle: 'New Story Details',
        dateLabel: 'Story Date',
        notesLabel: 'Story Notes',
        datePlaceholder: '01/11 or 01/11/25 or 01-11-2025',
        notesPlaceholder: 'New story details',
    },
    transferredout: {
        label: 'Out',
        sectionTitle: 'Story Transferred Out Details',
        dateLabel: 'Transfer Out Date',
        notesLabel: 'Transfer Out Notes',
        datePlaceholder: '15/12 or 15/12/25 or 15-12-2025',
        notesPlaceholder: 'Transfer out details',
    },
    transferredin: {
        label: 'In',
        sectionTitle: 'Story Transferred In Details',
        dateLabel: 'Transfer In Date',
        notesLabel: 'Transfer In Notes',
        datePlaceholder: '01/12 or 01/12/25 or 01-12-2025',
        notesPlaceholder: 'Transfer in details',
    },
    proposed: {
        label: 'Proposed',
        sectionTitle: 'Story Proposed Details',
        dateLabel: 'Proposed Date',
        notesLabel: 'Proposed Notes',
        datePlaceholder: '10/12 or 10/12/25 or 10-12-2025',
        notesPlaceholder: 'Proposal details',
    },
};

// The DOM id schema for date/notes fields uses 'atrisk' -> 'atrisk',
// 'cancelled' -> 'cancel', everything else -> the status type as-is.
function dateFieldKey(statusType) {
    if (statusType === 'cancelled') return 'cancel';
    return statusType;
}

/**
 * @param {object} deps
 * @param {(storyId: string) => void} deps.addInfoEntry
 *        Called to seed the first info entry when "info" is checked on
 *        a story that has none yet.
 * @param {(storyId: string) => void} deps.convertSingleInfoToMultiple
 *        Migrates legacy single-info storage to the multi-entry format.
 */
export function createStatusHandlers({ addInfoEntry, convertSingleInfoToMultiple }) {
    function handleStatusChange(storyId, statusType) {
        const checkbox = document.getElementById(`story-${statusType}-${storyId}`);
        const section = document.getElementById(`${statusType}-section-${storyId}`);
        if (!checkbox || !section) return;

        if (!checkbox.checked) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        if (statusType === 'info') {
            // Defer so the section's children are laid out before we measure
            // existing entries.
            setTimeout(() => {
                const container = document.getElementById(`info-entries-${storyId}`);
                if (container && container.querySelectorAll('.info-entry').length === 0) {
                    addInfoEntry(storyId);
                }
            }, 100);
            return;
        }

        const dateField = document.getElementById(`${dateFieldKey(statusType)}-date-${storyId}`);
        if (dateField && !dateField.value) {
            dateField.value = DateUtility.getTodaysDateEuropean();
        }
        setTimeout(() => {
            if (dateField) dateField.focus({ preventScroll: true });
        }, 100);
    }

    // Read/write helpers for the status group of a story. Currently only
    // setStatusData is called externally (via setMultipleStatusData during
    // form load), but the rest are kept for parity with the legacy shape.
    const StatusUtils = {
        getStatusCheckboxes(storyId) {
            const checkboxes = {};
            for (const statusType of Object.keys(STATUS_CONFIG)) {
                checkboxes[statusType] = document.getElementById(`story-${statusType}-${storyId}`);
            }
            return checkboxes;
        },

        getStatusData(storyId) {
            const data = {};
            for (const statusType of Object.keys(STATUS_CONFIG)) {
                const key = dateFieldKey(statusType);
                const checkbox = document.getElementById(`story-${statusType}-${storyId}`);
                const dateField = document.getElementById(`${key}-date-${storyId}`);
                const notesField = document.getElementById(`${key}-notes-${storyId}`);
                data[statusType] = {
                    checked: checkbox ? checkbox.checked : false,
                    date: dateField ? dateField.value : '',
                    notes: notesField ? notesField.value : '',
                };
            }
            return data;
        },

        setStatusData(storyId, statusType, checked, date = '', notes = '') {
            const key = dateFieldKey(statusType);
            const checkbox = document.getElementById(`story-${statusType}-${storyId}`);
            const dateField = document.getElementById(`${key}-date-${storyId}`);
            const notesField = document.getElementById(`${key}-notes-${storyId}`);
            if (checkbox) {
                checkbox.checked = checked;
                handleStatusChange(storyId, statusType);
            }
            if (dateField) dateField.value = date;
            if (notesField) notesField.value = notes;
        },

        setMultipleStatusData(storyId, statusConfigs) {
            for (const [statusType, config] of Object.entries(statusConfigs)) {
                if (config.checked) {
                    this.setStatusData(storyId, statusType, true, config.date || '', config.notes || '');
                }
            }
        },
    };

    function handleDoneChange(storyId) { handleStatusChange(storyId, 'done'); }
    function handleCancelledChange(storyId) { handleStatusChange(storyId, 'cancelled'); }
    function handleAtRiskChange(storyId) { handleStatusChange(storyId, 'atrisk'); }
    function handleNewStoryChange(storyId) { handleStatusChange(storyId, 'newstory'); }
    function handleTransferredOutChange(storyId) { handleStatusChange(storyId, 'transferredout'); }
    function handleTransferredInChange(storyId) { handleStatusChange(storyId, 'transferredin'); }
    function handleProposedChange(storyId) { handleStatusChange(storyId, 'proposed'); }

    function handleInfoChange(storyId) {
        const checkbox = document.getElementById(`story-info-${storyId}`);
        const section = document.getElementById(`info-section-${storyId}`);
        if (!checkbox || !section) return;

        if (checkbox.checked) {
            section.style.display = 'block';
            // Auto-seed the first entry.
            setTimeout(() => {
                const container = document.getElementById(`info-entries-${storyId}`);
                if (container && container.querySelectorAll('.info-entry').length === 0) {
                    addInfoEntry(storyId);
                }
            }, 100);
        } else {
            section.style.display = 'none';
        }

        // Migrate single-info-entry roadmaps to the multi-entry format.
        setTimeout(() => convertSingleInfoToMultiple(storyId), 100);
    }

    return {
        STATUS_CONFIG,
        StatusUtils,
        handleStatusChange,
        handleDoneChange,
        handleCancelledChange,
        handleAtRiskChange,
        handleNewStoryChange,
        handleInfoChange,
        handleTransferredOutChange,
        handleTransferredInChange,
        handleProposedChange,
    };
}
