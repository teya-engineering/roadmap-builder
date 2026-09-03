import { DateUtility } from '../../utilities/date-utility.js';

// Date picker UI for the text inputs that accept dates or month names.
//
// Each input gets a hidden native <input type="date"> sibling that opens
// when the user clicks the calendar icon area (rightmost 30px). The visible
// text input continues to accept free-form input (DD/MM/YY, month names, etc).
//
// Initialization tracking is internal: a per-element dataset flag plus a Set
// of id strings (belt and suspenders, since some legacy paths re-render
// inputs that share an id). External callers that re-render a tracked input
// should call untrackDatePicker(id) before re-initializing.

const HIDDEN_INPUT_BASE_STYLE = `
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 1px;
    height: 1px;
    z-index: -1;
`;

// Calendar icon SVG embedded as a data URL (matches the legacy look).
const CALENDAR_ICON_BG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%23666' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5 0zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z'/%3E%3C/svg%3E\")";

const ICON_HOVER_PIXELS = 30;
const PICKER_WIDTH_PX = 200;

/**
 * @param {object} deps
 * @param {() => number} deps.getRoadmapYear  Reads the current roadmap year input.
 */
export function createDatePickers({ getRoadmapYear }) {
    /** @type {Set<string>} */
    const initialized = new Set();

    function untrackDatePicker(id) {
        if (id) initialized.delete(id);
    }

    function clearAllTracking() {
        initialized.clear();
    }

    function reinitializeDatePicker(inputElement, allowMonthOnly = true) {
        if (!inputElement) return;
        inputElement.dataset.datePickerInitialized = 'false';
        if (inputElement.id) initialized.delete(inputElement.id);
        initializeDatePicker(inputElement, allowMonthOnly);
    }

    function isEndDateField(input) {
        const id = input.id;
        // -prev-/-new- are timeline-change end dates; "End" matches the modal
        // capitalised id pattern (editEnd, etc.).
        return id.includes('-end-') || id.includes('End') || id.includes('-prev-') || id.includes('-new-');
    }

    function setRange(hiddenInput, year) {
        hiddenInput.min = `${year - 1}-01-01`;
        hiddenInput.max = `${year + 1}-12-31`;
    }

    function styleInputAsDateField(inputElement) {
        inputElement.style.backgroundImage = CALENDAR_ICON_BG;
        inputElement.style.backgroundRepeat = 'no-repeat';
        inputElement.style.backgroundPosition = 'right 8px center';
        inputElement.style.backgroundSize = '16px 16px';
        inputElement.style.paddingRight = '30px';
        inputElement.style.cursor = 'text';
        inputElement.title = 'Type date/month directly or click calendar icon to open date picker';
    }

    function initializeDatePicker(inputElement, allowMonthOnly = true) {
        if (!inputElement) return;
        if (inputElement.dataset.datePickerInitialized === 'true') return;

        if (initialized.has(inputElement.id)) {
            // Tracking says it's installed but the dataset flag may have been
            // wiped (the legacy code does this in some paths). Just sync the flag.
            inputElement.dataset.datePickerInitialized = 'true';
            return;
        }

        // If a previous render left a hidden picker on this row, adopt it
        // rather than creating a duplicate.
        const existingHidden = inputElement.parentNode?.querySelector('input[type="date"]');
        if (existingHidden) {
            inputElement.dataset.datePickerInitialized = 'true';
            initialized.add(inputElement.id);
            return;
        }

        inputElement.dataset.datePickerInitialized = 'true';
        initialized.add(inputElement.id);

        const isEndField = isEndDateField(inputElement);
        const hidden = document.createElement('input');
        hidden.type = 'date';
        hidden.tabIndex = -1; // exclude from tab order
        setRange(hidden, getRoadmapYear());
        hidden.style.cssText = HIDDEN_INPUT_BASE_STYLE;
        inputElement.parentNode.insertBefore(hidden, inputElement.nextSibling);

        styleInputAsDateField(inputElement);

        const parseTextValue = (value) =>
            DateUtility.parseTextValue(value, isEndField, getRoadmapYear());
        const formatDateToText = (dateValue) => DateUtility.formatDateToText(dateValue);

        const syncToDateInput = () => {
            if (!inputElement || !inputElement.value) return;
            const dateValue = parseTextValue(inputElement.value.trim());
            // Re-set the range each sync so it picks up year changes.
            setRange(hidden, getRoadmapYear());
            hidden.value = dateValue;
        };
        // Defer the initial sync so any setValue from form-load lands first.
        setTimeout(syncToDateInput, 10);

        function openPicker() {
            // Defer one tick so the text input's blur completes first.
            setTimeout(() => {
                try {
                    if (hidden.showPicker) {
                        hidden.showPicker();
                        return;
                    }
                } catch {
                    // showPicker may throw on some browsers - fall through.
                }
                // Older-browser fallback: briefly make the picker focusable.
                hidden.style.opacity = '1';
                hidden.style.pointerEvents = 'auto';
                hidden.focus();
                hidden.click();
                setTimeout(() => {
                    hidden.style.opacity = '0';
                    hidden.style.pointerEvents = 'none';
                }, 100);
            }, 10);
        }

        function smartDefaultForEmpty() {
            // Empty end-date fields default to the matching start-date value
            // when one exists. Otherwise, future-year roadmaps default to 1 Jan.
            if (isEndField) {
                const id = inputElement.id;
                let startId = '';
                if (id.includes('story-end-')) startId = id.replace('story-end-', 'story-start-');
                else if (id.includes('End')) startId = id.replace('End', 'Start');
                if (startId) {
                    const startEl = document.getElementById(startId);
                    if (startEl && startEl.value.trim()) {
                        return parseTextValue(startEl.value.trim());
                    }
                }
            }
            const year = getRoadmapYear();
            if (year > new Date().getFullYear()) return `${year}-01-01`;
            return null;
        }

        inputElement.addEventListener('click', function (e) {
            const rect = this.getBoundingClientRect();
            // Only open the picker on clicks within the calendar-icon hit area.
            if (e.clientX - rect.left <= rect.width - ICON_HOVER_PIXELS) return;
            e.preventDefault();

            setRange(hidden, getRoadmapYear());

            if (!inputElement.value.trim()) {
                const def = smartDefaultForEmpty();
                if (def) hidden.value = def;
            }
            syncToDateInput();

            // Position the hidden picker so its popup aligns with the input's
            // right edge. Inside modals we skip the scroll offset because they
            // use fixed/absolute positioning.
            const inModal = !!this.closest('.modal');
            const scrollX = inModal ? 0 : (window.pageXOffset || document.documentElement.scrollLeft);
            const scrollY = inModal ? 0 : (window.pageYOffset || document.documentElement.scrollTop);
            const rightEdge = rect.left + rect.width + scrollX;
            hidden.style.position = 'absolute';
            hidden.style.left = `${rightEdge - PICKER_WIDTH_PX}px`;
            hidden.style.top = `${rect.top + scrollY}px`;
            hidden.style.width = `${PICKER_WIDTH_PX}px`;
            hidden.style.height = `${rect.height}px`;
            hidden.style.zIndex = '10000';
            hidden.style.opacity = '0';
            hidden.style.pointerEvents = 'none';

            this.scrollIntoView({ behavior: 'instant', block: 'center' });
            openPicker();
        });

        inputElement.addEventListener('mousemove', function (e) {
            const rect = this.getBoundingClientRect();
            this.style.cursor = (e.clientX - rect.left > rect.width - ICON_HOVER_PIXELS) ? 'pointer' : 'text';
        });
        inputElement.addEventListener('mouseleave', function () {
            this.style.cursor = 'text';
        });

        // When the picker selects a date, push it back into the visible text input.
        hidden.addEventListener('change', function () {
            if (!this.value) return;
            inputElement.value = formatDateToText(this.value);
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // On blur, normalize the typed text (add the year if missing) and
        // re-sync the hidden picker.
        inputElement.addEventListener('blur', function () {
            const text = this.value.trim();
            if (text) {
                const dateValue = parseTextValue(text);
                if (dateValue) {
                    const formatted = formatDateToText(dateValue);
                    if (formatted && formatted !== text) this.value = formatted;
                }
            }
            syncToDateInput();
        });

        // suppress unused-var warning - allowMonthOnly is part of the public
        // contract and may be referenced by future logic.
        void allowMonthOnly;
    }

    function initializeDatePickersForEpic(epicId) {
        const epicElement = document.getElementById(`epic-${epicId}`);
        if (!epicElement) return;

        // Each selector targets a different shape of date field within an epic.
        // Story start/end inputs accept month names; status and timeline date
        // inputs are specific dates only.
        const targets = [
            { selector: 'input[id*="-start-"], input[id*="-end-"]', allowMonthOnly: true },
            { selector: 'input[id*="-date-"]', allowMonthOnly: false },
            { selector: 'input[id*="-prev-"], input[id*="-new-"]', allowMonthOnly: false },
        ];
        for (const { selector, allowMonthOnly } of targets) {
            epicElement.querySelectorAll(selector).forEach((field) => {
                if (!field.dataset.datePickerInitialized) initializeDatePicker(field, allowMonthOnly);
            });
        }
    }

    function initializeDatePickersForSection(sectionType) {
        const containerId = sectionType === 'ktlo' ? 'ktlo-content' : sectionType === 'btl' ? 'btl-content' : null;
        if (!containerId) return;
        const sectionElement = document.getElementById(containerId);
        if (!sectionElement) return;

        if (sectionType === 'btl') {
            sectionElement.querySelectorAll('input[id*="-start-"], input[id*="-end-"]').forEach((field) => {
                if (!field.dataset.datePickerInitialized) initializeDatePicker(field, true);
            });
        }
    }

    function refreshAllDatePickers() {
        const inputs = document.querySelectorAll(
            'input[type="text"][id*="start"], input[type="text"][id*="end"], input[type="text"][id*="date"]'
        );
        inputs.forEach((input) => {
            const hasIcon = input.style.backgroundImage && input.style.backgroundImage.includes('data:image/svg+xml');
            if (hasIcon) return;
            // Force re-init: clear both flags then init.
            input.dataset.datePickerInitialized = 'false';
            initialized.delete(input.id);
            const allowMonthOnly = input.id.includes('start') || input.id.includes('end');
            initializeDatePicker(input, allowMonthOnly);
        });
    }

    function updateAllDatePickerRanges() {
        const year = getRoadmapYear();
        const min = `${year - 1}-01-01`;
        const max = `${year + 1}-12-31`;
        document.querySelectorAll('input[type="date"]').forEach((dateInput) => {
            // The opacity check identifies our hidden pickers (vs any visible
            // native date inputs the markup might add later).
            if (dateInput.style.opacity === '0') {
                dateInput.min = min;
                dateInput.max = max;
            }
        });
    }

    function validateEndDate(event) {
        const endField = event.target;
        const endValue = endField.value.trim();
        const clear = () => {
            endField.style.borderColor = '';
            endField.style.backgroundColor = '';
        };

        if (!endValue) { clear(); return; }

        // Map end-field id back to its matching start-field id.
        const id = endField.id;
        let startId = '';
        if (id.includes('story-end-')) startId = id.replace('story-end-', 'story-start-');
        else if (id.includes('btl-end-')) startId = id.replace('btl-end-', 'btl-start-');
        else if (id.includes('End')) startId = id.replace('End', 'Start');
        if (!startId) return;

        const startField = document.getElementById(startId);
        if (!startField) return;
        const startValue = startField.value.trim();
        if (!startValue) { clear(); return; }

        try {
            const year = getRoadmapYear();
            const startISO = DateUtility.parseTextValue(startValue, false, year);
            const endISO = DateUtility.parseTextValue(endValue, true, year);
            if (startISO && endISO && endISO < startISO) {
                endField.style.borderColor = '#dc3545';
                endField.style.backgroundColor = '#ffe6e6';
                alert(`Warning: End date (${endValue}) is before start date (${startValue}).`);
            } else {
                clear();
            }
        } catch {
            // Parse failure (likely a month name) - skip validation.
            clear();
        }
    }

    return {
        initializeDatePicker,
        initializeDatePickersForEpic,
        initializeDatePickersForSection,
        refreshAllDatePickers,
        updateAllDatePickerRanges,
        validateEndDate,
        reinitializeDatePicker,
        untrackDatePicker,
        clearAllTracking,
    };
}
