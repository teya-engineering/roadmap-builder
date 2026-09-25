import * as share from './share.js';
import * as saveDropdown from './save-dropdown.js';
import { exportJPG, exportPDF, createExportHTML } from './export.js';
import { toggleCollapse, collapseAllSections, createBuilderCollapse } from './collapse.js';
import {
    hideKTLOSection,
    showKTLOSection,
    repositionKTLOSection,
    createKTLOSectionHandlers,
} from './ktlo-sections.js';
import { createFileBrowser } from './file-browser.js';
import { createDatePickers } from './date-pickers.js';
import { createStoryMoves } from './story-moves.js';
import { createStoryDragHandlers } from './drag-drop.js';
import { createStoryEpicMove } from './story-epic-move.js';
import { createCountryFlagHandlers } from './country-flags.js';
import { createModalFocusTrap } from './focus-trap.js';
import { createStatusHandlers } from './status.js';
import { createInfoEntryHandlers } from './info-entries.js';
import { createSortingHandlers } from './sorting.js';
import {
    createTimelineChangeHandlers,
    createEditTimelineChangeHandlers,
    sortTimelineChangesByDate,
} from './timeline-changes.js';
import * as fullscreen from './fullscreen.js';
import { createStatsHandlers } from './stats.js';
import { initializeKTLOValidation, validateKTLOPercentage } from './ktlo-validation.js';
import * as roadmapState from './state.js';
import * as save from './save.js';
import { enableTitleEditing } from './inline-edit.js';
import { confettiBurst } from './confetti.js';
import { RoadmapGenerator } from '../../roadmap-generator.js';
import { ConfigUtility } from '../../utilities/config-utility.js';
import { DateUtility } from '../../utilities/date-utility.js';
import { renderCountryFlagsHTML } from '../../utilities/countries.js';
import { directoryStore } from '../../app/directory-store.js';
import { parseFte } from '../../domain/fte.js';

// Hint under every FTE field. The zero wording matters: staffed with nobody is
// a real answer and has to read differently from not filled in yet.
const FTE_HINT_DEFAULT = 'People working on this story, in halves. Leave empty if unknown.';
const FTE_HINT_ZERO = 'Nobody staffed yet - the roadmap shows 0 FTE.';
const FTE_HINT_INVALID = 'Enter a number of people, like 0.5, 1 or 2.5.';

/**
 * Keep the hint under an FTE field in step with what is typed.
 *
 * @param {string} hintId
 * @param {string} rawValue
 */
function updateFteHint(hintId, rawValue) {
    const hint = document.getElementById(hintId);
    if (!hint) return;

    const text = (rawValue || '').trim();
    const value = parseFte(text);

    if (text !== '' && value === null) {
        hint.dataset.state = 'error';
        hint.textContent = FTE_HINT_INVALID;
        return;
    }
    hint.dataset.state = '';
    hint.textContent = value === 0 ? FTE_HINT_ZERO : FTE_HINT_DEFAULT;
}

/**
 * Mount this view. Called by the SPA router on every navigation here.
 *
 * @param {HTMLElement} _root - The container element (currently unused;
 *                              legacy code reaches DOM via document.* directly)
 */
export function init(_root) {
    // Inline onclick="toggleShareDropdown(event)" etc. resolves names against
    // window. Slices that have been pulled out of the legacy body need their
    // exports re-attached here on every mount.
    Object.assign(window, share, saveDropdown, fullscreen, {
        exportJPG,
        exportPDF,
        toggleCollapse,
        collapseAllSections,
    });
    fullscreen.initFullscreenZoom();

    // hideFullscreen is also called from the Escape keydown handler in body
    // code, so we destructure it as a local.
    const { hideFullscreen } = fullscreen;

    // Builder collapse owns its open/closed state internally. The body reads
    // it via the isBuilderCollapsed() getter (different from the legacy
    // `if (!isBuilderCollapsed)` boolean read; minimal change to the
    // call site).
    const { toggleBuilderCollapse, isBuilderCollapsed } = createBuilderCollapse();
    window.toggleBuilderCollapse = toggleBuilderCollapse;

    // Date pickers - hidden native pickers behind the visible text inputs.
    // The factory owns the initialization-tracking Set; body code uses
    // untrackDatePicker / clearAllTracking to invalidate entries when it
    // re-renders inputs that share an id.
    const __datePickers = createDatePickers({
        getRoadmapYear: () =>
            parseInt(document.getElementById('roadmapYear').value, 10) || new Date().getFullYear(),
    });
    const {
        initializeDatePicker,
        initializeDatePickersForEpic,
        initializeDatePickersForSection,
        refreshAllDatePickers,
        updateAllDatePickerRanges,
        validateEndDate,
        reinitializeDatePicker,
        untrackDatePicker,
        clearAllTracking,
    } = __datePickers;
    Object.assign(window, __datePickers);

    // v2 wiring: state-driven mount-render, click-to-edit-titles, manual save.
    // Title-clicks and bar-background-clicks are both delegated on the mount.
    // The bar-click handler bails when the click target is inside a .task-title
    // so the inline-edit handler "wins" without needing event-flow tricks.

    // Single-file pick from the top nav lands here. Parses the JSON,
    // populates the form, hands the writable handle (if any) to the save
    // module so subsequent saves write directly to that file.
    window.onRoadmapFilePicked = ({ content, name, fileHandle }) => {
        try {
            const data = JSON.parse(content);
            const teamData = data.teamData || data;
            if (!teamData || typeof teamData !== 'object')
                throw new Error('not a roadmap document');
            if (typeof window.fixDatesOnLoad === 'function') window.fixDatesOnLoad(teamData);
            window.loadTeamData(teamData);
            window.updateFilenameDisplay(name);
            // fileHandle is null on Safari/Firefox (read-only fallback); save
            // stays disabled in that case.
            save.setFileHandle(
                fileHandle && typeof fileHandle.createWritable === 'function' ? fileHandle : null
            );
            setTimeout(() => {
                if (typeof window.refreshAllDatePickers === 'function')
                    window.refreshAllDatePickers();
                if (typeof window.generatePreview === 'function') window.generatePreview();
            }, 200);
        } catch (err) {
            alert(`Could not load file: ${err.message}`);
        }
    };

    {
        const mount = document.getElementById('roadmap-mount');
        const statusEl = document.getElementById('saveStatus');
        // The auto-save scheduler needs to flush form inputs into roadmapState
        // before serializing. prepareRoadmapForSave is defined later in the
        // legacy body and exposed on window; the lambda reads it lazily so
        // ordering doesn't matter.
        if (statusEl)
            save.init({
                statusElement: statusEl,
                onAutoSavePrepare: () =>
                    typeof window.prepareRoadmapForSave === 'function'
                        ? window.prepareRoadmapForSave()
                        : null,
            });

        // Dirty tracking: any user input/change inside the SPA mount marks
        // the form as having unsaved changes. We rely on Event.isTrusted to
        // distinguish real user gestures from programmatic events fired
        // during loadTeamData (those would otherwise mark dirty during a
        // fresh load). Inline title edits dispatch synthetic events, so
        // those mark dirty explicitly via onCommit below.
        const appRoot = document.getElementById('app') || document.body;
        if (!appRoot.dataset.dirtyTrackerAttached) {
            appRoot.dataset.dirtyTrackerAttached = 'true';
            const onUserEdit = (e) => {
                if (!e.isTrusted) return;
                if (location.pathname !== '/builder') return;
                save.markDirty();
            };
            appRoot.addEventListener('input', onUserEdit);
            appRoot.addEventListener('change', onUserEdit);
        }
        // Expose for the router and other guards.
        window.hasUnsavedBuilderChanges = save.isDirty;

        // Browser-level navigation (refresh, close tab) - native confirm.
        if (!window.__builderBeforeUnloadAttached) {
            window.__builderBeforeUnloadAttached = true;
            window.addEventListener('beforeunload', (e) => {
                if (save.isDirty()) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        }

        // The Filename input is read-only across the board: save
        // always writes back to the loaded file (single-file mode) or to
        // the file with that name in the picked folder (folder mode);
        // renaming via this input would either silently no-op or create
        // a new file, neither of which is what the user expects.
        // The `readonly` attribute is set in the HTML; nothing to wire here.

        // On save success: pulse the Save dropdown trigger green and burst
        // confetti out of it. The save module fires this event after each
        // successful in-place write or download.
        document.addEventListener('roadmap:saved', (e) => {
            // Auto-saves fire on a debounce while the user is editing -
            // suppress the celebration animation so it doesn't go off every
            // ~1.5s of typing. Manual saves still pulse + confetti as before.
            const isAuto = !!(e && e.detail && e.detail.auto);
            const buttons = document.querySelectorAll('#saveDropdownBtn, #saveDropdownBtnBottom');
            let originRect = null;
            buttons.forEach((btn) => {
                btn.classList.remove('is-just-saved');
                // Force reflow so the animation restarts on rapid saves.
                void btn.offsetWidth;
                if (!isAuto) btn.classList.add('is-just-saved');
                if (!originRect && btn.offsetParent) originRect = btn.getBoundingClientRect();
            });
            if (!isAuto && originRect) {
                confettiBurst({
                    x: originRect.left + originRect.width / 2,
                    y: originRect.top + originRect.height / 2,
                });
            }
        });
        if (mount) {
            enableTitleEditing(mount, {
                onCommit: ({ storyEl, nextTitle }) => {
                    // Inline-edit dispatches synthetic input events to drive
                    // collectFormData; those skip the dirty tracker because
                    // isTrusted is false, so we mark dirty here directly.
                    save.markDirty();
                    // Propagate the change into the form input so the next
                    // collectFormData() picks it up. KTLO has its own input;
                    // BTL and EPIC stories use the per-story dynamic input
                    // located via the hidden story-id matching the JSON storyId.
                    if (storyEl.classList.contains('ktlo-story')) {
                        const ktloTitleEl = document.getElementById('ktlo-title');
                        if (ktloTitleEl) {
                            ktloTitleEl.value = nextTitle;
                            ktloTitleEl.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        return;
                    }
                    const inputId = findFormTitleInputId(storyEl);
                    if (!inputId) {
                        console.warn('inline-edit: could not find form input for story', storyEl);
                        return;
                    }
                    const input = document.getElementById(inputId);
                    if (input) {
                        input.value = nextTitle;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                },
            });
            mount.addEventListener('click', (e) => {
                if (e.target.closest('.task-title')) return; // handled by inline-edit
                const story = e.target.closest('.story-item, .ktlo-story');
                if (!story) return;
                if (typeof window.openEditStoryModal !== 'function') return;
                window.openEditStoryModal({
                    epicName: story.dataset.epicName,
                    storyTitle: story.dataset.storyTitle,
                    storyIndex: story.dataset.storyIndex,
                });
            });
            // Re-render on every state mutation triggered by direct mutate()
            // calls (none yet in this slice). generatePreview() does its own
            // render after setState (kind=replace), so we skip those to
            // avoid double-rendering.
            roadmapState.subscribe((teamData, kind) => {
                if (kind === 'replace') return;
                if (roadmapState.isEditingLocked()) return;
                renderRoadmapToMount(teamData);
            });
        }
    }

    // Map a rendered story-item back to its form-side title input id.
    // The form's hidden `story-id-${formId}` carries the JSON storyId; we
    // grep for the one whose value matches the rendered story's
    // data-json-story-id and derive the matching title input.
    function findFormTitleInputId(storyEl) {
        const jsonId = storyEl.dataset.jsonStoryId;
        if (!jsonId) return null;
        const hiddenInputs = document.querySelectorAll('input[id^="story-id-"]');
        for (const input of hiddenInputs) {
            if (input.value === jsonId) {
                const formStoryId = input.id.slice('story-id-'.length);
                return `story-title-${formStoryId}`;
            }
        }
        return null;
    }

    function renderRoadmapToMount(teamData) {
        const mount = document.getElementById('roadmap-mount');
        if (!mount) return;
        const generator = new RoadmapGenerator(teamData.roadmapYear);
        mount.innerHTML = `<div class="roadmap-zoom-target">${generator.generateRoadmapBody(teamData, true)}</div>`;
    }

    const __viewReady = [];
    const __origAdd = document.addEventListener.bind(document);
    let cleanupDirectorySubscription = () => {};
    document.addEventListener = function (type, listener, opts) {
        if (type === 'DOMContentLoaded') {
            __viewReady.push(listener);
            return;
        }
        return __origAdd(type, listener, opts);
    };
    try {
        // === BEGIN legacy script body ===

        let epicCounter = 0;
        let storyCounters = {};
        // changeCounter moved into ./timeline-changes.js (resetTimelineChangeCounter resets it).
        let isGeneratingPreview = false; // Flag to prevent duplicate preview generation

        // Hexadecimal counter-based unique identifier generation
        let epicIdCounter = 0;
        let storyIdCounter = 0;

        function createEpicId() {
            // Create hexadecimal ID for EPICs (e.g., "0xE0000001", "0xE0000002")
            epicIdCounter++;
            const id = `0xE${epicIdCounter.toString(16).padStart(7, '0').toUpperCase()}`;
            return id;
        }

        function createStoryId() {
            // Create hexadecimal ID for Stories (e.g., "0x50000001", "0x50000002")
            // Using 5 prefix (looks like S) to distinguish from EPICs which use E prefix
            storyIdCounter++;
            const id = `0x5${storyIdCounter.toString(16).padStart(7, '0').toUpperCase()}`;
            return id;
        }

        async function loadDefaultTemplate() {
            // Double-check: Never load default template if external data is being processed
            if (window.loadingExternalData) {
                return;
            }

            try {
                const response = await fetch('Roadmap-Default-Template.json');
                if (!response.ok) {
                    throw new Error(`Failed to load template: ${response.status}`);
                }

                const templateData = await response.json();

                // Reset ID counters
                epicIdCounter = 0;
                storyIdCounter = 0;

                // Ensure monthly KTLO modal is hidden
                const monthlyModal = document.getElementById('editMonthlyKTLOModal');
                if (monthlyModal) {
                    monthlyModal.style.display = 'none';
                }

                // Clear existing data first
                document.getElementById('epics-container').innerHTML = '';
                document.getElementById('btl-stories-container').innerHTML = '';
                epicCounter = 0;
                storyCounters = {};
                btlStoryCounter = 0;

                // Initialize basic page elements
                initializeKTLOMonths();
                updateBTLAddButton();
                addAutoUpdateListeners();
                updateAllDatePickerRanges();

                // Load the template data
                loadTeamData(templateData.teamData);

                // Set default filename based on team name and year
                setTimeout(() => {
                    const teamName = document.getElementById('teamName').value.trim() || 'MyTeam';
                    const roadmapYear = document.getElementById('roadmapYear').value || '2025';
                    const defaultFilename = `${teamName}.Teya-Roadmap.${roadmapYear}.json`;
                    updateFilenameDisplay(defaultFilename);
                }, 100);

                // Preview generation will be handled by loadTeamData completion tracking
            } catch (error) {
                console.error('Error loading default template:', error);
                // Fallback to basic initialization
                initializeBasicTemplate();
            }
        }

        function initializeBasicTemplate() {
            // Reset ID counters
            epicIdCounter = 0;
            storyIdCounter = 0;

            // Ensure monthly KTLO modal is hidden
            const monthlyModal = document.getElementById('editMonthlyKTLOModal');
            if (monthlyModal) {
                monthlyModal.style.display = 'none';
            }

            // Clear any existing epics or BTL stories
            document.getElementById('epics-container').innerHTML = '';
            document.getElementById('btl-stories-container').innerHTML = '';
            epicCounter = 0;
            storyCounters = {};
            btlStoryCounter = 0;

            // Set all KTLO monthly data to 0
            ktloMonthlyData = {
                jan: { number: '0', percentage: '0', description: '' },
                feb: { number: '0', percentage: '0', description: '' },
                mar: { number: '0', percentage: '0', description: '' },
                apr: { number: '0', percentage: '0', description: '' },
                may: { number: '0', percentage: '0', description: '' },
                jun: { number: '0', percentage: '0', description: '' },
                jul: { number: '0', percentage: '0', description: '' },
                aug: { number: '0', percentage: '0', description: '' },
                sep: { number: '0', percentage: '0', description: '' },
                oct: { number: '0', percentage: '0', description: '' },
                nov: { number: '0', percentage: '0', description: '' },
                dec: { number: '0', percentage: '0', description: '' },
            };

            // Initialize KTLO and Monthly UI
            initializeKTLOMonths();
            updateBTLAddButton();
            addAutoUpdateListeners();
            updateAllDatePickerRanges();

            // Position KTLO section based on default state
            setTimeout(() => {
                repositionKTLOSection();
                collapseAllSections();
                generatePreview();
            }, 100);
        }

        // More robust initialization with multiple retry attempts
        function attemptInitialization(retryCount = 0) {
            const maxRetries = 10; // Try for up to 2 seconds (10 * 200ms)

            if (typeof RoadmapGenerator !== 'undefined') {
                // Check if we're loading external data before loading default template
                if (window.loadingExternalData) {
                    return;
                }

                // Success! Load the default template
                loadDefaultTemplate();
                return;
            }

            if (retryCount < maxRetries) {
                // Keep trying every 200ms
                setTimeout(() => {
                    attemptInitialization(retryCount + 1);
                }, 200);
            } else {
                // Final fallback after all retries exhausted
                console.warn('RoadmapGenerator failed to load, using basic template');
                initializeBasicTemplate();
            }
        }

        // Use DOMContentLoaded instead of window.onload for more reliable initialization
        document.addEventListener('DOMContentLoaded', function () {
            // Restore the saved layout toggles before anything renders the
            // preview, since the generator reads them off the checkboxes.
            const epicTitleTopToggle = /** @type {HTMLInputElement | null} */ (
                document.getElementById('epic-title-top-toggle')
            );
            if (epicTitleTopToggle) {
                epicTitleTopToggle.checked = ConfigUtility.shouldShowEpicTitleTop();
            }
            const hideStoryTextToggle = /** @type {HTMLInputElement | null} */ (
                document.getElementById('hide-story-text-toggle')
            );
            if (hideStoryTextToggle) {
                hideStoryTextToggle.checked = ConfigUtility.shouldHideStoryText();
            }

            // Populate the country-flags fieldset in the edit modal once.
            // Global is checked by default so opening the modal without a
            // loaded story still matches the existing "empty = Global" rule.
            const editFlagsContainer = document.getElementById('editFlagsContainer');
            if (editFlagsContainer && typeof renderCountryFlagsHTML === 'function') {
                editFlagsContainer.innerHTML = renderCountryFlagsHTML({
                    id: (c) => `editFlag${c.name}`,
                    onChange: (c) =>
                        c.code === 'global'
                            ? 'clearEditCountriesIfGlobalSelected()'
                            : 'clearEditGlobalIfCountrySelected()',
                    checked: (c) => c.code === 'global',
                });
            }

            // Add keyboard shortcut listener for KTLO toggle
            document.addEventListener('keydown', handleKTLOToggleShortcut);

            // Close stats modal on Escape
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeStatsModal();
            });

            // Global focus event listener to prevent focus on hidden date inputs
            document.addEventListener('focusin', function (event) {
                const target = event.target;
                // If focus lands on a hidden date input, redirect to the associated text input
                if (
                    target &&
                    target.type === 'date' &&
                    target.style.opacity === '0' &&
                    target.style.pointerEvents === 'none'
                ) {
                    // Find the associated text input (should be the previous sibling)
                    const textInput = target.previousElementSibling;
                    if (textInput && textInput.tagName === 'INPUT' && textInput.type === 'text') {
                        event.preventDefault();
                        textInput.focus();
                    }
                }
            });

            // Initialize date pickers for modal fields when modal opens (they may not exist yet)

            // Check for external data first before starting default initialization
            const urlParams = new URLSearchParams(window.location.search);
            const loadDataKey = urlParams.get('loadData');

            if (loadDataKey) {
                // Set the flag immediately to prevent any default template loading
                window.loadingExternalData = true;
                // External data will be handled by the other DOMContentLoaded handler
                return;
            }

            // Start the initialization attempt immediately (only if no external data)
            attemptInitialization();
        });

        // Store KTLO monthly data in memory since we only show one month at a time
        let ktloMonthlyData = {
            jan: { number: '', percentage: '', description: '' },
            feb: { number: '', percentage: '', description: '' },
            mar: { number: '', percentage: '', description: '' },
            apr: { number: '', percentage: '', description: '' },
            may: { number: '', percentage: '', description: '' },
            jun: { number: '', percentage: '', description: '' },
            jul: { number: '', percentage: '', description: '' },
            aug: { number: '', percentage: '', description: '' },
            sep: { number: '', percentage: '', description: '' },
            oct: { number: '', percentage: '', description: '' },
            nov: { number: '', percentage: '', description: '' },
            dec: { number: '', percentage: '', description: '' },
        };

        function initializeKTLOMonths() {
            // Initialize the month selector to January and load its data
            const selector = document.getElementById('ktlo-month-selector');
            if (selector) {
                selector.value = 'jan';
                selector.setAttribute('data-previous-month', 'jan');
                loadKTLOMonth('jan');
            }
        }

        function switchKTLOMonth() {
            // Save current month's data before switching
            const selector = document.getElementById('ktlo-month-selector');
            const oldMonth = selector.getAttribute('data-previous-month') || selector.value;

            // Save the old month's data
            const numberInput = document.getElementById('ktlo-current-number');
            const percentageInput = document.getElementById('ktlo-current-percentage');
            const descriptionInput = document.getElementById('ktlo-current-description');

            ktloMonthlyData[oldMonth] = {
                number: numberInput ? numberInput.value : '',
                percentage: percentageInput ? percentageInput.value : '',
                description: descriptionInput ? descriptionInput.value : '',
            };

            // Store the new month as the "previous" for next time
            selector.setAttribute('data-previous-month', selector.value);

            const selectedMonth = selector.value;
            loadKTLOMonth(selectedMonth);
        }

        function loadKTLOMonth(month) {
            const data = ktloMonthlyData[month];
            const numberInput = document.getElementById('ktlo-current-number');
            const percentageInput = document.getElementById('ktlo-current-percentage');
            const descriptionInput = document.getElementById('ktlo-current-description');

            if (numberInput) numberInput.value = data.number;
            if (percentageInput) percentageInput.value = data.percentage;
            if (descriptionInput) descriptionInput.value = data.description;
        }

        function saveCurrentKTLOData() {
            // Don't save current data if we're creating a new roadmap (would overwrite fresh defaults)
            if (window.isCreatingNewRoadmap) {
                return;
            }

            const selector = document.getElementById('ktlo-month-selector');
            if (!selector) return;

            const currentMonth = selector.value;
            const numberInput = document.getElementById('ktlo-current-number');
            const percentageInput = document.getElementById('ktlo-current-percentage');
            const descriptionInput = document.getElementById('ktlo-current-description');

            ktloMonthlyData[currentMonth] = {
                number: numberInput ? numberInput.value : '',
                percentage: percentageInput ? percentageInput.value : '',
                description: descriptionInput ? descriptionInput.value : '',
            };
        }

        function addEpic() {
            epicCounter++;
            storyCounters[epicCounter] = 0;

            // Generate 8-character unique ID for the EPIC
            const epicId = createEpicId();
            const accentColors = ['#00739A', '#7c3aed', '#d97706', '#0284c7'];
            const accentColor = accentColors[(epicCounter - 1) % accentColors.length];

            const epicHtml = `
                <div class="epic-section" id="epic-${epicCounter}" data-epic-id="${epicId}" style="--section-accent: ${accentColor};">
                    <div class="epic-card-header">
                        <div class="flex-center">
                            <button id="collapse-btn-${epicCounter}" onclick="toggleEpicCollapse(${epicCounter})" title="Collapse EPIC">▼</button>
                            <span class="section-color-dot" aria-hidden="true"></span>
                            <label for="epic-name-${epicCounter}" class="visually-hidden">EPIC name</label>
                            <input type="text" id="epic-name-${epicCounter}" class="epic-title-input" placeholder="e.g., EPIC 1" value="EPIC ${epicCounter}">
                            <span class="section-card-meta" id="epic-story-meta-${epicCounter}">0 stories</span>
                        </div>
                        <button class="quiet-remove-button" onclick="removeEpic(${epicCounter})" tabindex="-1">Remove</button>
                    </div>

                    <!-- Hidden ID field for data collection -->
                    <input type="hidden" id="epic-id-${epicCounter}" value="${epicId}">
                    
                    <div id="epic-content-${epicCounter}" class="epic-card-body">
                        <div id="stories-container-${epicCounter}">
                            <!-- Stories will be added here -->
                        </div>
                        <button onclick="addStory(${epicCounter})" class="ghost-add-button">+ Add Story</button>
                    </div>
                </div>
            `;

            document.getElementById('epics-container').insertAdjacentHTML('beforeend', epicHtml);

            // Add auto-update listeners to the new EPIC elements
            const epicNameField = document.getElementById(`epic-name-${epicCounter}`);
            if (epicNameField) addListenersToElement(epicNameField);

            addStory(epicCounter); // Add one story by default
        }

        function removeEpic(epicId) {
            const epicElement = document.getElementById(`epic-${epicId}`);
            const epicName =
                document.getElementById(`epic-name-${epicId}`)?.value || `EPIC ${epicId}`;

            if (
                !confirm(
                    `Are you sure you want to remove "${epicName}"? This will delete the EPIC and all its stories permanently.`
                )
            ) {
                return;
            }

            epicElement.remove();
            delete storyCounters[epicId];

            // Refresh the roadmap preview
            generatePreview();
        }

        function updateEpicStoryMeta(epicId) {
            const epicElement = document.getElementById(`epic-${epicId}`);
            const meta = document.getElementById(`epic-story-meta-${epicId}`);
            if (!epicElement || !meta) return;
            const count = epicElement.querySelectorAll('.story-section').length;
            meta.textContent = `${count} ${count === 1 ? 'story' : 'stories'}`;
        }

        function toggleEpicCollapse(epicId) {
            const contentDiv = document.getElementById(`epic-content-${epicId}`);
            const collapseBtn = document.getElementById(`collapse-btn-${epicId}`);

            if (contentDiv.style.display === 'none') {
                // Expand
                contentDiv.style.display = 'block';
                collapseBtn.textContent = '▼';
                collapseBtn.title = 'Collapse EPIC';
                collapseBtn.classList.remove('collapse-btn-collapsed');

                // Initialize date pickers for this EPIC after expansion
                setTimeout(() => {
                    initializeDatePickersForEpic(epicId);
                }, 50);
            } else {
                // Collapse
                contentDiv.style.display = 'none';
                collapseBtn.textContent = '▶';
                collapseBtn.title = 'Expand EPIC';
                collapseBtn.classList.add('collapse-btn-collapsed');
            }
        }

        function toggleBTLCollapse() {
            const contentDiv = document.getElementById('btl-content');
            const collapseBtn = document.getElementById('btl-collapse-btn');

            if (contentDiv.style.display === 'none') {
                // Expand
                contentDiv.style.display = 'block';
                collapseBtn.textContent = '▼';
                collapseBtn.title = 'Collapse BTL';
                collapseBtn.classList.remove('collapse-btn-collapsed');

                // Initialize date pickers for BTL section after expansion
                setTimeout(() => {
                    initializeDatePickersForSection('btl');
                }, 50);
            } else {
                // Collapse
                contentDiv.style.display = 'none';
                collapseBtn.textContent = '▶';
                collapseBtn.title = 'Expand BTL';
                collapseBtn.classList.add('collapse-btn-collapsed');
            }
        }

        function toggleStoryCollapse(storyId) {
            const contentDiv = document.getElementById(`story-content-${storyId}`);
            const collapseBtn = document.getElementById(`story-collapse-btn-${storyId}`);
            const headerTitle = document.getElementById(`story-header-title-${storyId}`);
            const storySection = document.getElementById(`story-${storyId}`);

            if (contentDiv.style.display === 'none') {
                // Expand
                contentDiv.style.display = 'block';
                collapseBtn.textContent = '▼';
                collapseBtn.title = 'Collapse Story';
                collapseBtn.classList.remove('collapse-btn-collapsed');
                collapseBtn.style.background = '';
                collapseBtn.style.color = '';
                // Remove title suffix when expanded
                updateStoryHeaderTitle(storyId);
                // Disable dragging when expanded
                if (storySection) {
                    storySection.setAttribute('draggable', 'false');
                    headerTitle.style.cursor = 'default';
                }
            } else {
                // Collapse
                contentDiv.style.display = 'none';
                collapseBtn.textContent = '▶';
                collapseBtn.title = 'Expand Story';
                collapseBtn.classList.add('collapse-btn-collapsed');
                collapseBtn.style.background = '';
                collapseBtn.style.color = '';
                // Add title suffix when collapsed
                updateStoryHeaderTitle(storyId, true);
                // Enable dragging when collapsed
                if (storySection) {
                    storySection.setAttribute('draggable', 'true');
                    headerTitle.style.cursor = 'move';
                }
            }
        }

        function updateStoryHeaderTitle(storyId, showTitle = false) {
            const headerTitle = document.getElementById(`story-header-title-${storyId}`);
            if (!headerTitle) return;

            const storyNumber =
                headerTitle.dataset.storyNumber ||
                headerTitle.textContent.match(/Story (\d+)/)?.[1] ||
                '1';
            headerTitle.dataset.storyNumber = storyNumber;

            const titleInputId = storyId.startsWith('btl-')
                ? `btl-title-${storyId}`
                : `story-title-${storyId}`;
            const title = document.getElementById(titleInputId)?.value.trim();
            headerTitle.textContent = title || `Story ${storyNumber}`;
            headerTitle.title = showTitle && title ? title : `Story ${storyNumber}`;
            updateStorySummary(storyId);
        }

        function updateStorySummary(storyId) {
            const statusChip = document.getElementById(`story-status-chip-${storyId}`);
            const dateRange = document.getElementById(`story-date-range-${storyId}`);
            if (!statusChip || !dateRange) return;

            const isBTL = storyId.startsWith('btl-');
            const value = (prefix) =>
                document.getElementById(`${prefix}-${storyId}`)?.value.trim() || '';
            const start = value(isBTL ? 'btl-start' : 'story-start');
            const end = value(isBTL ? 'btl-end' : 'story-end');
            dateRange.textContent = start && end ? `${start} → ${end}` : start || end;

            statusChip.className = 'story-status-chip';
            statusChip.textContent = '';
            if (isBTL) return;

            const checked = (prefix) => document.getElementById(`${prefix}-${storyId}`)?.checked;
            const changes = document.querySelectorAll(
                `#changes-container-${storyId} > div[id^="change-${storyId}-change-"]`
            ).length;
            const states = [
                [checked('story-cancelled'), 'CANCELLED', 'status-cancelled'],
                [checked('story-done'), 'DONE', 'status-done'],
                [checked('story-atrisk'), 'AT RISK', 'status-risk'],
                [checked('story-proposed'), 'PROPOSED', 'status-proposed'],
                [checked('story-newstory'), 'NEW', 'status-new'],
                [
                    checked('story-transferredin') || checked('story-transferredout'),
                    'TRANSFERRED',
                    'status-transfer',
                ],
                [
                    checked('story-changes'),
                    `${changes || 1} ${changes === 1 ? 'CHANGE' : 'CHANGES'}`,
                    'status-changes',
                ],
            ];
            const activeState = states.find(([active]) => active);
            if (!activeState) return;
            statusChip.textContent = activeState[1];
            statusChip.classList.add(activeState[2]);
        }

        function refreshBuilderSummaries() {
            document.querySelectorAll('.story-section').forEach((storyElement) => {
                updateStoryHeaderTitle(storyElement.id.replace('story-', ''), true);
            });
            document.querySelectorAll('.epic-section').forEach((epicElement) => {
                updateEpicStoryMeta(epicElement.id.replace('epic-', ''));
            });
        }

        // Slices that depend on hoisted function declarations from this body
        // are wired here. Their handlers go on window so inline on*= attributes
        // in the markup resolve.
        Object.assign(window, createStoryDragHandlers({ updateStoryNumbers, generatePreview }));
        Object.assign(
            window,
            createCountryFlagHandlers({ onStoryChange: () => debouncedGeneratePreview() })
        );
        // Story moves: moveStoryUpByEpic/moveStoryDownByEpic are also called
        // directly from body code (moveCurrentStoryUp/Down) so we destructure
        // them as locals.
        const __storyMoves = createStoryMoves({ updateStoryNumbers, generatePreview });
        const { moveStoryUpByEpic, moveStoryDownByEpic } = __storyMoves;
        Object.assign(window, __storyMoves);
        Object.assign(
            window,
            createStoryEpicMove({
                addStory,
                addBTLStory,
                removeStory,
                loadStoryData,
                applyBTLStoryData,
                collectStoryData,
                collectBTLStoryData,
                updateBTLAddButton,
                generatePreview,
            })
        );
        // Focus trap is also called directly from body code (not just inline
        // attributes), so we destructure the names into init() scope. Strict
        // mode in ES modules means bare references don't fall through to
        // window, unlike legacy non-module sloppy mode.
        const { setupModalFocusTrap, removeModalFocusTrap } = createModalFocusTrap({
            closeFns: {
                editStoryModal: closeEditModal,
                editMonthlyKTLOModal: closeEditMonthlyKTLOModal,
            },
        });
        window.setupModalFocusTrap = setupModalFocusTrap;
        window.removeModalFocusTrap = removeModalFocusTrap;

        // Story-form info entry helpers. addInfoEntry/removeInfoEntry are
        // referenced from inline onclick attributes in the rendered entry
        // markup, and addInfoEntry/convertSingleInfoToMultiple are deps of
        // the status module below.
        const __infoEntries = createInfoEntryHandlers({
            getToday: () => DateUtility.getTodaysDateEuropean(),
            onChange: () => generatePreview(),
        });
        const { addInfoEntry, convertSingleInfoToMultiple } = __infoEntries;
        Object.assign(window, __infoEntries);

        // Sorting handlers. storeOriginalStoryOrder is called from loadTeamData
        // to snapshot a freshly-loaded order, so we hoist it as a local. The
        // others are exposed on window for inline onchange="..." attribute
        // resolution on the sorting checkboxes in the form.
        const __sorting = createSortingHandlers({ collectStoryData, generatePreview });
        const { storeOriginalStoryOrder } = __sorting;
        Object.assign(window, __sorting);

        // Story-form timeline change handlers. toggleChanges/addChange/
        // updateChangeButton are called directly from body code (loadStoryData
        // and the loaded-roadmap pipeline), so we hoist all three as locals.
        // resetTimelineChangeCounter is invoked by newRoadmap to mirror the
        // legacy behavior of clearing the counter on a fresh roadmap.
        const __timeline = createTimelineChangeHandlers({
            addListenersToElement,
            initializeDatePicker,
            getToday: () => DateUtility.getTodaysDateEuropean(),
        });
        const {
            toggleChanges,
            addChange,
            updateChangeButton,
            resetCounter: resetTimelineChangeCounter,
        } = __timeline;
        Object.assign(window, __timeline);

        // Edit Story modal timeline change handlers. The Edit modal stays
        // mounted across story openings, so date-picker tracking can go stale;
        // reinitializeDatePicker (from ./date-pickers.js) clears the dataset
        // flag and the Set entry before re-installing.
        const __editTimeline = createEditTimelineChangeHandlers({
            reinitializeDatePicker,
            getToday: () => DateUtility.getTodaysDateEuropean(),
        });
        const {
            toggleEditTimelineChanges,
            addEditChange,
            updateEditChangeButton,
            resetCounter: resetEditChangeCounter,
        } = __editTimeline;
        Object.assign(window, __editTimeline, { sortTimelineChangesByDate });

        // Stats modal. openStatsModal is called from the "Stats" button click
        // and closeStatsModal from the Escape keydown handler, so we hoist
        // both as locals.
        const __stats = createStatsHandlers({ collectFormData });
        const { openStatsModal, closeStatsModal } = __stats;
        Object.assign(window, __stats);

        // HTML export. Needs the live form data so it's factoried here, where
        // collectFormData is hoisted into scope. Exposed on window for the
        // inline onclick="exportHTML()" in the share dropdown.
        window.exportHTML = createExportHTML({ collectFormData });

        // KTLO section handlers. toggleKTLOCollapse needs initializeDatePickersForSection
        // (still in builder.js); toggleKTLOPosition needs generatePreview. Both
        // are body function declarations so they're hoisted at this point.
        // Plain hide/show/reposition exports come straight from the module.
        const __ktloSections = createKTLOSectionHandlers({
            initializeDatePickersForSection,
            generatePreview,
        });
        const { handleKTLOToggleShortcut } = __ktloSections;
        Object.assign(window, __ktloSections, {
            hideKTLOSection,
            showKTLOSection,
            repositionKTLOSection,
        });

        // File browser: side panel listing of .json roadmaps + drag-drop
        // file load. Subscribes to the directory store for the selected folder.
        // toggleFileBrowser/loadDirectoryFiles/openRoadmapFile are
        // referenced from inline onclick attributes and from body code.
        const __fileBrowser = createFileBrowser({
            loadTeamData,
            updateFilenameDisplay,
            refreshAllDatePickers,
            generatePreview,
            handleFileLoad,
            setFileHandle: save.setFileHandle,
        });
        const { toggleFileBrowser, initializeDragAndDrop } = __fileBrowser;
        Object.assign(window, __fileBrowser);
        // Mirror the legacy boot pattern: wire drag-drop on DOMContentLoaded
        // and subscribe now (subscribe immediately fires once with
        // current state, so the file list paints if a folder is already set).
        document.addEventListener('DOMContentLoaded', initializeDragAndDrop);
        cleanupDirectorySubscription = __fileBrowser.subscribeToDirectoryStore();

        // KTLO percentage validation. The legacy body bound this on
        // DOMContentLoaded; we shimmed addEventListener to capture that
        // listener, so adding it here gets the same lifecycle.
        document.addEventListener('DOMContentLoaded', initializeKTLOValidation);

        // Status checkbox handlers. The body calls handleDoneChange and the
        // others directly during form load (loadStoryData re-fires each handler
        // to show/hide its section), so we destructure every handler name into
        // init() scope. Object.assign also exposes them on window for inline
        // onchange="handle*Change('${storyId}')" attribute resolution.
        const __statusBundle = createStatusHandlers({ addInfoEntry, convertSingleInfoToMultiple });
        const {
            handleDoneChange,
            handleCancelledChange,
            handleAtRiskChange,
            handleNewStoryChange,
            handleInfoChange,
            handleTransferredInChange,
            handleTransferredOutChange,
            handleProposedChange,
        } = __statusBundle;
        Object.assign(window, __statusBundle);

        // Debounced generatePreview to avoid too many rapid updates
        let previewTimeout;
        function debouncedGeneratePreview() {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(generatePreview, ConfigUtility.CSS.TIMING.DEBOUNCE_DELAY); // Wait for debounce delay after last change
        }

        // Story sorting toggles (start/end) are now in ./sorting.js. The
        // factory is wired at the top of init() and exposes the handlers
        // on window for inline onchange attrs.

        // Temporary variable for force text below (one-time action)
        let tempForceTextBelow = false;

        function handleForceTextBelowToggle() {
            const toggle = document.getElementById('force-text-below-toggle');
            if (toggle) {
                tempForceTextBelow = toggle.checked;
                window.tempForceTextBelow = tempForceTextBelow;
                generatePreview();
            }
        }

        // Event delegation so the handler works regardless of element lifecycle
        document.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'force-text-below-toggle') {
                handleForceTextBelowToggle();
            }
        });

        // Layout toggles below "force text below". Unlike that one they are
        // display preferences, so they persist and survive loading a file.
        // roadmap-generator.js reads the checkboxes directly.
        function handleEpicTitleTopToggle() {
            const toggle = /** @type {HTMLInputElement | null} */ (
                document.getElementById('epic-title-top-toggle')
            );
            if (!toggle) return;
            ConfigUtility.setEpicTitleTop(toggle.checked);
            generatePreview();
        }

        function handleHideStoryTextToggle() {
            const toggle = /** @type {HTMLInputElement | null} */ (
                document.getElementById('hide-story-text-toggle')
            );
            if (!toggle) return;
            ConfigUtility.setHideStoryText(toggle.checked);
            generatePreview();
        }

        // The story whose FTE was edited last, so the next render can pop just
        // that one tag. The whole roadmap is rebuilt on every keystroke, so a
        // plain CSS animation would fire on every tag on the board.
        let ftePopStoryId = null;

        // FTE fields live in three forms that are all built with innerHTML, so
        // the hint is kept honest by delegation rather than per-field wiring.
        document.addEventListener('input', (e) => {
            const field = e.target;
            if (!field || !field.id) return;

            const storyMatch = field.id.match(/^story-fte-(.+)$/);
            const isFteField =
                storyMatch || field.id.startsWith('btl-fte-') || field.id === 'editFte';
            if (!isFteField) return;

            // The field already points at its own hint for screen readers.
            updateFteHint(field.getAttribute('aria-describedby'), field.value);

            if (storyMatch) {
                const uniqueIdEl = document.getElementById(`story-id-${storyMatch[1]}`);
                ftePopStoryId = uniqueIdEl ? uniqueIdEl.value : null;
            }
        });

        // The nav status-style toggle changes how status events are rendered
        // (hover bar vs. side text box). Both layouts produce different markup,
        // so regenerate the preview when the user flips it.
        document.addEventListener('roadmap-status-style-changed', () => {
            generatePreview();
        });

        function addAutoUpdateListeners() {
            // Team information fields
            const teamFields = [
                'roadmapYear',
                'teamName',
                'directorVP',
                'em',
                'pm',
                'teamDescription',
            ];
            teamFields.forEach((id) => {
                const element = document.getElementById(id);
                if (element) {
                    element.addEventListener('input', debouncedGeneratePreview);
                    element.addEventListener('change', debouncedGeneratePreview);

                    // Special handling for roadmapYear to update date picker ranges
                    if (id === 'roadmapYear') {
                        element.addEventListener('change', function () {
                            updateAllDatePickerRanges();
                        });
                    }

                    // Update filename when team name or year changes
                    if (id === 'teamName' || id === 'roadmapYear') {
                        element.addEventListener('input', function () {
                            const currentFilename = document
                                .getElementById('currentFilename')
                                .value.trim();
                            // Only auto-update if filename follows the default pattern
                            if (
                                currentFilename.includes('.Teya-Roadmap.') &&
                                currentFilename.endsWith('.json')
                            ) {
                                const teamName =
                                    document.getElementById('teamName').value.trim() || 'MyTeam';
                                const roadmapYear =
                                    document.getElementById('roadmapYear').value || '2025';
                                const newFilename = `${teamName}.Teya-Roadmap.${roadmapYear}.json`;
                                document.getElementById('currentFilename').value = newFilename;
                            }
                        });
                    }
                }
            });

            // KTLO fields
            const ktloFields = ['ktlo-title', 'ktlo-bullets'];
            ktloFields.forEach((id) => {
                const element = document.getElementById(id);
                if (element) {
                    element.addEventListener('input', debouncedGeneratePreview);
                    element.addEventListener('change', debouncedGeneratePreview);
                }
            });

            // KTLO position toggle
            const ktloToggle = document.getElementById('ktlo-position-toggle');
            if (ktloToggle) {
                ktloToggle.addEventListener('change', function () {
                    // Clear hidden state when manually toggling checkbox
                    delete ktloToggle.dataset.originalPosition;
                    showKTLOSection(); // Make KTLO visible in builder
                    repositionKTLOSection();
                    generatePreview(); // Immediate update for position changes
                });
            }

            // KTLO monthly data fields (new dropdown approach)
            const ktloMonthlyFields = [
                'ktlo-current-number',
                'ktlo-current-percentage',
                'ktlo-current-description',
            ];
            ktloMonthlyFields.forEach((id) => {
                const element = document.getElementById(id);
                if (element) {
                    element.addEventListener('input', function () {
                        saveCurrentKTLOData();
                        debouncedGeneratePreview();
                    });
                    element.addEventListener('change', function () {
                        saveCurrentKTLOData();
                        debouncedGeneratePreview();
                    });
                }
            });

            // Add listeners to existing EPIC and story elements
            addListenersToExistingElements();
        }

        /**
         * Validate that end date is not before start date
         */

        function addListenersToExistingElements() {
            // EPIC name fields
            document.querySelectorAll('[id^="epic-name-"]').forEach((element) => {
                element.addEventListener('input', debouncedGeneratePreview);
                element.addEventListener('change', debouncedGeneratePreview);
            });

            // Story fields
            document
                .querySelectorAll(
                    '[id^="story-title-"], [id^="story-start-"], [id^="story-end-"], [id^="story-bullets-"], [id^="story-imo-"], input[id^="story-fte-"]'
                )
                .forEach((element) => {
                    element.addEventListener('input', debouncedGeneratePreview);
                    element.addEventListener('change', debouncedGeneratePreview);
                });

            // Add validation to story end date fields
            document.querySelectorAll('[id^="story-end-"]').forEach((element) => {
                if (!element.dataset.hasValidation) {
                    element.addEventListener('blur', validateEndDate);
                    // Clear error styling when user starts typing
                    element.addEventListener('input', function () {
                        this.style.borderColor = '';
                        this.style.backgroundColor = '';
                    });
                    element.dataset.hasValidation = 'true';
                }
            });

            // Story checkboxes (status, timeline changes, visibility)
            document
                .querySelectorAll(
                    '[id^="story-done-"], [id^="story-cancelled-"], [id^="story-atrisk-"], [id^="story-newstory-"], [id^="story-transferredout-"], [id^="story-changes-"], [id^="story-hide-from-search-"]'
                )
                .forEach((element) => {
                    element.addEventListener('change', debouncedGeneratePreview);
                });

            // Story status fields (done, cancel, at-risk, new story notes and dates)
            document
                .querySelectorAll(
                    '[id^="done-date-"], [id^="done-notes-"], [id^="cancel-date-"], [id^="cancel-notes-"], [id^="atrisk-date-"], [id^="atrisk-notes-"], [id^="newstory-date-"], [id^="newstory-notes-"]'
                )
                .forEach((element) => {
                    element.addEventListener('input', debouncedGeneratePreview);
                    element.addEventListener('change', debouncedGeneratePreview);
                });

            // Timeline change fields
            document
                .querySelectorAll(
                    '[id^="change-date-"], [id^="change-desc-"], [id^="change-prevstart-"], [id^="change-newstart-"], [id^="change-prev-"], [id^="change-new-"]'
                )
                .forEach((element) => {
                    element.addEventListener('input', debouncedGeneratePreview);
                    element.addEventListener('change', debouncedGeneratePreview);
                });

            // BTL story fields
            document
                .querySelectorAll(
                    '[id^="btl-title-"], [id^="btl-start-"], [id^="btl-end-"], [id^="btl-bullets-"], [id^="btl-imo-"], input[id^="btl-fte-"]'
                )
                .forEach((element) => {
                    element.addEventListener('input', debouncedGeneratePreview);
                    element.addEventListener('change', debouncedGeneratePreview);
                });

            // Add validation to BTL end date fields
            document.querySelectorAll('[id^="btl-end-"]').forEach((element) => {
                if (!element.dataset.hasValidation) {
                    element.addEventListener('blur', validateEndDate);
                    // Clear error styling when user starts typing
                    element.addEventListener('input', function () {
                        this.style.borderColor = '';
                        this.style.backgroundColor = '';
                    });
                    element.dataset.hasValidation = 'true';
                }
            });

            // Add validation to edit modal end date field
            const editEndField = document.getElementById('editEnd');
            if (editEndField && !editEndField.dataset.hasValidation) {
                editEndField.addEventListener('blur', validateEndDate);
                // Clear error styling when user starts typing
                editEndField.addEventListener('input', function () {
                    this.style.borderColor = '';
                    this.style.backgroundColor = '';
                });
                editEndField.dataset.hasValidation = 'true';
            }

            // Date pickers are now initialized when sections are expanded
        }

        function addListenersToElement(element) {
            // Helper function to add auto-update listeners to a single element
            if (element.type === 'checkbox') {
                element.addEventListener('change', debouncedGeneratePreview);
            } else {
                element.addEventListener('input', debouncedGeneratePreview);
                element.addEventListener('change', debouncedGeneratePreview);
            }
        }

        function addStory(epicId) {
            storyCounters[epicId]++;
            const storyId = `${epicId}-${storyCounters[epicId]}`;

            // Generate unique Story ID
            const storyUniqueId = createStoryId();

            const storyHtml = `
                <div class="story-section" id="story-${storyId}" data-story-id="${storyUniqueId}" draggable="true" ondragstart="handleStoryDragStart(event, '${storyId}')" ondragover="handleStoryDragOver(event)" ondrop="handleStoryDrop(event, '${storyId}')" ondragend="handleStoryDragEnd(event)">
                    <div class="story-summary">
                        <button id="story-collapse-btn-${storyId}" class="story-collapse-state collapse-btn-collapsed" onclick="toggleStoryCollapse('${storyId}')" title="Expand Story" tabindex="-1" aria-hidden="true">▶</button>
                        <svg class="story-drag-handle" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.5"></circle><circle cx="7.5" cy="2.5" r="1.5"></circle><circle cx="2.5" cy="8" r="1.5"></circle><circle cx="7.5" cy="8" r="1.5"></circle><circle cx="2.5" cy="13.5" r="1.5"></circle><circle cx="7.5" cy="13.5" r="1.5"></circle></svg>
                        <h4 id="story-header-title-${storyId}" class="story-summary-title" data-story-number="${storyCounters[epicId]}" onclick="toggleStoryCollapse('${storyId}')">Story ${storyCounters[epicId]}</h4>
                        <span id="story-status-chip-${storyId}" class="story-status-chip"></span>
                        <span id="story-date-range-${storyId}" class="story-date-range"></span>
                        <div class="story-row-actions">
                            <button onclick="moveStoryUp('${storyId}')" title="Move story up" aria-label="Move story up" tabindex="-1">▲</button>
                            <button onclick="moveStoryDown('${storyId}')" title="Move story down" aria-label="Move story down" tabindex="-1">▼</button>
                            <select class="story-move-select" data-story-id="${storyId}" title="Move to a different EPIC or Below the Line" aria-label="Move to a different EPIC or Below the Line" tabindex="-1" onchange="moveStoryToEpic(this, '${storyId}')">
                                <option value="">⇄</option>
                            </select>
                            <button class="story-delete-button" onclick="removeStory('${storyId}')" title="Delete story" aria-label="Delete story" tabindex="-1">×</button>
                        </div>
                    </div>
                    
                    <div id="story-content-${storyId}" class="story-content" style="display: none;">
                    <!-- Story Details Box -->
                    <div class="section-box">
                        <div class="section-box-title" style="display: flex; justify-content: space-between; align-items: center;">
                            <span>Story Details</span>
                            <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; font-weight: normal; color: #555; background: #f0f0f0; padding: 4px 10px; border-radius: 4px; border: 1px solid #ddd;">
                                <span style="text-align: left; line-height: 1.3;"><span style="white-space: nowrap;">Include in</span><br><span style="white-space: nowrap;">Product Roadmap</span></span>
                                <input type="checkbox" id="story-include-product-roadmap-${storyId}" checked style="margin: 0;"> 
                            </label>
                        </div>
                    <div class="form-group">
                        <label for="story-title-${storyId}">Story Title:</label>
                        <input type="text" id="story-title-${storyId}" placeholder="Story title">
                    </div>

                    <!-- Hidden Story ID field for data collection -->
                    <input type="hidden" id="story-id-${storyId}" value="${storyUniqueId}">
                    
                    <div class="inline-group">
                        <div class="form-group">
                            <label for="story-start-${storyId}">Start (Month or Date):</label>
                            <input type="text" id="story-start-${storyId}" placeholder="JAN, SEPT, 15/01/25, or 15-01-2025">
                        </div>
                        <div class="form-group">
                            <label for="story-end-${storyId}">End (Month or Date):</label>
                            <input type="text" id="story-end-${storyId}" placeholder="MAR, SEPT, 15/03/25, or 15-03-2025">
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label for="story-bullets-${storyId}">Bullet Points (one per line):</label>
                        <textarea id="story-bullets-${storyId}" placeholder="First bullet point\nSecond bullet point"></textarea>
                    </div>
                    
                    <div class="form-group" style="margin-top: 20px;">
                        <label for="story-director-vp-id-${storyId}">Director/VP ID <span style="font-style: italic; color: #888;">(optional)</span>:</label>
                        <input type="text" id="story-director-vp-id-${storyId}" placeholder="Enter identifier for filtering">
                    </div>
                    
                    <div class="form-group" style="display: flex; gap: 15px; align-items: flex-end;">
                        <div style="flex: 1;">
                            <label for="story-imo-${storyId}">CP/Project ID <span style="font-style: italic; color: #888;">(optional)</span>:</label>
                            <input type="text" id="story-imo-${storyId}" placeholder="0001">
                        </div>
                        <div style="flex: 1;">
                            <label for="story-priority-${storyId}">Priority <span style="font-style: italic; color: #888;">(optional)</span>:</label>
                            <select id="story-priority-${storyId}">
                                <option value="">Select...</option>
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                            </select>
                        </div>
                        <div style="flex: none; width: 118px;">
                            <label for="story-fte-${storyId}">FTE <span style="font-style: italic; color: #888;">(optional)</span>:</label>
                            <input type="number" id="story-fte-${storyId}" min="0" max="99" step="0.5" placeholder="1.5" aria-describedby="story-fte-hint-${storyId}">
                        </div>
                    </div>
                    <p class="field-hint" id="story-fte-hint-${storyId}" aria-live="polite">${FTE_HINT_DEFAULT}</p>

                    <div class="form-group">${renderCountryFlagsHTML({
                        id: (c) => `story-flag-${c.name.toLowerCase()}-${storyId}`,
                        onChange: (c) =>
                            c.code === 'global'
                                ? `clearStoryCountriesIfGlobalSelected('${storyId}')`
                                : `clearStoryGlobalIfCountrySelected('${storyId}')`,
                        checked: (c) => c.code === 'global',
                    })}</div>
                    
                    <div class="form-group" style="margin-top: 15px;">
                        <label for="story-comments-${storyId}">Comments <span style="font-style: italic; color: #888;">(optional, not shown on roadmap)</span>:</label>
                        <textarea id="story-comments-${storyId}" rows="3" style="resize: vertical;" placeholder="Add any notes or comments..."></textarea>
                    </div>
                    </div><!-- End Story Details Box -->
                    
                    <!-- Story Status Box -->
                    <div class="section-box">
                        <div class="section-box-title">Story Status</div>
                    
                    <!-- Row 1: New, Done, Cancelled, Info, Timeline -->
                    <div class="checkbox-group">
                        <input type="checkbox" id="story-newstory-${storyId}" onchange="handleNewStoryChange('${storyId}')">
                        <label for="story-newstory-${storyId}">New</label>
                        
                        <input type="checkbox" id="story-done-${storyId}" onchange="handleDoneChange('${storyId}')">
                        <label for="story-done-${storyId}">Done</label>
                        
                        <input type="checkbox" id="story-cancelled-${storyId}" onchange="handleCancelledChange('${storyId}')">
                        <label for="story-cancelled-${storyId}">Cancelled</label>
                        
                        <input type="checkbox" id="story-info-${storyId}" onchange="handleInfoChange('${storyId}')">
                        <label for="story-info-${storyId}">Info</label>
                        
                        <input type="checkbox" id="story-changes-${storyId}" onchange="toggleChanges('${storyId}')">
                        <label for="story-changes-${storyId}">Timeline</label>
                    </div>
                    
                    <!-- Row 2: At Risk, Proposed, Transferred: In, Out -->
                    <div class="checkbox-group">
                        <input type="checkbox" id="story-atrisk-${storyId}" onchange="handleAtRiskChange('${storyId}')">
                        <label for="story-atrisk-${storyId}">At Risk</label>
                        
                        <input type="checkbox" id="story-proposed-${storyId}" onchange="handleProposedChange('${storyId}')">
                        <label for="story-proposed-${storyId}">Proposed</label>
                        
                        <label style="margin-left: 8px; margin-right: 2px;">Transferred:</label>
                        <input type="checkbox" id="story-transferredin-${storyId}" onchange="handleTransferredInChange('${storyId}')">
                        <label for="story-transferredin-${storyId}" style="margin-right: 5px;">In</label>
                        
                        <input type="checkbox" id="story-transferredout-${storyId}" onchange="handleTransferredOutChange('${storyId}')">
                        <label for="story-transferredout-${storyId}">Out</label>
                    </div>

                    <!-- Row 3: Visibility -->
                    <div class="checkbox-group" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #ddd;">
                        <input type="checkbox" id="story-hide-from-search-${storyId}">
                        <label for="story-hide-from-search-${storyId}" title="When checked, this story will not appear in cross-team CP/timeline search results">Hide from cross-team search</label>
                    </div>

                    <!-- Done Section -->
                    <div id="done-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>Story Complete</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label for="done-date-${storyId}">Done Date:</label>
                                <input type="text" id="done-date-${storyId}" placeholder="07/10 or 07/10/25 or 07-10-2025">
                            </div>
                            <div class="form-group">
                                <label for="done-notes-${storyId}">Done Notes:</label>
                                <input type="text" id="done-notes-${storyId}" placeholder="Completion notes">
                            </div>
                        </div>
                    </div>
                    
                    <!-- Cancelled Section -->
                    <div id="cancelled-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>Story Cancellation</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label for="cancel-date-${storyId}">Cancel Date:</label>
                                <input type="text" id="cancel-date-${storyId}" placeholder="15/10 or 15/10/25 or 15-10-2025">
                            </div>
                            <div class="form-group">
                                <label for="cancel-notes-${storyId}">Cancel Notes:</label>
                                <input type="text" id="cancel-notes-${storyId}" placeholder="Cancellation reason">
                            </div>
                        </div>
                    </div>
                    
                    <!-- At Risk Section -->
                    <div id="atrisk-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>Story At Risk</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label for="atrisk-date-${storyId}">Warning Date:</label>
                                <input type="text" id="atrisk-date-${storyId}" placeholder="15/10 or 15/10/25 or 15-10-2025">
                            </div>
                            <div class="form-group">
                                <label for="atrisk-notes-${storyId}">Risk Description:</label>
                                <input type="text" id="atrisk-notes-${storyId}" placeholder="Describe the risk or warning">
                            </div>
                        </div>
                    </div>
                    
                    <!-- New Story Section -->
                    <div id="newstory-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>New Story</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label for="newstory-date-${storyId}">Announcement Date:</label>
                                <input type="text" id="newstory-date-${storyId}" placeholder="15/10 or 15/10/25 or 15-10-2025">
                            </div>
                            <div class="form-group">
                                <label for="newstory-notes-${storyId}">New Description:</label>
                                <input type="text" id="newstory-notes-${storyId}" placeholder="Describe what makes this story new">
                            </div>
                        </div>
                    </div>

                    <!-- Info Section -->
                    <div id="info-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>Story Information</h5>
                        <div id="info-entries-${storyId}">
                            <!-- Info entries will be added here -->
                            </div>
                        <button id="add-info-btn-${storyId}" onclick="addInfoEntry('${storyId}')" class="secondary" style="margin-top: 10px;">+ Add Info Entry</button>
                    </div>

                    <!-- Transferred In Section -->
                    <div id="transferredin-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>Story Transferred In Details</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label for="transferredin-date-${storyId}">Transfer In Date:</label>
                                <input type="text" id="transferredin-date-${storyId}" placeholder="15/01 or 15/01/25 or 15-01-2025">
                            </div>
                            <div class="form-group">
                                <label for="transferredin-notes-${storyId}">Transfer In Notes:</label>
                                <input type="text" id="transferredin-notes-${storyId}" placeholder="Transfer details">
                            </div>
                        </div>
                    </div>

                    <!-- Transferred Out Section -->
                    <div id="transferredout-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>Story Transferred Out Details</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label for="transferredout-date-${storyId}">Transfer Out Date:</label>
                                <input type="text" id="transferredout-date-${storyId}" placeholder="15/12 or 15/12/25 or 15-12-2025">
                            </div>
                            <div class="form-group">
                                <label for="transferredout-notes-${storyId}">Transfer Out Notes:</label>
                                <input type="text" id="transferredout-notes-${storyId}" placeholder="Transfer out details">
                            </div>
                        </div>
                    </div>

                    <!-- Proposed Section -->
                    <div id="proposed-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>Proposed Story</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label for="proposed-date-${storyId}">Proposed Date:</label>
                                <input type="text" id="proposed-date-${storyId}" placeholder="15/01 or 15/01/25 or 15-01-2025">
                            </div>
                            <div class="form-group">
                                <label for="proposed-notes-${storyId}">Proposed Notes:</label>
                                <input type="text" id="proposed-notes-${storyId}" placeholder="Proposal details">
                            </div>
                        </div>
                    </div>
                    
                    <!-- Story Timeline Section -->
                    <div id="changes-section-${storyId}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h5>Story Timeline</h5>
                        <div id="changes-container-${storyId}">
                            <!-- Story timeline entries will be added here -->
                        </div>
                        <button id="add-change-btn-${storyId}" onclick="addChange('${storyId}')" class="secondary">+ Add Timeline Entry</button>
                    </div>
                    </div><!-- End Story Status Box -->
                    </div>
                </div>
            `;

            document
                .getElementById(`stories-container-${epicId}`)
                .insertAdjacentHTML('beforeend', storyHtml);
            updateEpicStoryMeta(epicId);

            // Initialize the collapsed title display
            updateStoryHeaderTitle(storyId, true);

            // Add auto-update listeners to the new story elements
            const storyFields = [
                `story-title-${storyId}`,
                `story-start-${storyId}`,
                `story-end-${storyId}`,
                `story-bullets-${storyId}`,
                `story-director-vp-id-${storyId}`,
                `story-imo-${storyId}`,
                `story-priority-${storyId}`,
                `story-fte-${storyId}`,
                `done-date-${storyId}`,
                `done-notes-${storyId}`,
                `cancel-date-${storyId}`,
                `cancel-notes-${storyId}`,
                `atrisk-date-${storyId}`,
                `atrisk-notes-${storyId}`,
                `newstory-date-${storyId}`,
                `newstory-notes-${storyId}`,
                `info-date-${storyId}`,
                `info-notes-${storyId}`,
                `transferredout-date-${storyId}`,
                `transferredout-notes-${storyId}`,
                `transferredin-date-${storyId}`,
                `transferredin-notes-${storyId}`,
                `proposed-date-${storyId}`,
                `proposed-notes-${storyId}`,
            ];

            storyFields.forEach((fieldId) => {
                const element = document.getElementById(fieldId);
                if (element) {
                    addListenersToElement(element);
                }
            });

            // Add listener to story title to update header when collapsed
            const titleInput = document.getElementById(`story-title-${storyId}`);
            if (titleInput) {
                titleInput.addEventListener('input', function () {
                    const contentDiv = document.getElementById(`story-content-${storyId}`);
                    if (contentDiv && contentDiv.style.display === 'none') {
                        // Story is collapsed, update the header title
                        updateStoryHeaderTitle(storyId, true);
                    }
                });
            }

            // Date pickers will be initialized when EPIC is expanded

            // Add listeners to checkboxes (these need special handling in the existing onchange handlers)
            const checkboxes = [
                `story-done-${storyId}`,
                `story-cancelled-${storyId}`,
                `story-atrisk-${storyId}`,
                `story-newstory-${storyId}`,
                `story-info-${storyId}`,
                `story-transferredout-${storyId}`,
                `story-transferredin-${storyId}`,
                `story-proposed-${storyId}`,
                `story-changes-${storyId}`,
            ];

            checkboxes.forEach((checkboxId) => {
                const element = document.getElementById(checkboxId);
                if (element) {
                    // Add auto-update listener that will fire after the existing onchange handler
                    element.addEventListener('change', debouncedGeneratePreview);
                }
            });

            // Initialize date pickers for the newly created story
            setTimeout(() => {
                const startField = document.getElementById(`story-start-${storyId}`);
                const endField = document.getElementById(`story-end-${storyId}`);

                if (startField) {
                    initializeDatePicker(startField, true);
                }
                if (endField) {
                    initializeDatePicker(endField, true);
                    // Add validation listener
                    if (!endField.dataset.hasValidation) {
                        endField.addEventListener('blur', validateEndDate);
                        // Clear error styling when user starts typing
                        endField.addEventListener('input', function () {
                            this.style.borderColor = '';
                            this.style.backgroundColor = '';
                        });
                        endField.dataset.hasValidation = 'true';
                    }
                }

                // Initialize all status date fields that may be shown later
                initializeDatePicker(document.getElementById(`done-date-${storyId}`), false);
                initializeDatePicker(document.getElementById(`cancel-date-${storyId}`), false);
                initializeDatePicker(document.getElementById(`atrisk-date-${storyId}`), false);
                initializeDatePicker(document.getElementById(`newstory-date-${storyId}`), false);
                initializeDatePicker(document.getElementById(`info-date-${storyId}`), false);
                initializeDatePicker(
                    document.getElementById(`transferredin-date-${storyId}`),
                    false
                );
                initializeDatePicker(
                    document.getElementById(`transferredout-date-${storyId}`),
                    false
                );
                initializeDatePicker(document.getElementById(`proposed-date-${storyId}`), false);
            }, 200); // Increased delay to ensure DOM elements are ready
        }

        function removeStory(storyId) {
            // Extract the epic ID from the story ID (format: epicId-storyNumber)
            const epicId = storyId.split('-')[0];

            // Remove the story element
            document.getElementById(`story-${storyId}`).remove();

            // Find the epic element and update story numbers. storyCounters[epicId]
            // is left alone (not reset to the remaining count): it's purely a
            // monotonically-increasing source for unique story DOM-id suffixes,
            // unrelated to the "Story N" labels (those come from DOM position via
            // updateStoryNumbers below). Resetting it here let a later addStory
            // reuse an id suffix a later-numbered sibling still holds - e.g.
            // removing story 1 of 5 dropped the counter to 4, so the next add
            // regenerated id "...-5", colliding with the untouched original story
            // 5 and silently overwriting its fields via the duplicate id.
            const epicElement = document.getElementById(`epic-${epicId}`);
            if (epicElement) {
                updateStoryNumbers(epicElement);
            }

            // Refresh the roadmap preview
            generatePreview();
        }

        let btlStoryCounter = 0;

        function addBTLStory() {
            btlStoryCounter++;
            const storyId = `btl-${btlStoryCounter}`;

            const storyHtml = `
                <div class="story-section" id="story-${storyId}" draggable="true" ondragstart="handleStoryDragStart(event, '${storyId}')" ondragover="handleStoryDragOver(event)" ondrop="handleStoryDrop(event, '${storyId}')" ondragend="handleStoryDragEnd(event)">
                    <div class="story-summary">
                        <button id="story-collapse-btn-${storyId}" class="story-collapse-state collapse-btn-collapsed" onclick="toggleStoryCollapse('${storyId}')" title="Expand Story" tabindex="-1" aria-hidden="true">▶</button>
                        <svg class="story-drag-handle" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.5"></circle><circle cx="7.5" cy="2.5" r="1.5"></circle><circle cx="2.5" cy="8" r="1.5"></circle><circle cx="7.5" cy="8" r="1.5"></circle><circle cx="2.5" cy="13.5" r="1.5"></circle><circle cx="7.5" cy="13.5" r="1.5"></circle></svg>
                        <h4 id="story-header-title-${storyId}" class="story-summary-title" data-story-number="${btlStoryCounter}" onclick="toggleStoryCollapse('${storyId}')">Story ${btlStoryCounter}</h4>
                        <span id="story-status-chip-${storyId}" class="story-status-chip"></span>
                        <span id="story-date-range-${storyId}" class="story-date-range"></span>
                        <div class="story-row-actions">
                            <button onclick="moveBTLStoryUp('${storyId}')" title="Move story up" aria-label="Move story up" tabindex="-1">▲</button>
                            <button onclick="moveBTLStoryDown('${storyId}')" title="Move story down" aria-label="Move story down" tabindex="-1">▼</button>
                            <select class="story-move-select" data-story-id="${storyId}" title="Move to a different EPIC" aria-label="Move to a different EPIC" tabindex="-1" onchange="moveStoryToEpic(this, '${storyId}')">
                                <option value="">⇄</option>
                            </select>
                            <button class="story-delete-button" onclick="deleteBTLStory('${storyId}')" title="Delete story" aria-label="Delete story" tabindex="-1">×</button>
                        </div>
                    </div>
                    
                    <div id="story-content-${storyId}" class="story-content" style="display: none;">
                    <div class="form-group">
                        <label for="btl-title-${storyId}">Story Title:</label>
                        <input type="text" id="btl-title-${storyId}" placeholder="Story title">
                    </div>
                    
                    <div class="inline-group">
                        <div class="form-group">
                            <label for="btl-start-${storyId}">Start (Month or Date):</label>
                            <input type="text" id="btl-start-${storyId}" placeholder="JAN, SEPT, 15/01/25, or 15-01-2025">
                        </div>
                        <div class="form-group">
                            <label for="btl-end-${storyId}">End (Month or Date):</label>
                            <input type="text" id="btl-end-${storyId}" placeholder="MAR, SEPT, 15/03/25, or 15-03-2025">
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label for="btl-bullets-${storyId}">Bullet Points (one per line):</label>
                        <textarea id="btl-bullets-${storyId}" placeholder="First bullet point\nSecond bullet point"></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label for="btl-dateadded-${storyId}">Date Added:</label>
                        <input type="text" id="btl-dateadded-${storyId}" placeholder="15/01/25 or 15-01-2025">
                    </div>
                    
                    <div class="form-group">
                        <label for="btl-description-${storyId}">Description (optional):</label>
                        <input type="text" id="btl-description-${storyId}" placeholder="Why was this added?">
                    </div>
                    
                    <div class="form-group">
                        <label for="btl-imo-${storyId}">CP/Project ID <span style="font-style: italic; color: #888;">(optional)</span>:</label>
                        <input type="text" id="btl-imo-${storyId}" placeholder="0001">
                    </div>

                    <div class="form-group" style="display: flex; gap: 15px; align-items: flex-end;">
                        <div style="flex: 1;">
                            <label for="btl-priority-${storyId}">Priority <span style="font-style: italic; color: #888;">(optional)</span>:</label>
                            <select id="btl-priority-${storyId}">
                                <option value="">Select...</option>
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                            </select>
                        </div>
                        <div style="flex: none; width: 118px;">
                            <label for="btl-fte-${storyId}">FTE <span style="font-style: italic; color: #888;">(optional)</span>:</label>
                            <input type="number" id="btl-fte-${storyId}" min="0" max="99" step="0.5" placeholder="1.5" aria-describedby="btl-fte-hint-${storyId}">
                        </div>
                    </div>
                    <p class="field-hint" id="btl-fte-hint-${storyId}" aria-live="polite">${FTE_HINT_DEFAULT}</p>

                    <div class="form-group">
                        <label for="btl-comments-${storyId}">Comments <span style="font-style: italic; color: #888;">(optional, not shown on roadmap)</span>:</label>
                        <textarea id="btl-comments-${storyId}" rows="3" style="resize: vertical;" placeholder="Add any notes or comments..."></textarea>
                    </div>
                    </div>
                </div>
            `;

            document
                .getElementById('btl-stories-container')
                .insertAdjacentHTML('beforeend', storyHtml);

            // Initialize the collapsed title display
            updateStoryHeaderTitle(storyId, true);

            // Add auto-update listeners to the new BTL story elements
            const btlFields = [
                `btl-title-${storyId}`,
                `btl-start-${storyId}`,
                `btl-end-${storyId}`,
                `btl-bullets-${storyId}`,
                `btl-dateadded-${storyId}`,
                `btl-description-${storyId}`,
                `btl-imo-${storyId}`,
                `btl-priority-${storyId}`,
                `btl-fte-${storyId}`,
                `btl-comments-${storyId}`,
            ];

            btlFields.forEach((fieldId) => {
                const element = document.getElementById(fieldId);
                if (element) {
                    addListenersToElement(element);
                }
            });

            // Add listener to BTL story title to update header when collapsed
            const btlTitleInput = document.getElementById(`btl-title-${storyId}`);
            if (btlTitleInput) {
                btlTitleInput.addEventListener('input', function () {
                    const contentDiv = document.getElementById(`story-content-${storyId}`);
                    if (contentDiv && contentDiv.style.display === 'none') {
                        // Story is collapsed, update the header title
                        updateStoryHeaderTitle(storyId, true);
                    }
                });
            }

            // Initialize date pickers for BTL date fields immediately since BTL is always expanded
            initializeDatePicker(document.getElementById(`btl-start-${storyId}`), true);
            const btlEndField = document.getElementById(`btl-end-${storyId}`);
            if (btlEndField) {
                initializeDatePicker(btlEndField, true);
                // Add validation listener
                if (!btlEndField.dataset.hasValidation) {
                    btlEndField.addEventListener('blur', validateEndDate);
                    // Clear error styling when user starts typing
                    btlEndField.addEventListener('input', function () {
                        this.style.borderColor = '';
                        this.style.backgroundColor = '';
                    });
                    btlEndField.dataset.hasValidation = 'true';
                }
            }
            initializeDatePicker(document.getElementById(`btl-dateadded-${storyId}`), false);

            updateBTLAddButton();
        }

        // BTL delete function for main form
        function deleteBTLStory(storyId) {
            const elementToRemove = document.getElementById(`story-${storyId}`);
            if (elementToRemove) {
                elementToRemove.remove();
                updateBTLAddButton();
                generatePreview();
            }
        }

        // Keeps the BTL section's story count in step with its contents. It used to
        // also cap the section at three stories (disabling the add button, and
        // refusing the fourth) — that cap is gone, so BTL grows like an EPIC does.
        function updateBTLAddButton() {
            const existingBTLStories = document.querySelectorAll(
                '#btl-stories-container .story-section'
            );
            const meta = document.getElementById('btl-story-meta');
            const count = existingBTLStories.length;
            if (meta) meta.textContent = `${count} ${count === 1 ? 'story' : 'stories'}`;
        }

        // Story-form timeline-change handlers (toggleChanges) are now in
        // ./timeline-changes.js. The factory is wired at the top of init().

        function getTodaysDateEuropean() {
            return DateUtility.getTodaysDateEuropean();
        }

        // Utility function to get current roadmap year
        function getCurrentRoadmapYear() {
            return (
                parseInt(document.getElementById('roadmapYear').value) || new Date().getFullYear()
            );
        }

        // Simple date picker helper using native HTML5 date input

        // Status checkboxes (Done/Cancelled/At Risk/New/Info/Transferred In/Out/
        // Proposed) are now in ./status.js. The factory is wired at the top of
        // init() and exposes the handlers on window for inline onchange attrs.

        // Story-form info entry helpers (addInfoEntry/removeInfoEntry/
        // convertSingleInfoToMultiple) are in ./info-entries.js. The Edit
        // Story modal variants stay here because loadStoryData mutates
        // editInfoEntryCounter directly to render saved entries; sharing
        // that primitive across the module boundary isn't worth the API
        // surface for two functions.
        let editInfoEntryCounter = 0;

        function addEditInfoEntry() {
            const entriesContainer = document.getElementById('editInfoEntries');
            const entryId = `edit-info-entry-${editInfoEntryCounter++}`;
            const existingEntries = entriesContainer.querySelectorAll('.info-entry');
            const entryNumber = existingEntries.length + 1;

            const entryHtml = `
                <div id="${entryId}" class="info-entry" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <strong>Info Entry #${entryNumber}</strong>
                        <button type="button" onclick="removeEditInfoEntry('${entryId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">Remove</button>
                    </div>
                    <div class="inline-group">
                        <div class="form-group">
                            <label for="edit-info-date-${entryId}">Info Date:</label>
                            <input type="text" id="edit-info-date-${entryId}" placeholder="15/01 or 15/01/25 or 15-01-2025">
                        </div>
                        <div class="form-group">
                            <label for="edit-info-notes-${entryId}">Information Details:</label>
                            <textarea id="edit-info-notes-${entryId}" placeholder="Additional information about this story (multiple lines supported)" rows="3" style="height: 60px;"></textarea>
                        </div>
                    </div>
                </div>
            `;
            entriesContainer.insertAdjacentHTML('beforeend', entryHtml);

            const dateField = document.getElementById(`edit-info-date-${entryId}`);
            if (dateField) {
                dateField.value = DateUtility.getTodaysDateEuropean();
                dateField.focus({ preventScroll: true });
            }
        }

        function removeEditInfoEntry(entryId) {
            const entry = document.getElementById(entryId);
            if (entry) entry.remove();
        }

        function updateStoryNumbers(epicElement) {
            const stories = epicElement.querySelectorAll('.story-section');
            stories.forEach((story, index) => {
                const storyNumber = index + 1;
                const storyId = story.id.replace('story-', '');
                const titleElement = story.querySelector('h4');
                if (titleElement) {
                    const contentDiv = document.getElementById(`story-content-${storyId}`);
                    const isCollapsed = contentDiv && contentDiv.style.display === 'none';
                    titleElement.dataset.storyNumber = String(storyNumber);
                    updateStoryHeaderTitle(storyId, isCollapsed);
                }
            });
            const epicId = epicElement.id.replace('epic-', '');
            updateEpicStoryMeta(epicId);
        }

        function generatePreview() {
            if (isGeneratingPreview) return;
            isGeneratingPreview = true;
            refreshBuilderSummaries();

            const mount = document.getElementById('roadmap-mount');
            try {
                if (typeof RoadmapGenerator === 'undefined') {
                    console.error('RoadmapGenerator is undefined');
                    if (mount)
                        mount.innerHTML = `<div style="padding:20px; color:red;">RoadmapGenerator failed to load. Refresh and try again.</div>`;
                    return;
                }
                if (typeof DateUtility === 'undefined') {
                    console.error('DateUtility is undefined');
                    if (mount)
                        mount.innerHTML = `<div style="padding:20px; color:red;">DateUtility failed to load. Refresh and try again.</div>`;
                    return;
                }

                const teamData = collectFormData();

                // Preserve mount scroll across re-render so editing in the
                // middle of a long roadmap doesn't snap to the top.
                const savedScrollTop = mount ? mount.scrollTop : 0;
                const savedScrollLeft = mount ? mount.scrollLeft : 0;

                roadmapState.setState(teamData);
                renderRoadmapToMount(teamData);

                if (mount) {
                    mount.scrollTop = savedScrollTop;
                    mount.scrollLeft = savedScrollLeft;
                }

                if (ftePopStoryId && mount) {
                    const changed = mount.querySelector(
                        `.story-item[data-json-story-id="${CSS.escape(ftePopStoryId)}"] .fte-tag`
                    );
                    if (changed) changed.classList.add('is-changing');
                    ftePopStoryId = null;
                }

                // Fullscreen overlay still uses an iframe with the export-style
                // full document; it reads currentTeamData when shown.
                window.currentTeamData = teamData;
            } catch (error) {
                if (mount) {
                    mount.innerHTML = `<div style="padding:20px; color:red;">
                        <h3>Error generating roadmap</h3>
                        <p>${error.message}</p>
                    </div>`;
                }
            } finally {
                isGeneratingPreview = false;
            }
        }

        function initializeIframeInteraction(iframe) {
            try {
                // Wait a bit for iframe content to fully load
                setTimeout(() => {
                    const setupStoryInteraction = () => {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                        const storyItems = iframeDoc.querySelectorAll('.story-item, .ktlo-story');

                        if (storyItems.length === 0) {
                            // Retry after 200ms
                            setTimeout(setupStoryInteraction, 200);
                            return;
                        }

                        // Setup January/December monthly box priming for iframe
                        setupMonthlyBoxPriming(iframeDoc);

                        storyItems.forEach((story) => {
                            // Add single-click event listener to open edit modal
                            story.addEventListener('click', function (e) {
                                e.preventDefault();
                                e.stopPropagation();

                                const storyData = {
                                    epicName: this.dataset.epicName,
                                    storyTitle: this.dataset.storyTitle,
                                    storyIndex: this.dataset.storyIndex,
                                };

                                // Call parent window function to open the edit modal
                                parent.openEditStoryModal(storyData);
                            });

                            // Add double-click event listener to open edit modal (kept for consistency)
                            story.addEventListener('dblclick', function (e) {
                                e.preventDefault();
                                e.stopPropagation();

                                const storyData = {
                                    epicName: this.dataset.epicName,
                                    storyTitle: this.dataset.storyTitle,
                                    storyIndex: this.dataset.storyIndex,
                                };

                                // Call parent window function to open the edit modal
                                parent.openEditStoryModal(storyData);
                            });

                            // Add visual indicator that stories are clickable
                            story.style.cursor = 'pointer';
                        });
                    };

                    // Start the setup process
                    setupStoryInteraction();

                    // Add draggable alignment guide
                    addAlignmentGuide(iframe);
                }, 500); // Wait 500ms for iframe content to fully render
            } catch {
                // Story interaction initialization failed, continue without it
            }
        }

        function addAlignmentGuide(iframe) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                const roadmapContainer = iframeDoc.querySelector('.roadmap-container');

                if (!roadmapContainer) {
                    return; // No roadmap container found
                }

                // Create the alignment guide line
                const guideLine = iframeDoc.createElement('div');
                guideLine.id = 'alignment-guide';
                guideLine.style.cssText = `
                    position: absolute;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background-color: #ff6b6b;
                    border: 1px solid #ff5252;
                    top: 50%;
                    z-index: 1000;
                    cursor: ns-resize;
                    opacity: 0.7;
                    box-shadow: 0 0 4px rgba(255, 107, 107, 0.5);
                    pointer-events: auto;
                    display: none;
                `;

                // Add a small handle in the center for easier grabbing
                const handle = iframeDoc.createElement('div');
                handle.style.cssText = `
                    position: absolute;
                    left: 50%;
                    top: -4px;
                    width: 40px;
                    height: 10px;
                    background-color: #ff6b6b;
                    border: 1px solid #ff5252;
                    border-radius: 5px;
                    transform: translateX(-50%);
                    cursor: ns-resize;
                `;
                guideLine.appendChild(handle);

                // Make the roadmap container relatively positioned if it isn't already
                const containerStyle = iframe.contentWindow.getComputedStyle(roadmapContainer);
                if (containerStyle.position === 'static') {
                    roadmapContainer.style.position = 'relative';
                }

                // Add the guide line to the roadmap container
                roadmapContainer.appendChild(guideLine);

                // Make it draggable
                let isDragging = false;
                let startY = 0;
                let startTop = 0;

                const onMouseDown = (e) => {
                    isDragging = true;
                    startY = e.clientY;
                    startTop = guideLine.offsetTop;

                    // Change opacity while dragging
                    guideLine.style.opacity = '1';

                    // Prevent text selection
                    iframeDoc.body.style.userSelect = 'none';
                    e.preventDefault();
                };

                const onMouseMove = (e) => {
                    if (!isDragging) return;

                    const deltaY = e.clientY - startY;
                    const newTop = startTop + deltaY;
                    const containerHeight = roadmapContainer.offsetHeight;

                    // Constrain within roadmap container bounds
                    const clampedTop = Math.max(0, Math.min(newTop, containerHeight - 4));
                    guideLine.style.top = clampedTop + 'px';

                    e.preventDefault();
                };

                const onMouseUp = () => {
                    if (isDragging) {
                        isDragging = false;
                        guideLine.style.opacity = '0.7';
                        iframeDoc.body.style.userSelect = '';
                    }
                };

                // Add event listeners
                guideLine.addEventListener('mousedown', onMouseDown);
                iframeDoc.addEventListener('mousemove', onMouseMove);
                iframeDoc.addEventListener('mouseup', onMouseUp);

                // Also listen on the parent window to handle mouse leaving iframe
                window.addEventListener('mousemove', (e) => {
                    if (isDragging) {
                        // Convert parent window coordinates to iframe coordinates
                        const iframeRect = iframe.getBoundingClientRect();
                        const iframeEvent = {
                            clientY: e.clientY - iframeRect.top,
                        };
                        onMouseMove(iframeEvent);
                    }
                });

                window.addEventListener('mouseup', onMouseUp);

                // Toggle function for keyboard shortcut
                const toggleAlignmentGuide = () => {
                    const isVisible = guideLine.style.display !== 'none';
                    guideLine.style.display = isVisible ? 'none' : 'block';
                };

                // Keyboard shortcut handler (Cmd+Shift+L or Ctrl+Shift+L)
                const handleKeydown = (e) => {
                    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
                        e.preventDefault();
                        toggleAlignmentGuide();
                    }
                };

                // Add keyboard listeners to both iframe and parent window
                iframeDoc.addEventListener('keydown', handleKeydown);
                window.addEventListener('keydown', handleKeydown);

                // Store the toggle function globally so it can be called from elsewhere if needed
                iframe.contentWindow.toggleAlignmentGuide = toggleAlignmentGuide;

                // Log the keyboard shortcut for user reference
            } catch {}
        }

        function collectFormData() {
            const teamData = {
                roadmapYear: parseInt(document.getElementById('roadmapYear').value) || 2025,
                teamName: document.getElementById('teamName').value || 'My Team',
                directorVP: document.getElementById('directorVP').value || '',
                em: document.getElementById('em').value || 'Engineering Manager',
                pm: document.getElementById('pm').value || 'Product Manager',
                description: [],
                epics: [],
            };

            // Collect description
            const description = document.getElementById('teamDescription').value;
            if (description && description.trim()) {
                teamData.description = description.trim();
            }

            // Collect EPICs
            const epicElements = document.querySelectorAll('.epic-section');
            epicElements.forEach((epicEl) => {
                const epicId = epicEl.id.split('-')[1];
                const epicNameEl = document.getElementById(`epic-name-${epicId}`);
                const epicUniqueIdEl = document.getElementById(`epic-id-${epicId}`);

                // Ensure we always have a valid EPIC name
                let epicName = `EPIC ${epicId}`; // Default fallback
                if (epicNameEl && epicNameEl.value !== null && epicNameEl.value !== undefined) {
                    const inputValue = String(epicNameEl.value).trim();
                    if (inputValue.length > 0) {
                        epicName = inputValue;
                    }
                }

                // Skip invalid EPICs (missing name element or ID)
                if (!epicNameEl || !epicId || epicId === 'undefined' || epicId === 'null') {
                    return; // Skip this EPIC
                }

                const epic = {
                    name: epicName,
                    epicId: epicUniqueIdEl ? epicUniqueIdEl.value : null, // Add unique EPIC ID
                    stories: [],
                };

                // Collect stories for this EPIC
                const storyElements = epicEl.querySelectorAll('.story-section');
                const stories = [];
                storyElements.forEach((storyEl) => {
                    const storyId = storyEl.id.replace('story-', '');
                    try {
                        const story = collectStoryData(storyId);
                        // Add story as-is without modifying the title
                        stories.push(story);
                    } catch {
                        // Add a basic story if collection fails
                        stories.push({
                            title: `Story ${stories.length + 1}`,
                            startMonth: 'JAN',
                            endMonth: 'MAR',
                            bullets: ['Default story'],
                        });
                    }
                });

                // Sort stories if the feature is enabled
                const sortByStart =
                    ConfigUtility.shouldSortStories() || ConfigUtility.shouldSortByStart();
                const sortByEnd = ConfigUtility.shouldSortByEnd();
                if (sortByStart || sortByEnd) {
                    stories.sort((a, b) => {
                        const aStart = a.startDate || a.startMonth || 'JAN';
                        const bStart = b.startDate || b.startMonth || 'JAN';
                        const aEnd = a.endDate || a.endMonth || 'MAR';
                        const bEnd = b.endDate || b.endMonth || 'MAR';
                        const year = parseInt(document.getElementById('roadmapYear').value) || 2025;
                        if (sortByEnd) {
                            const endComparison = DateUtility.compareDateOrMonth(aEnd, bEnd, year);
                            if (endComparison !== 0) return endComparison;
                            return DateUtility.compareDateOrMonth(aStart, bStart, year);
                        } else {
                            const startComparison = DateUtility.compareDateOrMonth(
                                aStart,
                                bStart,
                                year
                            );
                            if (startComparison !== 0) return startComparison;
                            return DateUtility.compareDateOrMonth(aEnd, bEnd, year);
                        }
                    });
                }

                epic.stories = stories;

                teamData.epics.push(epic);
            });

            // Collect KTLO data from form with fallback
            try {
                teamData.ktloSwimlane = collectKTLOData();
            } catch (error) {
                console.error('KTLO Collection Error:', error);

                // Provide fallback KTLO data
                teamData.ktloSwimlane = {
                    position: 'bottom',
                    story: {
                        title: 'KTLO',
                        bullets: [
                            'Keep the Lights On',
                            'Operational Excellence',
                            'Infrastructure Maintenance',
                        ],
                    },
                    monthlyData: [
                        {
                            month: 'JAN',
                            number: 15,
                            percentage: 85,
                            description: 'Server Maintenance',
                        },
                        {
                            month: 'FEB',
                            number: 12,
                            percentage: 90,
                            description: 'Database optimization',
                        },
                        {
                            month: 'MAR',
                            number: 18,
                            percentage: 88,
                            description: 'Security patches and monitoring',
                        },
                        {
                            month: 'APR',
                            number: 14,
                            percentage: 92,
                            description: 'Performance tuning',
                        },
                        {
                            month: 'MAY',
                            number: 16,
                            percentage: 87,
                            description: 'Backup system upgrades',
                        },
                        {
                            month: 'JUN',
                            number: 13,
                            percentage: 94,
                            description: 'Network infrastructure review',
                        },
                        {
                            month: 'JUL',
                            number: 17,
                            percentage: 89,
                            description: 'Application health checks',
                        },
                        {
                            month: 'AUG',
                            number: 11,
                            percentage: 93,
                            description: 'Documentation updates',
                        },
                        {
                            month: 'SEP',
                            number: 19,
                            percentage: 86,
                            description: 'Disaster recovery testing',
                        },
                        {
                            month: 'OCT',
                            number: 15,
                            percentage: 91,
                            description: 'Capacity planning review',
                        },
                        {
                            month: 'NOV',
                            number: 13,
                            percentage: 95,
                            description: 'Year-end maintenance',
                        },
                        {
                            month: 'DEC',
                            number: 10,
                            percentage: 88,
                            description: 'Holiday coverage',
                        },
                    ],
                };
            }

            // Collect BTL data
            try {
                teamData.btlSwimlane = collectBTLData();
            } catch {
                // Provide fallback BTL data
                teamData.btlSwimlane = {
                    stories: [], // Empty by default
                };
            }

            return teamData;
        }
        function collectStoryData(storyId) {
            const titleEl = document.getElementById(`story-title-${storyId}`);
            const storyUniqueIdEl = document.getElementById(`story-id-${storyId}`);
            const story = {
                title: titleEl ? titleEl.value || '' : '',
                storyId: storyUniqueIdEl ? storyUniqueIdEl.value : null, // Add unique Story ID
            };

            // Handle start/end dates
            const startEl = document.getElementById(`story-start-${storyId}`);
            const endEl = document.getElementById(`story-end-${storyId}`);
            const start = startEl ? startEl.value : '';
            const end = endEl ? endEl.value : '';

            // Helper function to ensure date has year and uses consistent "/" separator
            const ensureDateHasYear = (dateStr) => {
                if (!dateStr) return dateStr;
                // If date is in dd/mm or dd-mm format without year, normalize to "/" and add year
                if (/^\d{1,2}[-/]\d{1,2}$/.test(dateStr)) {
                    const roadmapYear =
                        parseInt(document.getElementById('roadmapYear').value) ||
                        new Date().getFullYear();
                    // Replace all "-" with "/" for consistency, then add year
                    const normalizedDate = dateStr.replace(/-/g, '/');
                    return normalizedDate + '/' + roadmapYear;
                }
                return dateStr;
            };

            // Determine if it's a month or date format
            if (start) {
                // Check for date formats: ISO (YYYY-MM-DD) or European (DD/MM or DD/MM/YYYY)
                if (start.includes('-') || start.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    story.startDate = ensureDateHasYear(start);
                } else {
                    story.startMonth = start.toUpperCase();
                }
            } else {
                // Default start month if not provided
                story.startMonth = 'JAN';
            }

            if (end) {
                // Check for date formats: ISO (YYYY-MM-DD) or European (DD/MM or DD/MM/YYYY)
                if (end.includes('-') || end.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    story.endDate = ensureDateHasYear(end);
                } else {
                    story.endMonth = end.toUpperCase();
                }
            } else {
                // Default end month if not provided
                story.endMonth = 'MAR';
            }

            // Handle bullets
            const bulletsEl = document.getElementById(`story-bullets-${storyId}`);
            const bullets = bulletsEl ? bulletsEl.value : '';
            if (bullets) {
                story.bullets = bullets.split('\n').filter((line) => line.trim());
            }

            // Handle Director/VP ID
            const directorVPIdEl = document.getElementById(`story-director-vp-id-${storyId}`);
            const directorVPId = directorVPIdEl ? directorVPIdEl.value.trim() : '';
            if (directorVPId) {
                story.directorVPId = directorVPId;
            }

            // Handle IMO
            const imoEl = document.getElementById(`story-imo-${storyId}`);
            const imo = imoEl ? imoEl.value.trim() : '';
            if (imo) {
                story.imo = imo;
            }

            // Handle Priority
            const priorityEl = document.getElementById(`story-priority-${storyId}`);
            const priority = priorityEl ? priorityEl.value : '';
            if (priority) {
                story.priority = priority;
            }

            // Handle FTE - only stored when it parses, so "unknown" stays absent
            // rather than becoming a misleading 0.
            const fteEl = document.getElementById(`story-fte-${storyId}`);
            const fte = parseFte(fteEl ? fteEl.value : '');
            if (fte !== null) {
                story.fte = fte;
            }

            // Handle Comments
            const commentsEl = document.getElementById(`story-comments-${storyId}`);
            const comments = commentsEl ? commentsEl.value.trim() : '';
            if (comments) {
                story.comments = comments;
            }

            // Handle Country Flags (default to Global if no flags selected)
            const countryFlags = [];
            if (document.getElementById(`story-flag-global-${storyId}`)?.checked)
                countryFlags.push('Global');
            if (document.getElementById(`story-flag-uk-${storyId}`)?.checked)
                countryFlags.push('UK');
            if (document.getElementById(`story-flag-iceland-${storyId}`)?.checked)
                countryFlags.push('Iceland');
            if (document.getElementById(`story-flag-hungary-${storyId}`)?.checked)
                countryFlags.push('Hungary');
            if (document.getElementById(`story-flag-spain-${storyId}`)?.checked)
                countryFlags.push('Spain');
            if (document.getElementById(`story-flag-italy-${storyId}`)?.checked)
                countryFlags.push('Italy');
            if (document.getElementById(`story-flag-portugal-${storyId}`)?.checked)
                countryFlags.push('Portugal');
            if (document.getElementById(`story-flag-czechia-${storyId}`)?.checked)
                countryFlags.push('Czechia');
            if (document.getElementById(`story-flag-germany-${storyId}`)?.checked)
                countryFlags.push('Germany');
            if (document.getElementById(`story-flag-slovakia-${storyId}`)?.checked)
                countryFlags.push('Slovakia');
            if (document.getElementById(`story-flag-slovenia-${storyId}`)?.checked)
                countryFlags.push('Slovenia');
            if (document.getElementById(`story-flag-croatia-${storyId}`)?.checked)
                countryFlags.push('Croatia');
            if (document.getElementById(`story-flag-france-${storyId}`)?.checked)
                countryFlags.push('France');
            // Default to Global if no flags are selected
            if (countryFlags.length === 0) {
                countryFlags.push('Global');
            }
            story.countryFlags = countryFlags;

            // Handle Include in Product Roadmap
            const includeInProductRoadmapEl = document.getElementById(
                `story-include-product-roadmap-${storyId}`
            );
            story.includeInProductRoadmap = includeInProductRoadmapEl
                ? includeInProductRoadmapEl.checked
                : false;

            // Handle status flags
            const doneEl = document.getElementById(`story-done-${storyId}`);
            const cancelledEl = document.getElementById(`story-cancelled-${storyId}`);
            const atRiskEl = document.getElementById(`story-atrisk-${storyId}`);
            const newStoryEl = document.getElementById(`story-newstory-${storyId}`);
            const infoEl = document.getElementById(`story-info-${storyId}`);
            const transferredOutEl = document.getElementById(`story-transferredout-${storyId}`);
            const transferredInEl = document.getElementById(`story-transferredin-${storyId}`);
            const proposedEl = document.getElementById(`story-proposed-${storyId}`);

            story.isDone = doneEl ? doneEl.checked : false;
            story.isCancelled = cancelledEl ? cancelledEl.checked : false;
            story.isAtRisk = atRiskEl ? atRiskEl.checked : false;
            story.isNewStory = newStoryEl ? newStoryEl.checked : false;
            story.isInfo = infoEl ? infoEl.checked : false;
            story.isTransferredOut = transferredOutEl ? transferredOutEl.checked : false;
            story.isTransferredIn = transferredInEl ? transferredInEl.checked : false;
            story.isProposed = proposedEl ? proposedEl.checked : false;

            // Visibility flag for cross-team search (default false = visible)
            const hideFromSearchEl = document.getElementById(`story-hide-from-search-${storyId}`);
            if (hideFromSearchEl && hideFromSearchEl.checked) {
                story.hideFromSearch = true;
            } else {
                delete story.hideFromSearch;
            }

            // Collect done info (regardless of timeline changes checkbox)
            const doneDateEl = document.getElementById(`done-date-${storyId}`);
            const doneNotesEl = document.getElementById(`done-notes-${storyId}`);
            const doneDate = doneDateEl ? doneDateEl.value : '';
            const doneNotes = doneNotesEl ? doneNotesEl.value : '';

            // Collect cancel info (regardless of timeline changes checkbox)
            const cancelDateEl = document.getElementById(`cancel-date-${storyId}`);
            const cancelNotesEl = document.getElementById(`cancel-notes-${storyId}`);
            const cancelDate = cancelDateEl ? cancelDateEl.value : '';
            const cancelNotes = cancelNotesEl ? cancelNotesEl.value : '';

            // Collect at risk info (regardless of timeline changes checkbox)
            const atRiskDateEl = document.getElementById(`atrisk-date-${storyId}`);
            const atRiskNotesEl = document.getElementById(`atrisk-notes-${storyId}`);
            const atRiskDate = atRiskDateEl ? atRiskDateEl.value : '';
            const atRiskNotes = atRiskNotesEl ? atRiskNotesEl.value : '';

            // Collect new story info (regardless of timeline changes checkbox)
            const newStoryDateEl = document.getElementById(`newstory-date-${storyId}`);
            const newStoryNotesEl = document.getElementById(`newstory-notes-${storyId}`);
            const newStoryDate = newStoryDateEl ? newStoryDateEl.value : '';
            const newStoryNotes = newStoryNotesEl ? newStoryNotesEl.value : '';

            // Collect info info (regardless of timeline changes checkbox)
            const infoEntries = [];
            const infoEntriesContainer = document.getElementById(`info-entries-${storyId}`);
            if (infoEntriesContainer) {
                const entryElements = infoEntriesContainer.querySelectorAll('.info-entry');
                entryElements.forEach((entry) => {
                    const entryId = entry.id;
                    const dateEl = document.getElementById(`info-date-${entryId}`);
                    const notesEl = document.getElementById(`info-notes-${entryId}`);
                    if (dateEl && notesEl) {
                        // Include entry even if empty, but only if the entry exists
                        infoEntries.push({
                            date: dateEl.value || '',
                            notes: notesEl.value || '',
                        });
                    }
                });
            }

            // Fallback: check for old single info fields
            if (infoEntries.length === 0) {
                const oldInfoDateEl = document.getElementById(`info-date-${storyId}`);
                const oldInfoNotesEl = document.getElementById(`info-notes-${storyId}`);
                if (
                    oldInfoDateEl &&
                    oldInfoNotesEl &&
                    (oldInfoDateEl.value || oldInfoNotesEl.value)
                ) {
                    infoEntries.push({
                        date: oldInfoDateEl.value,
                        notes: oldInfoNotesEl.value,
                    });
                }
            }

            // Collect transferred out info (regardless of timeline changes checkbox)
            const transferredOutDateEl = document.getElementById(`transferredout-date-${storyId}`);
            const transferredOutNotesEl = document.getElementById(
                `transferredout-notes-${storyId}`
            );
            const transferredOutDate = transferredOutDateEl ? transferredOutDateEl.value : '';
            const transferredOutNotes = transferredOutNotesEl ? transferredOutNotesEl.value : '';

            // Collect transferred in info (regardless of timeline changes checkbox)
            const transferredInDateEl = document.getElementById(`transferredin-date-${storyId}`);
            const transferredInNotesEl = document.getElementById(`transferredin-notes-${storyId}`);
            const transferredInDate = transferredInDateEl ? transferredInDateEl.value : '';
            const transferredInNotes = transferredInNotesEl ? transferredInNotesEl.value : '';

            // Collect proposed info (regardless of timeline changes checkbox)
            const proposedDateEl = document.getElementById(`proposed-date-${storyId}`);
            const proposedNotesEl = document.getElementById(`proposed-notes-${storyId}`);
            const proposedDate = proposedDateEl ? proposedDateEl.value : '';
            const proposedNotes = proposedNotesEl ? proposedNotesEl.value : '';

            // Check if we need to create roadmap changes for timeline changes, done, cancel, at risk, new story, or transferred out
            const timelineChangesEl = document.getElementById(`story-changes-${storyId}`);
            const hasTimelineChanges = timelineChangesEl ? timelineChangesEl.checked : false;

            // FOR TEXT BOX WIDTH: Count only checked checkboxes (consistent with display logic)
            const hasDoneInfo = doneEl ? doneEl.checked : false;
            const hasCancelInfo = cancelledEl ? cancelledEl.checked : false;
            const hasAtRiskInfo = atRiskEl ? atRiskEl.checked : false;
            const hasNewStoryInfo = newStoryEl ? newStoryEl.checked : false;
            const hasInfoInfo = infoEl ? infoEl.checked : false;
            const hasTransferredOutInfo = transferredOutEl ? transferredOutEl.checked : false;
            const hasTransferredInInfo = transferredInEl ? transferredInEl.checked : false;
            const hasProposedInfo = proposedEl ? proposedEl.checked : false;

            if (
                hasTimelineChanges ||
                hasDoneInfo ||
                hasCancelInfo ||
                hasAtRiskInfo ||
                hasNewStoryInfo ||
                hasInfoInfo ||
                hasTransferredOutInfo ||
                hasTransferredInInfo ||
                hasProposedInfo
            ) {
                story.hasRoadmapChanges = true;
                story.roadmapChanges = {
                    changes: [],
                    doneInfo: null,
                    cancelInfo: null,
                    atRiskInfo: null,
                    newStoryInfo: null,
                    infoInfo: null,
                    transferredOutInfo: null,
                    transferredInInfo: null,
                    proposedInfo: null,
                };

                // Collect timeline changes (only if checkbox is checked)
                if (hasTimelineChanges) {
                    // Find only the container divs (not the individual input fields)
                    const changeContainers = document.querySelectorAll(
                        `#changes-container-${storyId} > div[id^="change-${storyId}-change-"]`
                    );

                    changeContainers.forEach((changeEl) => {
                        // Use the full ID minus the "change-" prefix: "1-4-change-1750523789967"
                        const changeId = changeEl.id.replace('change-', ''); // Get: "1-4-change-1750523789967"
                        const date = document.getElementById(`change-date-${changeId}`)?.value;
                        const prevStart = document.getElementById(
                            `change-prevstart-${changeId}`
                        )?.value;
                        const newStart = document.getElementById(
                            `change-newstart-${changeId}`
                        )?.value;
                        const prevEnd = document.getElementById(`change-prev-${changeId}`)?.value;
                        const newEnd = document.getElementById(`change-new-${changeId}`)?.value;
                        const desc = document.getElementById(`change-desc-${changeId}`)?.value;

                        if (date && prevEnd && newEnd) {
                            story.roadmapChanges.changes.push({
                                date: ensureDateHasYear(date),
                                prevStartDate: prevStart ? ensureDateHasYear(prevStart) : '',
                                newStartDate: newStart ? ensureDateHasYear(newStart) : '',
                                prevEndDate: ensureDateHasYear(prevEnd),
                                newEndDate: ensureDateHasYear(newEnd),
                                description: desc || 'Story timeline change',
                            });
                        }
                    });

                    // Update story's actual start/end dates to reflect the most recent timeline change
                    if (story.roadmapChanges.changes.length > 0) {
                        // Sort timeline changes by date (most recent first)
                        const sortedChanges = [...story.roadmapChanges.changes].sort((a, b) => {
                            return DateUtility.compareDates(b.date, a.date); // Reverse order for most recent first
                        });

                        const mostRecentChange = sortedChanges[0];

                        // Update start date if the most recent change records one
                        if (mostRecentChange && mostRecentChange.newStartDate) {
                            const newStartDate = mostRecentChange.newStartDate;
                            if (
                                newStartDate.includes('-') ||
                                newStartDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)
                            ) {
                                story.startDate = newStartDate;
                                delete story.startMonth;
                                const startEl = document.getElementById(`story-start-${storyId}`);
                                if (startEl) startEl.value = newStartDate;
                            } else {
                                story.startMonth = newStartDate.toUpperCase();
                                delete story.startDate;
                                const startEl = document.getElementById(`story-start-${storyId}`);
                                if (startEl) startEl.value = newStartDate.toUpperCase();
                            }
                        }

                        // Get the newEndDate from the most recent change
                        if (mostRecentChange && mostRecentChange.newEndDate) {
                            const newEndDate = mostRecentChange.newEndDate;

                            // Determine if this is a date or month format and update accordingly
                            if (
                                newEndDate.includes('-') ||
                                newEndDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)
                            ) {
                                // It's a date format - update endDate and clear endMonth (already has year from ensureDateHasYear above)
                                story.endDate = newEndDate;
                                delete story.endMonth;

                                // Update the form field so user sees the change
                                const endEl = document.getElementById(`story-end-${storyId}`);
                                if (endEl) endEl.value = newEndDate;
                            } else {
                                // It's a month format - update endMonth and clear endDate
                                story.endMonth = newEndDate.toUpperCase();
                                delete story.endDate;

                                // Update the form field so user sees the change
                                const endEl = document.getElementById(`story-end-${storyId}`);
                                if (endEl) endEl.value = newEndDate.toUpperCase();
                            }
                        }
                    }
                }

                // FOR ROADMAP DATA: Only add if checkbox is checked (regardless of existing date/notes)
                if (story.isDone) {
                    story.roadmapChanges.doneInfo = {
                        date: ensureDateHasYear(doneDate) || '',
                        notes: doneNotes || '',
                    };
                }

                if (story.isCancelled) {
                    story.roadmapChanges.cancelInfo = {
                        date: ensureDateHasYear(cancelDate) || '',
                        notes: cancelNotes || '',
                    };
                }

                if (story.isAtRisk) {
                    story.roadmapChanges.atRiskInfo = {
                        date: ensureDateHasYear(atRiskDate) || '',
                        notes: atRiskNotes || '',
                    };
                }

                if (story.isNewStory) {
                    story.roadmapChanges.newStoryInfo = {
                        date: ensureDateHasYear(newStoryDate) || '',
                        notes: newStoryNotes || '',
                    };
                }

                if (story.isInfo) {
                    story.roadmapChanges.infoInfo = infoEntries.length > 0 ? infoEntries : [];
                }

                if (story.isTransferredOut) {
                    story.roadmapChanges.transferredOutInfo = {
                        date: ensureDateHasYear(transferredOutDate) || '',
                        notes: transferredOutNotes || '',
                    };
                }

                if (story.isTransferredIn) {
                    story.roadmapChanges.transferredInInfo = {
                        date: ensureDateHasYear(transferredInDate) || '',
                        notes: transferredInNotes || '',
                    };
                }

                if (story.isProposed) {
                    story.roadmapChanges.proposedInfo = {
                        date: ensureDateHasYear(proposedDate) || '',
                        notes: proposedNotes || '',
                    };
                }
            }

            return story;
        }

        function collectKTLOData() {
            const ktloTitleEl = document.getElementById('ktlo-title');
            const ktloBulletsEl = document.getElementById('ktlo-bullets');
            const ktloPositionEl = document.getElementById('ktlo-position-toggle');

            const ktloTitle = ktloTitleEl ? ktloTitleEl.value || 'KTLO' : 'KTLO';
            const ktloBulletsText = ktloBulletsEl
                ? ktloBulletsEl.value ||
                  'Keep the Lights On\nOperational Excellence\nInfrastructure Maintenance'
                : 'Keep the Lights On\nOperational Excellence\nInfrastructure Maintenance';
            const ktloBullets = ktloBulletsText.split('\n').filter((line) => line.trim());

            // Preserve 'hidden' position if it was set via JSON, otherwise use checkbox state
            let ktloPosition;
            if (ktloPositionEl && ktloPositionEl.dataset.originalPosition === 'hidden') {
                ktloPosition = 'hidden'; // Preserve hidden state
            } else {
                ktloPosition = ktloPositionEl
                    ? ktloPositionEl.checked
                        ? 'top'
                        : 'bottom'
                    : 'bottom';
            }

            // Save currently displayed month before collecting data
            saveCurrentKTLOData();

            const months = [
                'JAN',
                'FEB',
                'MAR',
                'APR',
                'MAY',
                'JUN',
                'JUL',
                'AUG',
                'SEP',
                'OCT',
                'NOV',
                'DEC',
            ];
            const monthlyData = [];

            months.forEach((month) => {
                const monthLower = month.toLowerCase();
                const data = ktloMonthlyData[monthLower];

                const number = data && data.number ? parseInt(data.number) || 0 : 0;
                const percentageValue = data && data.percentage ? data.percentage : '';

                // Validate percentage before saving
                if (percentageValue !== '' && !validateKTLOPercentage(percentageValue)) {
                    throw new Error(
                        `Invalid KTLO percentage for ${month}: "${percentageValue}". Must be blank or a multiple of 5 between 0 and 100.`
                    );
                }

                const percentage = percentageValue !== '' ? parseInt(percentageValue) || 0 : 0;
                const description = data && data.description ? data.description : '';

                monthlyData.push({
                    month: month,
                    number: number,
                    percentage: percentage,
                    description: description,
                });
            });

            return {
                position: ktloPosition,
                story: {
                    title: ktloTitle,
                    bullets: ktloBullets,
                },
                monthlyData: monthlyData,
            };
        }

        // Extract one BTL story's fields into the same JSON shape collectStoryData
        // produces for regular stories - shared by collectBTLData (bulk export) and
        // the epic-move feature (single-story extraction before re-homing it).
        function collectBTLStoryData(storyId) {
            const titleEl = document.getElementById(`btl-title-${storyId}`);
            const startEl = document.getElementById(`btl-start-${storyId}`);
            const endEl = document.getElementById(`btl-end-${storyId}`);
            const bulletsEl = document.getElementById(`btl-bullets-${storyId}`);
            const dateAddedEl = document.getElementById(`btl-dateadded-${storyId}`);
            const descriptionEl = document.getElementById(`btl-description-${storyId}`);

            const story = {
                title: titleEl ? titleEl.value || '' : '',
            };

            // Handle start/end dates
            const start = startEl ? startEl.value : '';
            const end = endEl ? endEl.value : '';

            // Determine if it's a month or date format
            if (start) {
                if (start.includes('-') || start.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    story.startDate = start;
                } else {
                    story.startMonth = start.toUpperCase();
                }
            } else {
                story.startMonth = 'JAN';
            }

            if (end) {
                if (end.includes('-') || end.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    story.endDate = end;
                } else {
                    story.endMonth = end.toUpperCase();
                }
            } else {
                story.endMonth = 'MAR';
            }

            // Handle bullets
            const bullets = bulletsEl ? bulletsEl.value : '';
            if (bullets) {
                story.bullets = bullets.split('\n').filter((line) => line.trim());
            }

            // Handle date added
            const dateAdded = dateAddedEl ? dateAddedEl.value : '';
            if (dateAdded) {
                story.dateAdded = dateAdded;
            }

            // Handle description
            const description = descriptionEl ? descriptionEl.value : '';
            if (description) {
                story.dateAddedDescription = description;
            }

            // Handle IMO
            const imoEl = document.getElementById(`btl-imo-${storyId}`);
            const imo = imoEl ? imoEl.value.trim() : '';
            if (imo) {
                story.imo = imo;
            }

            // Handle Priority
            const priorityEl = document.getElementById(`btl-priority-${storyId}`);
            const priority = priorityEl ? priorityEl.value : '';
            if (priority) {
                story.priority = priority;
            }

            // Handle FTE
            const fteEl = document.getElementById(`btl-fte-${storyId}`);
            const fte = parseFte(fteEl ? fteEl.value : '');
            if (fte !== null) {
                story.fte = fte;
            }

            // Handle Comments
            const commentsEl = document.getElementById(`btl-comments-${storyId}`);
            const comments = commentsEl ? commentsEl.value.trim() : '';
            if (comments) {
                story.comments = comments;
            }

            return story;
        }

        function collectBTLData() {
            const stories = [];

            // Collect all BTL stories
            const btlStoryElements = document.querySelectorAll(
                '#btl-stories-container .story-section'
            );
            btlStoryElements.forEach((storyEl) => {
                const storyId = storyEl.id.replace('story-', '');
                const story = collectBTLStoryData(storyId);

                if (story.title) {
                    // Only add stories with titles
                    stories.push(story);
                }
            });

            return {
                stories: stories,
            };
        }

        /**
         * Update the filename display
         */
        function updateFilenameDisplay(filename) {
            const displayDiv = document.getElementById('currentFilenameDisplay');
            const filenameInput = document.getElementById('currentFilename');

            if (filename) {
                filenameInput.value = filename;
                displayDiv.style.display = 'flex';
            } else {
                filenameInput.value = '';
                displayDiv.style.display = 'none';
            }
        }

        function newRoadmap() {
            // Set the current roadmap year as default in the modal
            const currentYear = getCurrentRoadmapYear();
            document.getElementById('newRoadmapYear').value = currentYear;

            // Show the new roadmap modal
            document.getElementById('newRoadmapModal').style.display = 'flex';

            // Focus on the year input
            setTimeout(() => {
                document.getElementById('newRoadmapYear').focus();
                document.getElementById('newRoadmapYear').select();
            }, 100);
        }

        function closeNewRoadmapModal() {
            document.getElementById('newRoadmapModal').style.display = 'none';
        }

        async function confirmNewRoadmap() {
            const selectedYear = parseInt(document.getElementById('newRoadmapYear').value);
            if (!selectedYear || selectedYear < 2020 || selectedYear > 2030) {
                alert('Please enter a valid year between 2020 and 2030.');
                return;
            }

            // Close the modal
            closeNewRoadmapModal();

            // New roadmap = no associated file or folder yet. Clear:
            //   - save module's per-file handle (so path 1 doesn't fire)
            //   - the shared folder/file selection (so path 2 doesn't fire
            //     and the Save button auto-disables via canSave())
            save.setFileHandle(null);
            await directoryStore.clear();

            // Immediately prompt for a save destination (filename + dir),
            // not just a folder. The new roadmap goes into single-file mode
            // pointing at that exact path - subsequent saves write there
            // without prompting. If the user cancels, they can still pick
            // later via the top-nav Load roadmaps button.
            const suggestedName = `MyTeam.Teya-Roadmap.${selectedYear}.json`;
            try {
                const result = await directoryStore.selectSaveLocation(suggestedName);
                if (result) {
                    // Hand the writable handle to save module so path 1
                    // fires for silent writes. Safari/Firefox return null
                    // here (selectSaveLocation is Chromium-only); they get
                    // a read-only editor with the Save button disabled.
                    if (result.fileHandle) save.setFileHandle(result.fileHandle);
                    updateFilenameDisplay(result.name);
                }
            } catch (error) {
                console.warn(error);
            }

            // Set flag to prevent KTLO data corruption during new roadmap creation
            window.isCreatingNewRoadmap = true;

            // Set the selected roadmap year
            document.getElementById('roadmapYear').value = selectedYear;

            // Clear team information
            document.getElementById('teamName').value = '';
            document.getElementById('directorVP').value = '';
            document.getElementById('em').value = '';
            document.getElementById('pm').value = '';
            document.getElementById('teamDescription').value = '';

            // Set default filename for new roadmap
            const defaultFilename = `MyTeam.Teya-Roadmap.${selectedYear}.json`;
            updateFilenameDisplay(defaultFilename);

            // Remove all epics
            const epics = document.querySelectorAll('.epic-section');
            epics.forEach((epic) => epic.remove());
            epicCounter = 0;
            storyCounters = {};

            // Clear date picker initialization tracking to allow new date pickers
            clearAllTracking();

            // Clear date picker initialization flags from any remaining elements
            document
                .querySelectorAll('[data-date-picker-initialized="true"]')
                .forEach((element) => {
                    element.removeAttribute('data-date-picker-initialized');
                });

            // Clear BTL stories
            const btlContainer = document.getElementById('btl-stories-container');
            if (btlContainer) {
                btlContainer.innerHTML = '';
            }
            btlStoryCounter = 0;
            updateBTLAddButton();

            // Reset KTLO to defaults but keep it
            document.getElementById('ktlo-title').value = 'Keep the lights on';
            document.getElementById('ktlo-bullets').value = '';
            const ktloToggle = document.getElementById('ktlo-position-toggle');
            if (ktloToggle) {
                ktloToggle.checked = false; // Default to bottom
                delete ktloToggle.dataset.originalPosition; // Clear any hidden state
            }
            showKTLOSection(); // Ensure KTLO section is visible in builder

            // Set default KTLO monthly data (10 and 25 for each month)
            ktloMonthlyData = {
                jan: { number: '10', percentage: '25', description: '' },
                feb: { number: '10', percentage: '25', description: '' },
                mar: { number: '10', percentage: '25', description: '' },
                apr: { number: '10', percentage: '25', description: '' },
                may: { number: '10', percentage: '25', description: '' },
                jun: { number: '10', percentage: '25', description: '' },
                jul: { number: '10', percentage: '25', description: '' },
                aug: { number: '10', percentage: '25', description: '' },
                sep: { number: '10', percentage: '25', description: '' },
                oct: { number: '10', percentage: '25', description: '' },
                nov: { number: '10', percentage: '25', description: '' },
                dec: { number: '10', percentage: '25', description: '' },
            };

            // Ensure the month selector is set to January and reload with defaults
            const selector = document.getElementById('ktlo-month-selector');
            if (selector) {
                // DON'T save current data - that overwrites our new defaults!

                // Reset selector to January
                selector.value = 'jan';
                selector.setAttribute('data-previous-month', 'jan');

                // Load January with the new default data
                loadKTLOMonth('jan');

                // Ensure form inputs show the default values
                setTimeout(() => {
                    const numberInput = document.getElementById('ktlo-current-number');
                    const percentageInput = document.getElementById('ktlo-current-percentage');
                    const descriptionInput = document.getElementById('ktlo-current-description');

                    if (numberInput) numberInput.value = '10';
                    if (percentageInput) percentageInput.value = '25';
                    if (descriptionInput) descriptionInput.value = '';
                }, 100);
            }

            // Reset change counter (owned by ./timeline-changes.js)
            resetTimelineChangeCounter();

            // Clear any pending timeline changes
            if (window.pendingTimelineChangesByIds) {
                window.pendingTimelineChangesByIds = {};
            }
            if (window.pendingTimelineChangesByReference) {
                window.pendingTimelineChangesByReference = {};
            }

            // Update date picker ranges for the new year
            updateAllDatePickerRanges();

            // Generate clean preview
            generatePreview();

            // Clear the flag after preview generation is complete
            setTimeout(() => {
                window.isCreatingNewRoadmap = false;
            }, 500);
        }

        // Snapshot the form into the roadmap state and compute the filename
        // both save flows use. Returns the suggestedName for the caller.
        function prepareRoadmapForSave() {
            // Flush in-progress KTLO month edits before serializing.
            saveCurrentKTLOData();
            const teamData = collectFormData();
            roadmapState.setState(teamData);
            const currentFilename = document.getElementById('currentFilename').value.trim();
            return currentFilename
                ? currentFilename.endsWith('.json')
                    ? currentFilename
                    : `${currentFilename}.json`
                : `${teamData.teamName || 'MyTeam'}.Teya-Roadmap.${teamData.roadmapYear || 2025}.json`;
        }

        // "Save file": in-place write via the File System Access API.
        // Chromium-only; fires an alert in other browsers.
        async function saveRoadmapInPlace() {
            if (!save.canSaveInBrowser()) {
                window.alert(
                    'Saving in place is only supported in Chromium-based browsers (Chrome, Edge, Brave, Arc).\n\nUse "Download" to save a copy instead.'
                );
                return;
            }

            const suggestedName = prepareRoadmapForSave();

            // No writable handle yet: prompt the user once via showSaveFilePicker.
            // The chosen handle sticks for subsequent saves.
            if (!save.canSave()) {
                const result = await directoryStore.selectSaveLocation(suggestedName);
                if (!result || !result.fileHandle) return; // cancelled
                save.setFileHandle(result.fileHandle);
                updateFilenameDisplay(result.name);
                await save.save({ suggestedName });
                return;
            }

            // Existing handle: confirm the overwrite before writing.
            const snap = directoryStore.get();
            const targetLabel =
                snap && snap.type === 'file' && snap.name ? snap.name : suggestedName;
            if (
                !window.confirm(
                    `Save changes to ${targetLabel}?\n\nThis will overwrite the file on disk.`
                )
            ) {
                return;
            }
            await save.save({ suggestedName });
        }

        // "Download": build a JSON blob and trigger a browser download.
        // Works in every browser; does not touch the File System Access API.
        function downloadRoadmap() {
            const suggestedName = prepareRoadmapForSave();
            save.download({ suggestedName });
        }

        // Load roadmap function - JSON only
        function loadRoadmap() {
            document.getElementById('roadmapLoadInput').click();
        }

        // Handle roadmap file load (JSON only)
        function handleRoadmapLoad(event) {
            const file = event.target.files[0];
            if (!file) return;

            const fileName = file.name.toLowerCase();

            if (fileName.endsWith('.json')) {
                // Handle as JSON roadmap file
                handleFileLoad(event);
            } else {
                alert('Unsupported file format. Please select a JSON (.json) file.');
            }

            // Reset the input value so the same file can be loaded again
            event.target.value = '';
        }

        /**
         * Fix dates without years when loading roadmap
         */
        function fixDatesOnLoad(teamData) {
            const roadmapYear = teamData.roadmapYear || new Date().getFullYear();

            // Helper function to fix a date string and normalize separator
            const fixDate = (dateStr) => {
                if (!dateStr || typeof dateStr !== 'string') return dateStr;
                // Match dd/mm or dd-mm format (without year)
                if (/^\d{1,2}[-/]\d{1,2}$/.test(dateStr)) {
                    // Replace all "-" with "/" for consistency, then add year
                    const normalizedDate = dateStr.replace(/-/g, '/');
                    return normalizedDate + '/' + roadmapYear;
                }
                return dateStr;
            };

            // Fix dates in all epics and stories
            if (teamData.epics) {
                teamData.epics.forEach((epic) => {
                    if (epic.stories) {
                        epic.stories.forEach((story) => {
                            // Fix story start/end dates
                            if (story.startDate) story.startDate = fixDate(story.startDate);
                            if (story.endDate) story.endDate = fixDate(story.endDate);

                            // Fix timeline change dates
                            if (story.roadmapChanges && story.roadmapChanges.changes) {
                                story.roadmapChanges.changes.forEach((change) => {
                                    if (change.date) change.date = fixDate(change.date);
                                    if (change.prevStartDate)
                                        change.prevStartDate = fixDate(change.prevStartDate);
                                    if (change.newStartDate)
                                        change.newStartDate = fixDate(change.newStartDate);
                                    if (change.prevEndDate)
                                        change.prevEndDate = fixDate(change.prevEndDate);
                                    if (change.newEndDate)
                                        change.newEndDate = fixDate(change.newEndDate);
                                });
                            }

                            // Fix status info dates
                            if (story.roadmapChanges) {
                                if (
                                    story.roadmapChanges.doneInfo &&
                                    story.roadmapChanges.doneInfo.date
                                ) {
                                    story.roadmapChanges.doneInfo.date = fixDate(
                                        story.roadmapChanges.doneInfo.date
                                    );
                                }
                                if (
                                    story.roadmapChanges.cancelInfo &&
                                    story.roadmapChanges.cancelInfo.date
                                ) {
                                    story.roadmapChanges.cancelInfo.date = fixDate(
                                        story.roadmapChanges.cancelInfo.date
                                    );
                                }
                                if (
                                    story.roadmapChanges.atRiskInfo &&
                                    story.roadmapChanges.atRiskInfo.date
                                ) {
                                    story.roadmapChanges.atRiskInfo.date = fixDate(
                                        story.roadmapChanges.atRiskInfo.date
                                    );
                                }
                                if (
                                    story.roadmapChanges.newStoryInfo &&
                                    story.roadmapChanges.newStoryInfo.date
                                ) {
                                    story.roadmapChanges.newStoryInfo.date = fixDate(
                                        story.roadmapChanges.newStoryInfo.date
                                    );
                                }
                                if (story.roadmapChanges.infoInfo) {
                                    if (Array.isArray(story.roadmapChanges.infoInfo)) {
                                        // Multiple info entries
                                        story.roadmapChanges.infoInfo.forEach((entry) => {
                                            if (entry && entry.date) {
                                                entry.date = fixDate(entry.date);
                                            }
                                        });
                                    } else if (story.roadmapChanges.infoInfo.date) {
                                        // Single info entry (backward compatibility)
                                        story.roadmapChanges.infoInfo.date = fixDate(
                                            story.roadmapChanges.infoInfo.date
                                        );
                                    }
                                }
                                if (
                                    story.roadmapChanges.transferredOutInfo &&
                                    story.roadmapChanges.transferredOutInfo.date
                                ) {
                                    story.roadmapChanges.transferredOutInfo.date = fixDate(
                                        story.roadmapChanges.transferredOutInfo.date
                                    );
                                }
                                if (
                                    story.roadmapChanges.transferredInInfo &&
                                    story.roadmapChanges.transferredInInfo.date
                                ) {
                                    story.roadmapChanges.transferredInInfo.date = fixDate(
                                        story.roadmapChanges.transferredInInfo.date
                                    );
                                }
                                if (
                                    story.roadmapChanges.proposedInfo &&
                                    story.roadmapChanges.proposedInfo.date
                                ) {
                                    story.roadmapChanges.proposedInfo.date = fixDate(
                                        story.roadmapChanges.proposedInfo.date
                                    );
                                }
                            }
                        });
                    }
                });
            }
        }
        function handleFileLoad(event) {
            const file = event.target.files[0];
            if (!file) return;

            // The HTML file input gives us a raw File, not a writable handle.
            // Clear any stale handle from a previous file-browser-panel load
            // so the next Save prompts for a destination instead of silently
            // overwriting the wrong file.
            save.setFileHandle(null);

            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = JSON.parse(e.target.result);

                    // Handle both new format (with metadata) and legacy format (direct teamData)
                    const teamData = data.teamData || data;

                    // Validate basic structure
                    if (!teamData || typeof teamData !== 'object') {
                        throw new Error('Invalid roadmap data structure');
                    }

                    // Fix dates without years by adding current roadmap year
                    fixDatesOnLoad(teamData);

                    loadTeamData(teamData);

                    // Update filename display
                    updateFilenameDisplay(file.name);

                    // Add a longer delay to ensure all DOM elements are ready and stories are loaded, then auto-generate preview
                    setTimeout(() => {
                        // Refresh date pickers to sync with loaded data
                        refreshAllDatePickers();
                        generatePreview();
                    }, 500);
                } catch (error) {
                    console.error('Error loading roadmap:', error);
                    let errorMessage = 'Error loading roadmap file.';

                    if (error.name === 'SyntaxError') {
                        errorMessage += ' The file is not valid JSON format.';
                    } else if (error.message.includes('Invalid roadmap data')) {
                        errorMessage += ' The file does not contain valid roadmap data.';
                    } else {
                        errorMessage += ' Please check the file format and try again.';
                    }

                    alert(errorMessage + '\n\nError details: ' + error.message);
                }
            };
            reader.readAsText(file);

            // Reset the file input so the same file can be loaded again
            event.target.value = '';
        }

        function updateIdCountersAfterImport() {
            // Update ID counters to avoid conflicts with imported IDs
            let maxEpicIdNumber = 0;
            let maxStoryIdNumber = 0;

            // Scan all EPIC IDs to find the highest number
            const epicElements = document.querySelectorAll('.epic-section');
            epicElements.forEach((epicEl) => {
                const epicIdEl = epicEl.querySelector('input[id^="epic-id-"]');
                if (epicIdEl && epicIdEl.value) {
                    const epicId = epicIdEl.value;
                    // Extract number from format like "0xE0000001"
                    if (epicId.startsWith('0xE')) {
                        const idNumber = parseInt(epicId.substring(3), 16);
                        if (!isNaN(idNumber) && idNumber > maxEpicIdNumber) {
                            maxEpicIdNumber = idNumber;
                        }
                    }
                }
            });

            // Scan all Story IDs to find the highest number
            const storyElements = document.querySelectorAll('.story-section');
            storyElements.forEach((storyEl) => {
                const storyIdEl = storyEl.querySelector('input[id^="story-id-"]');
                if (storyIdEl && storyIdEl.value) {
                    const storyId = storyIdEl.value;
                    // Extract number from format like "0x50000001"
                    if (storyId.startsWith('0x5')) {
                        const idNumber = parseInt(storyId.substring(3), 16);
                        if (!isNaN(idNumber) && idNumber > maxStoryIdNumber) {
                            maxStoryIdNumber = idNumber;
                        }
                    }
                }
            });

            // Update counters to match the maximum found (since we increment before use)
            epicIdCounter = maxEpicIdNumber;
            storyIdCounter = maxStoryIdNumber;
        }

        function loadTeamData(teamData) {
            // Clear existing EPICs first
            document.getElementById('epics-container').innerHTML = '';
            epicCounter = 0;
            storyCounters = {};

            // Always clear BTL stories during JSON import
            document.getElementById('btl-stories-container').innerHTML = '';
            btlStoryCounter = 0;

            // Reset sorting preferences and UI toggles on load
            try {
                const startToggle = document.getElementById('story-sorting-toggle');
                const endToggle = document.getElementById('story-sorting-end-toggle');
                const textBelowToggle = document.getElementById('force-text-below-toggle');
                if (startToggle) startToggle.checked = false;
                if (endToggle) endToggle.checked = false;
                if (textBelowToggle) textBelowToggle.checked = false;
                // Reset temporary force text below variable
                tempForceTextBelow = false;
                window.tempForceTextBelow = false;
                // Persist cleared state
                ConfigUtility.setSortStories(false);
                ConfigUtility.setSortByStart(false);
                ConfigUtility.setSortByEnd(false);
                ConfigUtility.setForceTextBelow(false);
            } catch {}

            // Load roadmap year
            document.getElementById('roadmapYear').value = teamData.roadmapYear || 2025;

            // Load team information
            document.getElementById('teamName').value = teamData.teamName || 'My Team';
            document.getElementById('directorVP').value = teamData.directorVP || '';
            document.getElementById('em').value = teamData.em || 'Engineering Manager';
            document.getElementById('pm').value = teamData.pm || 'Product Manager';

            // Load description - handle both old array format and new string format for backward compatibility
            let descriptionValue = '';
            if (teamData.description) {
                if (Array.isArray(teamData.description)) {
                    // Old format: convert array to multi-line string
                    descriptionValue = teamData.description
                        .filter((line) => line && line.trim())
                        .join('\n');
                } else if (typeof teamData.description === 'string') {
                    // New format: use string directly
                    descriptionValue = teamData.description;
                }
            }
            document.getElementById('teamDescription').value = descriptionValue;

            // Load EPICs and stories
            let totalStoryLoadOperations = 0;
            let completedStoryLoadOperations = 0;

            if (teamData.epics && Array.isArray(teamData.epics)) {
                // Count total operations first
                teamData.epics.forEach((epic) => {
                    if (epic.stories && Array.isArray(epic.stories)) {
                        totalStoryLoadOperations += epic.stories.length;
                    }
                });

                teamData.epics.forEach((epic) => {
                    addEpic();
                    const currentEpicId = epicCounter;

                    // Set EPIC name
                    document.getElementById(`epic-name-${currentEpicId}`).value =
                        epic.name || `EPIC ${currentEpicId}`;

                    // Remove the default story that gets added
                    const defaultStoryId = `${currentEpicId}-1`;
                    const defaultStoryElement = document.getElementById(`story-${defaultStoryId}`);
                    if (defaultStoryElement) {
                        defaultStoryElement.remove();
                        storyCounters[currentEpicId] = 0;
                    }

                    // Load stories for this EPIC
                    if (epic.stories && Array.isArray(epic.stories)) {
                        epic.stories.forEach((story, storyIndex) => {
                            addStory(currentEpicId);
                            const currentStoryId = `${currentEpicId}-${storyCounters[currentEpicId]}`;

                            // Add a small delay to ensure DOM elements are fully created before populating
                            setTimeout(
                                () => {
                                    loadStoryData(currentStoryId, story);

                                    // Track completion
                                    completedStoryLoadOperations++;

                                    // If all stories are loaded, generate preview
                                    if (completedStoryLoadOperations === totalStoryLoadOperations) {
                                        setTimeout(() => {
                                            // Store the loaded order as the "original" order for this session
                                            const epicElements =
                                                document.querySelectorAll('.epic-section');
                                            epicElements.forEach((epicEl) => {
                                                const epicId = epicEl.id.split('-')[1];
                                                storeOriginalStoryOrder(epicId);
                                            });

                                            collapseAllSections();
                                            // Refresh date pickers to sync with loaded data
                                            refreshAllDatePickers();
                                            generatePreview();
                                            // Update document title with loaded team name
                                            updateDocumentTitle();
                                            // Programmatic loads dispatch input events on
                                            // many fields; reset the dirty tracker now
                                            // that the form matches the loaded source.
                                            save.markClean();
                                        }, 100);
                                    }
                                },
                                10 + storyIndex * 5
                            ); // Stagger each story by 5ms
                        });
                    }
                });
            }

            // Ensure KTLO forms are initialized before loading data
            initializeKTLOMonths();

            // Load KTLO data if it exists, otherwise set default position
            if (teamData.ktloSwimlane) {
                loadKTLOData(teamData.ktloSwimlane);
            } else {
                // Set default KTLO position to 'bottom' when no KTLO data exists
                const positionToggle = document.getElementById('ktlo-position-toggle');
                if (positionToggle) {
                    positionToggle.checked = false; // Unchecked = bottom
                    delete positionToggle.dataset.originalPosition; // Clear any hidden state
                    // Reposition the KTLO section to default position
                    setTimeout(repositionKTLOSection, 50);
                }
                showKTLOSection(); // Ensure KTLO section is visible in builder
            }

            // Load BTL data if it exists
            if (teamData.btlSwimlane) {
                loadBTLData(teamData.btlSwimlane);
            }

            // Handle case where there are no stories to load
            if (totalStoryLoadOperations === 0) {
                setTimeout(() => {
                    collapseAllSections();
                    // Refresh date pickers to sync with loaded data
                    refreshAllDatePickers();
                    generatePreview();
                    // Update document title with loaded team name
                    updateDocumentTitle();
                    save.markClean();
                }, 100);
            }
        }

        // Helper function to round percentage to nearest multiple of 5
        function roundToNearestFive(percentage) {
            if (!percentage) return '';
            const num = parseInt(percentage);
            if (isNaN(num)) return '';
            return Math.round(num / 5) * 5;
        }

        function loadKTLOData(ktloData) {
            try {
                // Load KTLO position setting (support 'hidden' from JSON but map to bottom in UI)
                const position = ktloData.position || 'bottom';
                const positionToggle = document.getElementById('ktlo-position-toggle');
                if (positionToggle) {
                    // Map position to checkbox (hidden is treated as bottom in UI)
                    positionToggle.checked = position === 'top';
                    // Store the original position if it's hidden (to preserve when saving)
                    if (position === 'hidden') {
                        positionToggle.dataset.originalPosition = 'hidden';
                        // Hide the entire KTLO section in the builder
                        hideKTLOSection();
                    } else {
                        delete positionToggle.dataset.originalPosition;
                        // Show the KTLO section in the builder
                        showKTLOSection();
                    }
                    // Reposition the KTLO section in the builder based on loaded data
                    setTimeout(repositionKTLOSection, 50);
                }

                // Load KTLO story info
                if (ktloData.story) {
                    const titleEl = document.getElementById('ktlo-title');
                    if (titleEl) titleEl.value = ktloData.story.title || 'KTLO';

                    const bulletsEl = document.getElementById('ktlo-bullets');
                    if (
                        bulletsEl &&
                        ktloData.story.bullets &&
                        Array.isArray(ktloData.story.bullets)
                    ) {
                        bulletsEl.value = ktloData.story.bullets.join('\n');
                    }
                }

                // Load monthly data
                if (ktloData.monthlyData && Array.isArray(ktloData.monthlyData)) {
                    ktloData.monthlyData.forEach((monthData) => {
                        const monthLower = monthData.month.toLowerCase();

                        // Round percentage to nearest multiple of 5 (legacy data fix)
                        const roundedPercentage = roundToNearestFive(monthData.percentage);

                        // Store in the in-memory data structure
                        ktloMonthlyData[monthLower] = {
                            number: monthData.number || '',
                            percentage: roundedPercentage,
                            description: monthData.description || '',
                        };
                    });

                    // Refresh the currently displayed month
                    const selector = document.getElementById('ktlo-month-selector');
                    if (selector) {
                        loadKTLOMonth(selector.value);
                    }
                }
            } catch {
                // Don't throw the error, just continue so loading can complete
            }
        }

        // Populate one BTL story shell (as created by addBTLStory) from the JSON
        // shape collectBTLStoryData/collectStoryData produce - shared by loadBTLData
        // (bulk import) and the epic-move feature (single-story re-homing).
        function applyBTLStoryData(storyId, story) {
            const titleEl = document.getElementById(`btl-title-${storyId}`);
            const startEl = document.getElementById(`btl-start-${storyId}`);
            const endEl = document.getElementById(`btl-end-${storyId}`);
            const bulletsEl = document.getElementById(`btl-bullets-${storyId}`);
            const dateAddedEl = document.getElementById(`btl-dateadded-${storyId}`);
            const descriptionEl = document.getElementById(`btl-description-${storyId}`);

            if (titleEl) {
                titleEl.value = story.title || '';
                // Update the BTL story header to show title when collapsed
                updateStoryHeaderTitle(storyId, true);
            }

            if (startEl) {
                if (story.startDate) {
                    startEl.value = story.startDate;
                } else if (story.startMonth) {
                    startEl.value = DateUtility.convertMonthToStartDate(story.startMonth);
                }
            }

            if (endEl) {
                if (story.endDate) {
                    endEl.value = story.endDate;
                } else if (story.endMonth) {
                    endEl.value = DateUtility.convertMonthToEndDate(story.endMonth);
                }
                // Clear any previous error styling when loading data
                endEl.style.borderColor = '';
                endEl.style.backgroundColor = '';
            }

            if (bulletsEl && story.bullets && Array.isArray(story.bullets)) {
                bulletsEl.value = story.bullets.join('\n');
            }

            if (dateAddedEl) {
                dateAddedEl.value = story.dateAdded || '';
            }

            if (descriptionEl) {
                descriptionEl.value = story.dateAddedDescription || '';
            }

            // Set IMO field
            const imoEl = document.getElementById(`btl-imo-${storyId}`);
            if (imoEl) {
                imoEl.value = story.imo || '';
            }

            // Set Priority field
            const priorityEl = document.getElementById(`btl-priority-${storyId}`);
            if (priorityEl) {
                priorityEl.value = story.priority || '';
            }

            // Set FTE field
            const fteEl = document.getElementById(`btl-fte-${storyId}`);
            if (fteEl) {
                const fte = parseFte(story.fte);
                fteEl.value = fte === null ? '' : String(fte);
                updateFteHint(`btl-fte-hint-${storyId}`, fteEl.value);
            }

            // Set Comments field
            const commentsEl = document.getElementById(`btl-comments-${storyId}`);
            if (commentsEl) {
                commentsEl.value = story.comments || '';
            }
        }

        function loadBTLData(btlData) {
            try {
                // Clear existing BTL stories
                document.getElementById('btl-stories-container').innerHTML = '';
                btlStoryCounter = 0;

                // Load BTL stories if they exist
                if (btlData.stories && Array.isArray(btlData.stories)) {
                    btlData.stories.forEach((story) => {
                        addBTLStory();
                        const currentStoryId = `btl-${btlStoryCounter}`;
                        applyBTLStoryData(currentStoryId, story);
                    });
                }

                updateBTLAddButton(); // Update the story count after loading from JSON
            } catch {
                // Don't throw the error, just continue so loading can complete
            }
        }

        function loadStoryData(storyId, story) {
            try {
                // Load basic story info with error checking
                const titleEl = document.getElementById(`story-title-${storyId}`);
                if (titleEl) {
                    titleEl.value = story.title || '';
                    // Update the story header to show title when collapsed
                    updateStoryHeaderTitle(storyId, true);
                } else {
                    console.error(`Title element not found for story ${storyId}`);
                }

                // Load start/end dates with error checking and month conversion
                const startEl = document.getElementById(`story-start-${storyId}`);
                if (startEl) {
                    if (story.startDate) {
                        startEl.value = story.startDate;
                    } else if (story.startMonth) {
                        startEl.value = DateUtility.convertMonthToStartDate(story.startMonth);
                    }
                }

                const endEl = document.getElementById(`story-end-${storyId}`);
                if (endEl) {
                    if (story.endDate) {
                        endEl.value = story.endDate;
                    } else if (story.endMonth) {
                        endEl.value = DateUtility.convertMonthToEndDate(story.endMonth);
                    }
                    // Clear any previous error styling when loading data
                    endEl.style.borderColor = '';
                    endEl.style.backgroundColor = '';
                }

                // Load bullets with error checking
                if (story.bullets && Array.isArray(story.bullets)) {
                    const bulletsEl = document.getElementById(`story-bullets-${storyId}`);
                    if (bulletsEl) bulletsEl.value = story.bullets.join('\n');
                }

                // Load Director/VP ID field with error checking
                const directorVPIdEl = document.getElementById(`story-director-vp-id-${storyId}`);
                if (directorVPIdEl) {
                    directorVPIdEl.value = story.directorVPId || '';
                }

                // Load IMO field with error checking
                const imoEl = document.getElementById(`story-imo-${storyId}`);
                if (imoEl) {
                    imoEl.value = story.imo || '';
                }

                // Load Priority field with error checking
                const priorityEl = document.getElementById(`story-priority-${storyId}`);
                if (priorityEl) {
                    priorityEl.value = story.priority || '';
                }

                // Load FTE field
                const fteEl = document.getElementById(`story-fte-${storyId}`);
                if (fteEl) {
                    const fte = parseFte(story.fte);
                    fteEl.value = fte === null ? '' : String(fte);
                    updateFteHint(`story-fte-hint-${storyId}`, fteEl.value);
                }

                // Load Comments field
                const commentsEl = document.getElementById(`story-comments-${storyId}`);
                if (commentsEl) {
                    commentsEl.value = story.comments || '';
                }

                // Load Country Flags (Global is checked by default if no flags are saved)
                const flags = story.countryFlags || [];
                const hasNoSavedFlags = flags.length === 0;
                const flagGlobalEl = document.getElementById(`story-flag-global-${storyId}`);
                const flagUKEl = document.getElementById(`story-flag-uk-${storyId}`);
                const flagIcelandEl = document.getElementById(`story-flag-iceland-${storyId}`);
                const flagHungaryEl = document.getElementById(`story-flag-hungary-${storyId}`);
                const flagSpainEl = document.getElementById(`story-flag-spain-${storyId}`);
                const flagItalyEl = document.getElementById(`story-flag-italy-${storyId}`);
                const flagPortugalEl = document.getElementById(`story-flag-portugal-${storyId}`);
                const flagCzechiaEl = document.getElementById(`story-flag-czechia-${storyId}`);
                const flagGermanyEl = document.getElementById(`story-flag-germany-${storyId}`);
                const flagSlovakiaEl = document.getElementById(`story-flag-slovakia-${storyId}`);
                const flagSloveniaEl = document.getElementById(`story-flag-slovenia-${storyId}`);
                const flagCroatiaEl = document.getElementById(`story-flag-croatia-${storyId}`);
                const flagFranceEl = document.getElementById(`story-flag-france-${storyId}`);
                if (flagGlobalEl)
                    flagGlobalEl.checked = hasNoSavedFlags || flags.includes('Global');
                if (flagUKEl) flagUKEl.checked = flags.includes('UK');
                if (flagIcelandEl) flagIcelandEl.checked = flags.includes('Iceland');
                if (flagHungaryEl) flagHungaryEl.checked = flags.includes('Hungary');
                if (flagSpainEl) flagSpainEl.checked = flags.includes('Spain');
                if (flagItalyEl) flagItalyEl.checked = flags.includes('Italy');
                if (flagPortugalEl) flagPortugalEl.checked = flags.includes('Portugal');
                if (flagCzechiaEl) flagCzechiaEl.checked = flags.includes('Czechia');
                if (flagGermanyEl) flagGermanyEl.checked = flags.includes('Germany');
                if (flagSlovakiaEl) flagSlovakiaEl.checked = flags.includes('Slovakia');
                if (flagSloveniaEl) flagSloveniaEl.checked = flags.includes('Slovenia');
                if (flagCroatiaEl) flagCroatiaEl.checked = flags.includes('Croatia');
                if (flagFranceEl) flagFranceEl.checked = flags.includes('France');

                // Load Include in Product Roadmap flag
                const includeInProductRoadmapEl = document.getElementById(
                    `story-include-product-roadmap-${storyId}`
                );
                if (includeInProductRoadmapEl)
                    includeInProductRoadmapEl.checked = story.includeInProductRoadmap || false;

                // Load status flags with error checking
                const doneEl = document.getElementById(`story-done-${storyId}`);
                const cancelledEl = document.getElementById(`story-cancelled-${storyId}`);
                const atRiskEl = document.getElementById(`story-atrisk-${storyId}`);
                const newStoryEl = document.getElementById(`story-newstory-${storyId}`);
                const infoEl = document.getElementById(`story-info-${storyId}`);
                const transferredOutEl = document.getElementById(`story-transferredout-${storyId}`);
                const transferredInEl = document.getElementById(`story-transferredin-${storyId}`);
                const proposedEl = document.getElementById(`story-proposed-${storyId}`);
                if (doneEl) doneEl.checked = story.isDone || false;
                if (cancelledEl) cancelledEl.checked = story.isCancelled || false;
                if (atRiskEl) atRiskEl.checked = story.isAtRisk || false;
                if (newStoryEl) newStoryEl.checked = story.isNewStory || false;
                if (infoEl) infoEl.checked = story.isInfo || false;
                // Backward compatibility: map old isHandedOver to new isTransferredOut property
                if (transferredOutEl)
                    transferredOutEl.checked =
                        story.isTransferredOut || story.isHandedOver || false;
                if (transferredInEl) transferredInEl.checked = story.isTransferredIn || false;
                if (proposedEl) proposedEl.checked = story.isProposed || false;

                const hideFromSearchEl = document.getElementById(
                    `story-hide-from-search-${storyId}`
                );
                if (hideFromSearchEl) hideFromSearchEl.checked = story.hideFromSearch === true;

                // Load timeline changes with error checking
                if (story.hasRoadmapChanges && story.roadmapChanges) {
                    // Load timeline changes if they exist
                    if (
                        story.roadmapChanges.changes &&
                        Array.isArray(story.roadmapChanges.changes) &&
                        story.roadmapChanges.changes.length > 0
                    ) {
                        const changesCheckbox = document.getElementById(`story-changes-${storyId}`);
                        const changesSection = document.getElementById(
                            `changes-section-${storyId}`
                        );

                        if (changesCheckbox && changesSection) {
                            // Manually show the timeline changes section without triggering toggleChanges
                            changesSection.style.display = 'block';

                            // Wait a moment for DOM elements to be created, then load the changes
                            setTimeout(() => {
                                story.roadmapChanges.changes.forEach((change, index) => {
                                    addChange(storyId);

                                    // Find the most recently added change element (container)
                                    const changeContainers = document.querySelectorAll(
                                        `#changes-container-${storyId} > div[id^="change-${storyId}-change-"]`
                                    );
                                    const latestContainer =
                                        changeContainers[changeContainers.length - 1];
                                    if (latestContainer) {
                                        // Use the full ID pattern that matches collection logic: "1-4-change-1750523457266"
                                        const fullChangeId = latestContainer.id.replace(
                                            'change-',
                                            ''
                                        );

                                        const dateEl = document.getElementById(
                                            `change-date-${fullChangeId}`
                                        );
                                        const prevStartEl = document.getElementById(
                                            `change-prevstart-${fullChangeId}`
                                        );
                                        const newStartEl = document.getElementById(
                                            `change-newstart-${fullChangeId}`
                                        );
                                        const prevEl = document.getElementById(
                                            `change-prev-${fullChangeId}`
                                        );
                                        const newEl = document.getElementById(
                                            `change-new-${fullChangeId}`
                                        );
                                        const descEl = document.getElementById(
                                            `change-desc-${fullChangeId}`
                                        );

                                        if (dateEl) dateEl.value = change.date || '';
                                        if (prevStartEl)
                                            prevStartEl.value = change.prevStartDate || '';
                                        if (newStartEl)
                                            newStartEl.value = change.newStartDate || '';
                                        if (prevEl) prevEl.value = change.prevEndDate || '';
                                        if (newEl) newEl.value = change.newEndDate || '';
                                        if (descEl) descEl.value = change.description || '';

                                        // Update the header to show the correct number
                                        const header = latestContainer.querySelector('strong');
                                        if (header) {
                                            header.textContent = `Timeline #${index + 1}`;
                                        }
                                    }
                                });

                                // Update button state after loading all changes
                                updateChangeButton(storyId);

                                // Only AFTER loading all the changes, set the checkbox to checked
                                changesCheckbox.checked = true;
                            }, 50);
                        }
                    }

                    // Load done info and show done section if needed
                    if (story.roadmapChanges.doneInfo) {
                        const doneDateEl = document.getElementById(`done-date-${storyId}`);
                        const doneNotesEl = document.getElementById(`done-notes-${storyId}`);
                        if (doneDateEl) doneDateEl.value = story.roadmapChanges.doneInfo.date || '';
                        if (doneNotesEl)
                            doneNotesEl.value = story.roadmapChanges.doneInfo.notes || '';

                        // Show the done section if there's done info
                        if (story.isDone) {
                            const doneSectionEl = document.getElementById(
                                `done-section-${storyId}`
                            );
                            if (doneSectionEl) doneSectionEl.style.display = 'block';
                        }
                    }

                    // Load cancel info and show cancelled section if needed
                    if (story.roadmapChanges.cancelInfo) {
                        const cancelDateEl = document.getElementById(`cancel-date-${storyId}`);
                        const cancelNotesEl = document.getElementById(`cancel-notes-${storyId}`);
                        if (cancelDateEl)
                            cancelDateEl.value = story.roadmapChanges.cancelInfo.date || '';
                        if (cancelNotesEl)
                            cancelNotesEl.value = story.roadmapChanges.cancelInfo.notes || '';

                        // Show the cancelled section if there's cancel info
                        if (story.isCancelled) {
                            const cancelSectionEl = document.getElementById(
                                `cancelled-section-${storyId}`
                            );
                            if (cancelSectionEl) cancelSectionEl.style.display = 'block';
                        }
                    }

                    // Load at risk info and show at risk section if needed
                    if (story.roadmapChanges.atRiskInfo) {
                        const atRiskDateEl = document.getElementById(`atrisk-date-${storyId}`);
                        const atRiskNotesEl = document.getElementById(`atrisk-notes-${storyId}`);
                        if (atRiskDateEl)
                            atRiskDateEl.value = story.roadmapChanges.atRiskInfo.date || '';
                        if (atRiskNotesEl)
                            atRiskNotesEl.value = story.roadmapChanges.atRiskInfo.notes || '';

                        // Show the at risk section if there's at risk info (regardless of checkbox state)
                        const atRiskSectionEl = document.getElementById(
                            `atrisk-section-${storyId}`
                        );
                        if (atRiskSectionEl) atRiskSectionEl.style.display = 'block';

                        // Also ensure the checkbox is checked if there's data
                        const atRiskCheckbox = document.getElementById(`story-atrisk-${storyId}`);
                        if (
                            atRiskCheckbox &&
                            (story.roadmapChanges.atRiskInfo.date ||
                                story.roadmapChanges.atRiskInfo.notes)
                        ) {
                            atRiskCheckbox.checked = true;
                        }
                    }

                    // Load new story info and show new story section if needed
                    if (story.roadmapChanges.newStoryInfo) {
                        const newStoryDateEl = document.getElementById(`newstory-date-${storyId}`);
                        const newStoryNotesEl = document.getElementById(
                            `newstory-notes-${storyId}`
                        );
                        if (newStoryDateEl)
                            newStoryDateEl.value = story.roadmapChanges.newStoryInfo.date || '';
                        if (newStoryNotesEl)
                            newStoryNotesEl.value = story.roadmapChanges.newStoryInfo.notes || '';

                        // Show the new story section if there's new story info
                        if (story.isNewStory) {
                            const newStorySectionEl = document.getElementById(
                                `newstory-section-${storyId}`
                            );
                            if (newStorySectionEl) newStorySectionEl.style.display = 'block';
                        }
                    }

                    // Load info info and show info section if needed
                    if (story.roadmapChanges.infoInfo) {
                        const infoEntriesContainer = document.getElementById(
                            `info-entries-${storyId}`
                        );
                        if (infoEntriesContainer) {
                            // Clear existing entries
                            infoEntriesContainer.innerHTML = '';

                            if (Array.isArray(story.roadmapChanges.infoInfo)) {
                                // Multiple info entries
                                story.roadmapChanges.infoInfo.forEach((entry, index) => {
                                    const entryId = `info-entry-${storyId}-${Date.now()}-${index}`;
                                    const entryHtml = `
                                        <div id="${entryId}" class="info-entry" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                                <strong>Info Entry #${index + 1}</strong>
                                                <button type="button" onclick="removeInfoEntry('${entryId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">Remove</button>
                                            </div>
                                            <div class="inline-group">
                                                <div class="form-group">
                                                    <label for="info-date-${entryId}">Info Date:</label>
                                                    <input type="text" id="info-date-${entryId}" placeholder="15/01 or 15/01/25 or 15-01-2025" value="${entry.date || ''}">
                                                </div>
                                                <div class="form-group">
                                                    <label for="info-notes-${entryId}">Information Details:</label>
                                                    <textarea id="info-notes-${entryId}" placeholder="Additional information about this story (multiple lines supported)" rows="3" style="height: 60px;">${entry.notes || ''}</textarea>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                    infoEntriesContainer.insertAdjacentHTML('beforeend', entryHtml);

                                    // Add auto-update listeners
                                    const dateInput = document.getElementById(
                                        `info-date-${entryId}`
                                    );
                                    const notesInput = document.getElementById(
                                        `info-notes-${entryId}`
                                    );
                                    if (dateInput)
                                        dateInput.addEventListener('input', () =>
                                            generatePreview()
                                        );
                                    if (notesInput)
                                        notesInput.addEventListener('input', () =>
                                            generatePreview()
                                        );
                                });
                            } else {
                                // Single info entry (backward compatibility)
                                const entryId = `info-entry-${storyId}-${Date.now()}`;
                                const entryHtml = `
                                    <div id="${entryId}" class="info-entry" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                            <strong>Info Entry #1</strong>
                                            <button type="button" onclick="removeInfoEntry('${entryId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">Remove</button>
                                        </div>
                                        <div class="inline-group">
                                            <div class="form-group">
                                                <label for="info-date-${entryId}">Info Date:</label>
                                                <input type="text" id="info-date-${entryId}" placeholder="15/01 or 15/01/25 or 15-01-2025" value="${story.roadmapChanges.infoInfo.date || ''}">
                                            </div>
                                            <div class="form-group">
                                                <label for="info-notes-${entryId}">Information Details:</label>
                                                <textarea id="info-notes-${entryId}" placeholder="Additional information about this story (multiple lines supported)" rows="3" style="height: 60px;">${story.roadmapChanges.infoInfo.notes || ''}</textarea>
                                            </div>
                                        </div>
                                    </div>
                                `;
                                infoEntriesContainer.insertAdjacentHTML('beforeend', entryHtml);

                                // Add auto-update listeners
                                const dateInput = document.getElementById(`info-date-${entryId}`);
                                const notesInput = document.getElementById(`info-notes-${entryId}`);
                                if (dateInput)
                                    dateInput.addEventListener('input', () => generatePreview());
                                if (notesInput)
                                    notesInput.addEventListener('input', () => generatePreview());

                                // Convert the data structure from old single format to new multiple format
                                story.roadmapChanges.infoInfo = [
                                    {
                                        date: story.roadmapChanges.infoInfo.date,
                                        notes: story.roadmapChanges.infoInfo.notes,
                                    },
                                ];
                            }
                        }

                        // Show the info section if there's info info
                        if (story.isInfo) {
                            const infoSectionEl = document.getElementById(
                                `info-section-${storyId}`
                            );
                            if (infoSectionEl) infoSectionEl.style.display = 'block';
                        }
                    }

                    // Load transferred out info and show transferred out section if needed
                    // Backward compatibility: check both old handedOverInfo and new transferredOutInfo
                    const transferredOutData =
                        story.roadmapChanges.transferredOutInfo ||
                        story.roadmapChanges.handedOverInfo;
                    if (transferredOutData) {
                        const transferredOutDateEl = document.getElementById(
                            `transferredout-date-${storyId}`
                        );
                        const transferredOutNotesEl = document.getElementById(
                            `transferredout-notes-${storyId}`
                        );
                        if (transferredOutDateEl)
                            transferredOutDateEl.value = transferredOutData.date || '';
                        if (transferredOutNotesEl)
                            transferredOutNotesEl.value = transferredOutData.notes || '';

                        // Show the transferred out section if there's transferred out info
                        if (story.isTransferredOut) {
                            const transferredOutSectionEl = document.getElementById(
                                `transferredout-section-${storyId}`
                            );
                            if (transferredOutSectionEl)
                                transferredOutSectionEl.style.display = 'block';
                        }
                    }

                    // Load transferred in info and show transferred in section if needed
                    if (story.roadmapChanges.transferredInInfo) {
                        const transferredInDateEl = document.getElementById(
                            `transferredin-date-${storyId}`
                        );
                        const transferredInNotesEl = document.getElementById(
                            `transferredin-notes-${storyId}`
                        );
                        if (transferredInDateEl)
                            transferredInDateEl.value =
                                story.roadmapChanges.transferredInInfo.date || '';
                        if (transferredInNotesEl)
                            transferredInNotesEl.value =
                                story.roadmapChanges.transferredInInfo.notes || '';

                        // Show the transferred in section if there's transferred in info
                        if (story.isTransferredIn) {
                            const transferredInSectionEl = document.getElementById(
                                `transferredin-section-${storyId}`
                            );
                            if (transferredInSectionEl)
                                transferredInSectionEl.style.display = 'block';
                        }
                    }

                    // Load proposed info and show proposed section if needed
                    if (story.roadmapChanges.proposedInfo) {
                        const proposedDateEl = document.getElementById(`proposed-date-${storyId}`);
                        const proposedNotesEl = document.getElementById(
                            `proposed-notes-${storyId}`
                        );
                        if (proposedDateEl)
                            proposedDateEl.value = story.roadmapChanges.proposedInfo.date || '';
                        if (proposedNotesEl)
                            proposedNotesEl.value = story.roadmapChanges.proposedInfo.notes || '';

                        // Show the proposed section if there's proposed info
                        if (story.isProposed) {
                            const proposedSectionEl = document.getElementById(
                                `proposed-section-${storyId}`
                            );
                            if (proposedSectionEl) proposedSectionEl.style.display = 'block';
                        }
                    }
                }
            } catch {
                // Continue loading other stories even if this one fails
            }
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', function (event) {
            // Check if user is currently typing in an editable element
            const activeElement = document.activeElement;
            const isEditable =
                activeElement &&
                (activeElement.tagName === 'INPUT' ||
                    activeElement.tagName === 'TEXTAREA' ||
                    activeElement.contentEditable === 'true');

            // Always allow Escape key to work (to close modals)
            if (event.key === 'Escape') {
                hideFullscreen();
                closeEditModal();
                closeEditMonthlyKTLOModal();
                closeNewRoadmapModal();
                return;
            }

            // Don't handle other shortcuts when user is typing in an editable field
            if (isEditable) {
                return;
            }

            // Shift-B to toggle builder
            if (event.shiftKey && event.key === 'B') {
                event.preventDefault();
                toggleBuilderCollapse();
            }

            // Shift-F to toggle file explorer
            if (event.shiftKey && event.key === 'F') {
                event.preventDefault();
                toggleFileBrowser();
            }

            // Shift-S to open stats dialog
            if (event.shiftKey && event.key === 'S') {
                event.preventDefault();
                openStatsModal();
            }

            // Cmd-S (Mac) or Ctrl-S (Windows/Linux) to save roadmap.
            // Saves in place when available; falls back to a download
            // otherwise so the shortcut works in every browser.
            if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                event.preventDefault();
                if (save.canSaveInBrowser()) saveRoadmapInPlace();
                else downloadRoadmap();
            }

            // Cmd-L (Mac) or Ctrl-L (Windows/Linux) to load roadmap
            if ((event.metaKey || event.ctrlKey) && event.key === 'l') {
                event.preventDefault();
                loadRoadmap();
            }
        });
        // Modal functions
        let currentEditingStory = null;

        // Modal focus trap is now in ./focus-trap.js. The factory is wired
        // at the top of init() and exposes setupModalFocusTrap and
        // removeModalFocusTrap on window. Active-trap state is tracked
        // internally by the module, so callers no longer assign the result.

        function openEditStoryModal(storyData) {
            currentEditingStory = storyData;

            // Find the actual story data in the form
            const foundStory = findStoryInForm(
                storyData.epicName,
                storyData.storyTitle,
                storyData.storyIndex
            );
            if (!foundStory) {
                alert(
                    'Could not find story data in form. Epic: "' +
                        storyData.epicName +
                        '", Story: "' +
                        storyData.storyTitle +
                        '", Index: ' +
                        storyData.storyIndex +
                        '. Please try editing from the main form instead.'
                );
                return;
            }

            // Set modal title
            document.getElementById('editStoryTitle').textContent =
                `Edit Story: ${storyData.storyTitle}`;

            // Populate form fields
            document.getElementById('editTitle').value = foundStory.title || '';

            // Handle both startDate/startMonth and start property formats
            const startValue =
                foundStory.startDate || foundStory.startMonth || foundStory.start || '';
            const endValue = foundStory.endDate || foundStory.endMonth || foundStory.end || '';
            document.getElementById('editStart').value = startValue;
            const editEndField = document.getElementById('editEnd');
            editEndField.value = endValue;
            // Clear any previous error styling when loading data
            editEndField.style.borderColor = '';
            editEndField.style.backgroundColor = '';

            document.getElementById('editBullets').value = foundStory.bullets || '';
            document.getElementById('editDirectorVPId').value = foundStory.directorVPId || '';
            document.getElementById('editIMO').value = foundStory.imo || '';
            document.getElementById('editPriority').value = foundStory.priority || '';
            const editFteValue = parseFte(foundStory.fte);
            document.getElementById('editFte').value =
                editFteValue === null ? '' : String(editFteValue);
            updateFteHint('editFteHint', document.getElementById('editFte').value);
            document.getElementById('editComments').value = foundStory.comments || '';

            // Load Country Flags (Global is checked by default if no flags are saved)
            const flags = foundStory.countryFlags || [];
            const hasNoSavedFlags = flags.length === 0;
            document.getElementById('editFlagGlobal').checked =
                hasNoSavedFlags || flags.includes('Global');
            document.getElementById('editFlagUK').checked = flags.includes('UK');
            document.getElementById('editFlagIceland').checked = flags.includes('Iceland');
            document.getElementById('editFlagHungary').checked = flags.includes('Hungary');
            document.getElementById('editFlagSpain').checked = flags.includes('Spain');
            document.getElementById('editFlagItaly').checked = flags.includes('Italy');
            document.getElementById('editFlagPortugal').checked = flags.includes('Portugal');
            document.getElementById('editFlagCzechia').checked = flags.includes('Czechia');
            document.getElementById('editFlagGermany').checked = flags.includes('Germany');
            document.getElementById('editFlagSlovakia').checked = flags.includes('Slovakia');
            document.getElementById('editFlagSlovenia').checked = flags.includes('Slovenia');
            document.getElementById('editFlagCroatia').checked = flags.includes('Croatia');
            document.getElementById('editFlagFrance').checked = flags.includes('France');

            // Load Include in Product Roadmap flag
            document.getElementById('editIncludeInProductRoadmap').checked =
                foundStory.includeInProductRoadmap || false;

            // Special handling for KTLO and BTL - disable fields that don't apply
            const isKTLO = storyData.epicName === 'KTLO';
            const isBTL = storyData.epicName === 'Below the Line';

            // Show/hide KTLO position toggle
            document.getElementById('editKTLOPositionGroup').style.display = isKTLO
                ? 'block'
                : 'none';
            if (isKTLO && foundStory.position !== undefined) {
                document.getElementById('editKTLOPosition').checked = foundStory.position;
            }

            // Show/hide KTLO monthly data section
            document.getElementById('editKTLOMonthlySection').style.display = isKTLO
                ? 'block'
                : 'none';
            if (isKTLO) {
                initializeEditKTLOMonths();
            }

            // Show/hide BTL Date Added section
            document.getElementById('editBTLDateAddedGroup').style.display = isBTL
                ? 'block'
                : 'none';
            document.getElementById('editBTLDescriptionGroup').style.display = isBTL
                ? 'block'
                : 'none';
            if (isBTL) {
                document.getElementById('editBTLDateAdded').value = foundStory.dateAdded || '';
                document.getElementById('editBTLDescription').value =
                    foundStory.dateAddedDescription || '';
            }

            // Disable start/end dates for KTLO (it spans full year)
            document.getElementById('editStart').disabled = isKTLO;
            document.getElementById('editEnd').disabled = isKTLO;

            // Hide status checkboxes for KTLO and BTL
            const statusCheckboxes = document.querySelectorAll('#editStoryModal .checkbox-group');
            statusCheckboxes.forEach((checkboxGroup) => {
                checkboxGroup.style.display = isKTLO || isBTL ? 'none' : 'flex';
            });

            // Hide status fields for KTLO and BTL
            document.getElementById('editStatusFields').style.display =
                isKTLO || isBTL ? 'none' : 'block';
            document.getElementById('editTimelineChangesSection').style.display =
                isKTLO || isBTL ? 'none' : 'block';

            // Hide move buttons for KTLO (it can't be reordered) but show for BTL
            const moveButtons = document.querySelectorAll('button[onclick*="moveCurrentStory"]');
            moveButtons.forEach((button) => {
                button.style.display = isKTLO ? 'none' : 'inline-block';
            });

            // Set checkboxes
            document.getElementById('editDone').checked = foundStory.isDone || false;
            document.getElementById('editCancelled').checked = foundStory.isCancelled || false;
            document.getElementById('editAtRisk').checked = foundStory.isAtRisk || false;
            document.getElementById('editNewStory').checked = foundStory.isNewStory || false;
            document.getElementById('editInfo').checked = foundStory.isInfo || false;
            document.getElementById('editTransferredOut').checked =
                foundStory.isTransferredOut || false;
            document.getElementById('editTransferredIn').checked =
                foundStory.isTransferredIn || false;
            document.getElementById('editProposed').checked = foundStory.isProposed || false;
            document.getElementById('editTimelineChanges').checked =
                foundStory.hasTimelineChanges || false;
            document.getElementById('editHideFromSearch').checked =
                foundStory.hideFromSearch === true;

            // Set status information
            document.getElementById('editDoneDate').value = foundStory.doneDate || '';
            document.getElementById('editDoneNotes').value = foundStory.doneNotes || '';
            document.getElementById('editCancelDate').value = foundStory.cancelDate || '';
            document.getElementById('editCancelNotes').value = foundStory.cancelNotes || '';
            document.getElementById('editAtRiskDate').value = foundStory.atRiskDate || '';
            document.getElementById('editAtRiskNotes').value = foundStory.atRiskNotes || '';
            document.getElementById('editNewStoryDate').value = foundStory.newStoryDate || '';
            document.getElementById('editNewStoryNotes').value = foundStory.newStoryNotes || '';
            // Load info entries (multiple instances)
            const editInfoEntriesContainer = document.getElementById('editInfoEntries');
            if (editInfoEntriesContainer) {
                // Clear existing entries
                editInfoEntriesContainer.innerHTML = '';
                editInfoEntryCounter = 0;

                if (foundStory.roadmapChanges && foundStory.roadmapChanges.infoInfo) {
                    if (Array.isArray(foundStory.roadmapChanges.infoInfo)) {
                        // Multiple info entries
                        foundStory.roadmapChanges.infoInfo.forEach((entry, index) => {
                            const entryId = `edit-info-entry-${editInfoEntryCounter++}`;
                            const entryHtml = `
                                <div id="${entryId}" class="info-entry" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                        <strong>Info Entry #${index + 1}</strong>
                                        <button type="button" onclick="removeEditInfoEntry('${entryId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">Remove</button>
                                    </div>
                                    <div class="inline-group">
                                        <div class="form-group">
                                            <label for="edit-info-date-${entryId}">Info Date:</label>
                                            <input type="text" id="edit-info-date-${entryId}" placeholder="15/01 or 15/01/25 or 15-01-2025" value="${entry.date || ''}">
                                        </div>
                                        <div class="form-group">
                                            <label for="edit-info-notes-${entryId}">Information Details:</label>
                                            <textarea id="edit-info-notes-${entryId}" placeholder="Additional information about this story (multiple lines supported)" rows="3" style="height: 60px;">${entry.notes || ''}</textarea>
                                        </div>
                                    </div>
                                </div>
                            `;
                            editInfoEntriesContainer.insertAdjacentHTML('beforeend', entryHtml);
                        });
                    } else {
                        // Single info entry (backward compatibility)
                        const entryId = `edit-info-entry-${editInfoEntryCounter++}`;
                        const entryHtml = `
                            <div id="${entryId}" class="info-entry" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <strong>Info Entry #1</strong>
                                    <button type="button" onclick="removeEditInfoEntry('${entryId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">Remove</button>
                                </div>
                                <div class="inline-group">
                                    <div class="form-group">
                                        <label for="edit-info-date-${entryId}">Info Date:</label>
                                        <input type="text" id="edit-info-date-${entryId}" placeholder="15/01 or 15/01/25 or 15-01-2025" value="${foundStory.roadmapChanges.infoInfo.date || ''}">
                                    </div>
                                    <div class="form-group">
                                        <label for="edit-info-notes-${entryId}">Information Details:</label>
                                        <textarea id="edit-info-notes-${entryId}" placeholder="Additional information about this story (multiple lines supported)" rows="3" style="height: 60px;">${foundStory.roadmapChanges.infoInfo.notes || ''}</textarea>
                                    </div>
                                </div>
                            </div>
                        `;
                        editInfoEntriesContainer.insertAdjacentHTML('beforeend', entryHtml);

                        // Convert the data structure from old single format to new multiple format
                        foundStory.roadmapChanges.infoInfo = [
                            {
                                date: foundStory.roadmapChanges.infoInfo.date,
                                notes: foundStory.roadmapChanges.infoInfo.notes,
                            },
                        ];
                    }
                } else {
                    // Check if data has been converted in the main form
                    const mainFormInfoEntries = [];
                    const mainFormInfoContainer = document.getElementById(
                        `info-entries-${foundStory.storyId}`
                    );
                    if (mainFormInfoContainer) {
                        const mainFormEntries =
                            mainFormInfoContainer.querySelectorAll('.info-entry');
                        mainFormEntries.forEach((entry) => {
                            const entryId = entry.id;
                            const dateEl = document.getElementById(`info-date-${entryId}`);
                            const notesEl = document.getElementById(`info-notes-${entryId}`);
                            if (dateEl && notesEl && (dateEl.value || notesEl.value)) {
                                mainFormInfoEntries.push({
                                    date: dateEl.value,
                                    notes: notesEl.value,
                                });
                            }
                        });
                    }

                    if (mainFormInfoEntries.length > 0) {
                        // Use converted data from main form
                        mainFormInfoEntries.forEach((entry, index) => {
                            const entryId = `edit-info-entry-${editInfoEntryCounter++}`;
                            const entryHtml = `
                                <div id="${entryId}" class="info-entry" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                        <strong>Info Entry #${index + 1}</strong>
                                        <button type="button" onclick="removeEditInfoEntry('${entryId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">Remove</button>
                                    </div>
                                    <div class="inline-group">
                                        <div class="form-group">
                                            <label for="edit-info-date-${entryId}">Info Date:</label>
                                            <input type="text" id="edit-info-date-${entryId}" placeholder="15/01 or 15/01/25 or 15-01-2025" value="${entry.date || ''}">
                                        </div>
                                        <div class="form-group">
                                            <label for="edit-info-notes-${entryId}">Information Details:</label>
                                            <textarea id="edit-info-notes-${entryId}" placeholder="Additional information about this story (multiple lines supported)" rows="3" style="height: 60px;">${entry.notes || ''}</textarea>
                                        </div>
                                    </div>
                                </div>
                            `;
                            editInfoEntriesContainer.insertAdjacentHTML('beforeend', entryHtml);
                        });
                    } else if (foundStory.infoDate || foundStory.infoNotes) {
                        // Fallback to old single info format
                        const entryId = `edit-info-entry-${editInfoEntryCounter++}`;
                        const entryHtml = `
                            <div id="${entryId}" class="info-entry" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <strong>Info Entry #1</strong>
                                    <button type="button" onclick="removeEditInfoEntry('${entryId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">Remove</button>
                                </div>
                                <div class="inline-group">
                                    <div class="form-group">
                                        <label for="edit-info-date-${entryId}">Info Date:</label>
                                        <input type="text" id="edit-info-date-${entryId}" placeholder="15/01 or 15/01/25 or 15-01-2025" value="${foundStory.infoDate || ''}">
                                    </div>
                                    <div class="form-group">
                                        <label for="edit-info-notes-${entryId}">Information Details:</label>
                                        <textarea id="edit-info-notes-${entryId}" placeholder="Additional information about this story (multiple lines supported)" rows="3" style="height: 60px;">${foundStory.infoNotes || ''}</textarea>
                                    </div>
                                </div>
                            </div>
                        `;
                        editInfoEntriesContainer.insertAdjacentHTML('beforeend', entryHtml);
                    }
                }
            }
            // Backward compatibility: handle both old handedOver and new transferredOut properties
            document.getElementById('editTransferredOutDate').value =
                foundStory.transferredOutDate || foundStory.handedOverDate || '';
            document.getElementById('editTransferredOutNotes').value =
                foundStory.transferredOutNotes || foundStory.handedOverNotes || '';
            document.getElementById('editTransferredInDate').value =
                foundStory.transferredInDate || '';
            document.getElementById('editTransferredInNotes').value =
                foundStory.transferredInNotes || '';
            document.getElementById('editProposedDate').value = foundStory.proposedDate || '';
            document.getElementById('editProposedNotes').value = foundStory.proposedNotes || '';

            // Load existing timeline changes FIRST (before calling toggle functions)
            if (
                foundStory.hasTimelineChanges &&
                foundStory.timelineChanges &&
                foundStory.timelineChanges.length > 0
            ) {
                // Clear existing changes first
                document.getElementById('editChangesContainer').innerHTML = '';
                // Reset the edit-change counter (now owned by ./timeline-changes.js)
                resetEditChangeCounter();
                // Sort timeline changes by date before displaying in modal
                const sortedTimelineChanges = sortTimelineChangesByDate([
                    ...foundStory.timelineChanges,
                ]);

                // Add each timeline change in chronological order
                sortedTimelineChanges.forEach((change) => {
                    const changeId = addEditChange();
                    document.getElementById(`${changeId}-date`).value = change.date || '';
                    document.getElementById(`${changeId}-desc`).value = change.description || '';
                    document.getElementById(`${changeId}-prevstart`).value =
                        change.prevStartDate || '';
                    document.getElementById(`${changeId}-newstart`).value =
                        change.newStartDate || '';
                    document.getElementById(`${changeId}-prev`).value = change.prevEndDate || '';
                    document.getElementById(`${changeId}-new`).value = change.newEndDate || '';
                });

                // Update button state after loading all changes
                updateEditChangeButton();
            } else {
                // Clear any existing changes
                document.getElementById('editChangesContainer').innerHTML = '';
                resetEditChangeCounter();

                // Update button state after clearing changes
                updateEditChangeButton();
            }

            // Show/hide appropriate status fields (after timeline changes are loaded)
            toggleEditStatusFields();
            toggleEditTimelineChanges();

            // Clear date picker initialization flags to allow re-initialization
            const modalDateFields = [
                'editStart',
                'editEnd',
                'editDoneDate',
                'editCancelDate',
                'editAtRiskDate',
                'editNewStoryDate',
                'editTransferredOutDate',
                'editBTLDateAdded',
            ];

            modalDateFields.forEach((fieldId) => {
                const element = document.getElementById(fieldId);
                if (element) {
                    element.dataset.datePickerInitialized = 'false';
                    if (element.id) {
                        untrackDatePicker(element.id);
                    }
                }
            });

            // Initialize date pickers for modal fields immediately (no setTimeout needed)
            const initializeModalDatePickers = () => {
                // Main modal date fields
                initializeDatePicker(document.getElementById('editStart'), true);
                initializeDatePicker(document.getElementById('editEnd'), true);
                initializeDatePicker(document.getElementById('editDoneDate'), false);
                initializeDatePicker(document.getElementById('editCancelDate'), false);
                initializeDatePicker(document.getElementById('editAtRiskDate'), false);
                initializeDatePicker(document.getElementById('editNewStoryDate'), false);
                initializeDatePicker(document.getElementById('editTransferredOutDate'), false);

                // BTL date added field
                initializeDatePicker(document.getElementById('editBTLDateAdded'), false);

                // Timeline change date fields in modal
                document
                    .querySelectorAll(
                        '#editChangesContainer input[id*="-date"], #editChangesContainer input[id*="-prev"], #editChangesContainer input[id*="-new"]'
                    )
                    .forEach((input) => {
                        input.dataset.datePickerInitialized = 'false';
                        if (input.id) {
                            untrackDatePicker(input.id);
                        }
                        initializeDatePicker(input, false);
                    });
            };

            // Initialize immediately and again after a small delay for any dynamic fields
            initializeModalDatePickers();
            setTimeout(initializeModalDatePickers, 100);

            // Initialize BTL date picker if this is a BTL story
            if (isBTL) {
                setTimeout(() => {
                    initializeDatePicker(document.getElementById('editBTLDateAdded'), false);
                }, 150);
            }

            // Show modal
            document.getElementById('editStoryModal').style.display = 'flex';

            // Remove focus from any element
            if (document.activeElement) {
                document.activeElement.blur();
            }

            // Set up focus trap
            setupModalFocusTrap('editStoryModal');

            // Add Enter key listener for Save Changes
            const editStoryModal = document.getElementById('editStoryModal');
            const handleEnterKey = (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    // Check if user is currently typing in an editable element
                    const activeElement = document.activeElement;
                    const isEditable =
                        activeElement &&
                        (activeElement.tagName === 'INPUT' ||
                            activeElement.tagName === 'TEXTAREA' ||
                            activeElement.contentEditable === 'true');

                    // Don't trigger save when user is typing in a form field
                    if (isEditable) {
                        return;
                    }

                    event.preventDefault();
                    saveStoryChanges();
                }
            };
            editStoryModal.addEventListener('keydown', handleEnterKey);

            // Store the handler so we can remove it later
            editStoryModal._enterKeyHandler = handleEnterKey;
        }

        function closeEditModal() {
            const editStoryModal = document.getElementById('editStoryModal');
            editStoryModal.style.display = 'none';
            currentEditingStory = null;

            // Remove Enter key listener
            if (editStoryModal._enterKeyHandler) {
                editStoryModal.removeEventListener('keydown', editStoryModal._enterKeyHandler);
                delete editStoryModal._enterKeyHandler;
            }

            // Remove focus trap
            removeModalFocusTrap();

            // Reset form fields to their enabled/visible state for next use
            document.getElementById('editStart').disabled = false;
            document.getElementById('editEnd').disabled = false;
            document.getElementById('editKTLOPositionGroup').style.display = 'none';
            document.getElementById('editKTLOMonthlySection').style.display = 'none';
            document.getElementById('editBTLDateAddedGroup').style.display = 'none';
            document.getElementById('editBTLDescriptionGroup').style.display = 'none';

            // Reset monthly KTLO data visibility
            const monthlyContainer = document.getElementById('editKTLOMonthsContainer');
            if (monthlyContainer) {
                monthlyContainer.style.display = 'block';
            }

            const statusCheckboxes = document.querySelector('#editStoryModal .checkbox-group');
            if (statusCheckboxes) {
                statusCheckboxes.style.display = 'flex';
            }

            document.getElementById('editStatusFields').style.display = 'block';
            document.getElementById('editTimelineChangesSection').style.display = 'block';

            const moveButtons = document.querySelectorAll('button[onclick*="moveCurrentStory"]');
            moveButtons.forEach((button) => {
                button.style.display = 'inline-block';
            });
        }

        function toggleEditStatusFields() {
            const doneChecked = document.getElementById('editDone').checked;
            const cancelledChecked = document.getElementById('editCancelled').checked;
            const atRiskChecked = document.getElementById('editAtRisk').checked;
            const newStoryChecked = document.getElementById('editNewStory').checked;
            const infoChecked = document.getElementById('editInfo').checked;
            const transferredOutChecked = document.getElementById('editTransferredOut').checked;
            const transferredInChecked = document.getElementById('editTransferredIn').checked;
            const proposedChecked = document.getElementById('editProposed').checked;

            document.getElementById('editDoneFields').style.display = doneChecked
                ? 'block'
                : 'none';
            document.getElementById('editCancelFields').style.display = cancelledChecked
                ? 'block'
                : 'none';
            document.getElementById('editAtRiskFields').style.display = atRiskChecked
                ? 'block'
                : 'none';
            document.getElementById('editNewStoryFields').style.display = newStoryChecked
                ? 'block'
                : 'none';
            document.getElementById('editInfoFields').style.display = infoChecked
                ? 'block'
                : 'none';
            document.getElementById('editTransferredOutFields').style.display =
                transferredOutChecked ? 'block' : 'none';
            document.getElementById('editTransferredInFields').style.display = transferredInChecked
                ? 'block'
                : 'none';
            document.getElementById('editProposedFields').style.display = proposedChecked
                ? 'block'
                : 'none';

            // Reinitialize date pickers for newly visible fields
            setTimeout(() => {
                if (doneChecked)
                    initializeDatePicker(document.getElementById('editDoneDate'), false);
                if (cancelledChecked)
                    initializeDatePicker(document.getElementById('editCancelDate'), false);
                if (atRiskChecked)
                    initializeDatePicker(document.getElementById('editAtRiskDate'), false);
                if (newStoryChecked)
                    initializeDatePicker(document.getElementById('editNewStoryDate'), false);
                // Info entries are handled dynamically, no single date picker needed
                if (transferredOutChecked)
                    initializeDatePicker(document.getElementById('editTransferredOutDate'), false);
                if (transferredInChecked)
                    initializeDatePicker(document.getElementById('editTransferredInDate'), false);
                if (proposedChecked)
                    initializeDatePicker(document.getElementById('editProposedDate'), false);
            }, 10);

            // Auto-fill today's date if fields are empty and checkboxes are checked
            if (doneChecked) {
                const doneDateField = document.getElementById('editDoneDate');
                if (doneDateField && !doneDateField.value) {
                    doneDateField.value = getTodaysDateEuropean();
                }
            }

            if (cancelledChecked) {
                const cancelDateField = document.getElementById('editCancelDate');
                if (cancelDateField && !cancelDateField.value) {
                    cancelDateField.value = getTodaysDateEuropean();
                }
            }

            if (atRiskChecked) {
                const atRiskDateField = document.getElementById('editAtRiskDate');
                if (atRiskDateField && !atRiskDateField.value) {
                    atRiskDateField.value = getTodaysDateEuropean();
                }
            }

            if (newStoryChecked) {
                const newStoryDateField = document.getElementById('editNewStoryDate');
                if (newStoryDateField && !newStoryDateField.value) {
                    newStoryDateField.value = getTodaysDateEuropean();
                }
            }

            // Info entries are handled dynamically with addEditInfoEntry function
            if (infoChecked) {
                // Auto-create first info entry if none exist
                setTimeout(() => {
                    const editInfoEntriesContainer = document.getElementById('editInfoEntries');
                    if (editInfoEntriesContainer) {
                        const existingEntries =
                            editInfoEntriesContainer.querySelectorAll('.info-entry');
                        if (existingEntries.length === 0) {
                            addEditInfoEntry();
                        }
                    }
                }, 100);
            }

            if (transferredOutChecked) {
                const transferredOutDateField = document.getElementById('editTransferredOutDate');
                if (transferredOutDateField && !transferredOutDateField.value) {
                    transferredOutDateField.value = getTodaysDateEuropean();
                }
            }

            if (transferredInChecked) {
                const transferredInDateField = document.getElementById('editTransferredInDate');
                if (transferredInDateField && !transferredInDateField.value) {
                    transferredInDateField.value = getTodaysDateEuropean();
                }
            }

            if (proposedChecked) {
                const proposedDateField = document.getElementById('editProposedDate');
                if (proposedDateField && !proposedDateField.value) {
                    proposedDateField.value = getTodaysDateEuropean();
                }
            }
        }

        // Country-flag mutual-exclusion handlers are now in ./country-flags.js.
        // The factory is wired at the top of init() and exposes the four
        // functions on window for inline onchange="..." attributes.

        // Edit-modal timeline-change handlers are now in ./timeline-changes.js
        // (createEditTimelineChangeHandlers). Wired at the top of init().

        function initializeEditKTLOMonths() {
            // Initialize the modal month selector to January and load its data
            const selector = document.getElementById('edit-ktlo-month-selector');
            if (selector) {
                selector.value = 'jan';
                selector.setAttribute('data-previous-month', 'jan');
                loadEditKTLOMonth('jan');
            }
        }

        function switchEditKTLOMonth() {
            // Save current month's data before switching
            const modalSelector = document.getElementById('edit-ktlo-month-selector');
            if (modalSelector) {
                // Get the OLD month value (before the dropdown changes)
                const oldMonth =
                    modalSelector.getAttribute('data-previous-month') || modalSelector.value;
                const modalNumberEl = document.getElementById('edit-ktlo-current-number');
                const modalPercentageEl = document.getElementById('edit-ktlo-current-percentage');
                const modalDescriptionEl = document.getElementById('edit-ktlo-current-description');

                // Save current modal data to main data store
                ktloMonthlyData[oldMonth] = {
                    number: modalNumberEl ? modalNumberEl.value : '',
                    percentage: modalPercentageEl ? modalPercentageEl.value : '',
                    description: modalDescriptionEl ? modalDescriptionEl.value : '',
                };

                // Store the new month as the "previous" for next time
                modalSelector.setAttribute('data-previous-month', modalSelector.value);
            }

            const selector = document.getElementById('edit-ktlo-month-selector');
            const selectedMonth = selector.value;
            loadEditKTLOMonth(selectedMonth);
        }

        function loadEditKTLOMonth(month) {
            const data = ktloMonthlyData[month];
            const numberInput = document.getElementById('edit-ktlo-current-number');
            const percentageInput = document.getElementById('edit-ktlo-current-percentage');
            const descriptionInput = document.getElementById('edit-ktlo-current-description');

            if (numberInput) numberInput.value = data.number;
            if (percentageInput) percentageInput.value = data.percentage;
            if (descriptionInput) descriptionInput.value = data.description;
        }

        // Monthly KTLO Edit Modal Functions
        let currentEditingMonth = null;

        function openEditMonthlyKTLOModal(month) {
            currentEditingMonth = month;

            // Update modal title
            const monthName = month.charAt(0).toUpperCase() + month.slice(1);
            document.getElementById('editMonthlyKTLOTitle').textContent = `Edit ${monthName} KTLO`;

            // Set month dropdown
            document.getElementById('editMonthlyKTLOMonth').value = month;

            // Load current data for this month
            const monthData = ktloMonthlyData[month];
            document.getElementById('editMonthlyKTLONumber').value = monthData.number || '';
            document.getElementById('editMonthlyKTLOPercentage').value = monthData.percentage || '';
            document.getElementById('editMonthlyKTLODescription').value =
                monthData.description || '';

            // Show modal
            document.getElementById('editMonthlyKTLOModal').style.display = 'flex';

            // Set up focus trap
            setupModalFocusTrap('editMonthlyKTLOModal');

            // Add Enter key listener for Save Changes
            const editMonthlyKTLOModal = document.getElementById('editMonthlyKTLOModal');
            const handleEnterKey = (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    // Check if user is currently typing in an editable element
                    const activeElement = document.activeElement;
                    const isEditable =
                        activeElement &&
                        (activeElement.tagName === 'INPUT' ||
                            activeElement.tagName === 'TEXTAREA' ||
                            activeElement.contentEditable === 'true');

                    // Don't trigger save when user is typing in a form field
                    if (isEditable) {
                        return;
                    }

                    event.preventDefault();
                    saveMonthlyKTLOChanges();
                }
            };
            editMonthlyKTLOModal.addEventListener('keydown', handleEnterKey);

            // Store the handler so we can remove it later
            editMonthlyKTLOModal._enterKeyHandler = handleEnterKey;
        }

        function closeEditMonthlyKTLOModal() {
            try {
                const modal = document.getElementById('editMonthlyKTLOModal');
                if (modal) {
                    modal.style.display = 'none';

                    // Remove Enter key listener
                    if (modal._enterKeyHandler) {
                        modal.removeEventListener('keydown', modal._enterKeyHandler);
                        delete modal._enterKeyHandler;
                    }
                }
                currentEditingMonth = null;

                // Remove focus trap
                removeModalFocusTrap();
            } catch (error) {
                console.error('Error closing monthly KTLO modal:', error);
                // Force close by removing the modal from view
                const modal = document.getElementById('editMonthlyKTLOModal');
                if (modal) {
                    modal.style.display = 'none';
                }

                // Remove focus trap
                removeModalFocusTrap();
            }
        }

        function saveMonthlyKTLOChanges() {
            if (!currentEditingMonth) return;

            // Get values from modal
            const number = document.getElementById('editMonthlyKTLONumber').value;
            const percentage = document.getElementById('editMonthlyKTLOPercentage').value;
            const description = document.getElementById('editMonthlyKTLODescription').value;

            // Validate percentage directly - don't save if invalid
            if (percentage !== '' && !validateKTLOPercentage(percentage)) {
                return; // Prevent saving when percentage is invalid
            }

            // Save to main data store
            ktloMonthlyData[currentEditingMonth] = {
                number: number,
                percentage: percentage,
                description: description,
            };

            // Update the main form if currently viewing this month
            const mainSelector = document.getElementById('ktlo-month-selector');
            if (mainSelector && mainSelector.value === currentEditingMonth) {
                document.getElementById('ktlo-current-number').value = number;
                document.getElementById('ktlo-current-percentage').value = percentage;
                document.getElementById('ktlo-current-description').value = description;
            }

            // Update the modal form if currently editing this month
            const modalSelector = document.getElementById('edit-ktlo-month-selector');
            if (modalSelector && modalSelector.value === currentEditingMonth) {
                document.getElementById('edit-ktlo-current-number').value = number;
                document.getElementById('edit-ktlo-current-percentage').value = percentage;
                document.getElementById('edit-ktlo-current-description').value = description;
            }

            // Close modal
            closeEditMonthlyKTLOModal();

            // Regenerate preview to show changes
            generatePreview();
        }

        function findStoryInForm(epicName, storyTitle, storyIndex) {
            try {
                // Special handling for KTLO
                if (epicName === 'KTLO') {
                    const titleEl = document.getElementById('ktlo-title');
                    const bulletsEl = document.getElementById('ktlo-bullets');
                    const positionEl = document.getElementById('ktlo-position-toggle');

                    return {
                        storyId: 'ktlo', // Special ID for KTLO
                        title: titleEl ? titleEl.value : '',
                        start: 'JAN', // KTLO spans full year
                        end: 'DEC',
                        bullets: bulletsEl ? bulletsEl.value : '',
                        position: positionEl ? positionEl.checked : false, // true = top, false = bottom
                        isDone: false, // KTLO doesn't have status flags
                        isCancelled: false,
                        isAtRisk: false,
                        isNewStory: false,
                        isTransferredOut: false,
                        isProposed: false,
                        doneDate: '',
                        doneNotes: '',
                        cancelDate: '',
                        cancelNotes: '',
                        atRiskDate: '',
                        atRiskNotes: '',
                        newStoryDate: '',
                        newStoryNotes: '',
                        transferredOutDate: '',
                        transferredOutNotes: '',
                        proposedDate: '',
                        proposedNotes: '',
                        hasTimelineChanges: false,
                        timelineChanges: [],
                    };
                }

                // Special handling for BTL (Below the Line) stories
                if (epicName === 'Below the Line') {
                    const btlStoryElements = document.querySelectorAll(
                        '#btl-stories-container .story-section'
                    );
                    const targetStoryIndex = parseInt(storyIndex);

                    if (targetStoryIndex >= 0 && targetStoryIndex < btlStoryElements.length) {
                        const storyEl = btlStoryElements[targetStoryIndex];
                        const storyId = storyEl.id.replace('story-', '');

                        // Extract BTL story data
                        const titleEl = document.getElementById(`btl-title-${storyId}`);
                        const startEl = document.getElementById(`btl-start-${storyId}`);
                        const endEl = document.getElementById(`btl-end-${storyId}`);
                        const bulletsEl = document.getElementById(`btl-bullets-${storyId}`);
                        const dateAddedEl = document.getElementById(`btl-dateadded-${storyId}`);
                        const descriptionEl = document.getElementById(`btl-description-${storyId}`);
                        const imoEl = document.getElementById(`btl-imo-${storyId}`);
                        const commentsEl = document.getElementById(`btl-comments-${storyId}`);

                        return {
                            storyId: storyId,
                            title: titleEl ? titleEl.value : '',
                            start: startEl ? startEl.value : '',
                            end: endEl ? endEl.value : '',
                            bullets: bulletsEl ? bulletsEl.value : '',
                            dateAdded: dateAddedEl ? dateAddedEl.value : '',
                            dateAddedDescription: descriptionEl ? descriptionEl.value : '',
                            imo: imoEl ? imoEl.value : '',
                            priority:
                                document.getElementById(`btl-priority-${storyId}`)?.value || '',
                            fte: parseFte(document.getElementById(`btl-fte-${storyId}`)?.value),
                            comments: commentsEl ? commentsEl.value : '',
                            isDone: false, // BTL stories don't have status flags
                            isCancelled: false,
                            isAtRisk: false,
                            isNewStory: false,
                            isTransferredOut: false,
                            isTransferredIn: false,
                            isProposed: false,
                            doneDate: '',
                            doneNotes: '',
                            cancelDate: '',
                            cancelNotes: '',
                            atRiskDate: '',
                            atRiskNotes: '',
                            newStoryDate: '',
                            newStoryNotes: '',
                            transferredOutDate: '',
                            transferredOutNotes: '',
                            transferredInDate: '',
                            transferredInNotes: '',
                            proposedDate: '',
                            proposedNotes: '',
                            hasTimelineChanges: false,
                            timelineChanges: [],
                        };
                    }

                    return null;
                }

                // Find the EPIC by name
                const epicElements = document.querySelectorAll('.epic-section');

                let targetEpic = null;

                for (const epicEl of epicElements) {
                    const epicId = epicEl.id.split('-')[1];
                    const epicNameEl = document.getElementById(`epic-name-${epicId}`);
                    if (epicNameEl && epicNameEl.value.trim() === epicName.trim()) {
                        targetEpic = epicEl;
                        break;
                    }
                }

                if (!targetEpic) {
                    return null;
                }

                // Find the story within the EPIC
                const storyElements = targetEpic.querySelectorAll('.story-section');
                const targetStoryIndex = parseInt(storyIndex);
                if (targetStoryIndex >= 0 && targetStoryIndex < storyElements.length) {
                    const storyEl = storyElements[targetStoryIndex];
                    const storyId = storyEl.id.replace('story-', '');

                    // Extract story data
                    const titleEl = document.getElementById(`story-title-${storyId}`);
                    const startEl = document.getElementById(`story-start-${storyId}`);
                    const endEl = document.getElementById(`story-end-${storyId}`);
                    const bulletsEl = document.getElementById(`story-bullets-${storyId}`);
                    const directorVPIdEl = document.getElementById(
                        `story-director-vp-id-${storyId}`
                    );
                    const imoEl = document.getElementById(`story-imo-${storyId}`);

                    const doneEl = document.getElementById(`story-done-${storyId}`);
                    const cancelledEl = document.getElementById(`story-cancelled-${storyId}`);
                    const atRiskEl = document.getElementById(`story-atrisk-${storyId}`);
                    const newStoryEl = document.getElementById(`story-newstory-${storyId}`);
                    const infoEl = document.getElementById(`story-info-${storyId}`);
                    const transferredOutEl = document.getElementById(
                        `story-transferredout-${storyId}`
                    );
                    const transferredInEl = document.getElementById(
                        `story-transferredin-${storyId}`
                    );
                    const proposedEl = document.getElementById(`story-proposed-${storyId}`);

                    const doneDateEl = document.getElementById(`done-date-${storyId}`);
                    const doneNotesEl = document.getElementById(`done-notes-${storyId}`);
                    const cancelDateEl = document.getElementById(`cancel-date-${storyId}`);
                    const cancelNotesEl = document.getElementById(`cancel-notes-${storyId}`);
                    const atRiskDateEl = document.getElementById(`atrisk-date-${storyId}`);
                    const atRiskNotesEl = document.getElementById(`atrisk-notes-${storyId}`);
                    const newStoryDateEl = document.getElementById(`newstory-date-${storyId}`);
                    const newStoryNotesEl = document.getElementById(`newstory-notes-${storyId}`);
                    const infoDateEl = document.getElementById(`info-date-${storyId}`);
                    const infoNotesEl = document.getElementById(`info-notes-${storyId}`);
                    const transferredOutDateEl = document.getElementById(
                        `transferredout-date-${storyId}`
                    );
                    const transferredOutNotesEl = document.getElementById(
                        `transferredout-notes-${storyId}`
                    );
                    const transferredInDateEl = document.getElementById(
                        `transferredin-date-${storyId}`
                    );
                    const transferredInNotesEl = document.getElementById(
                        `transferredin-notes-${storyId}`
                    );
                    const proposedDateEl = document.getElementById(`proposed-date-${storyId}`);
                    const proposedNotesEl = document.getElementById(`proposed-notes-${storyId}`);

                    // Get timeline changes - check both checkbox state AND actual DOM elements
                    const timelineChangesEl = document.getElementById(`story-changes-${storyId}`);
                    const checkboxChecked = timelineChangesEl ? timelineChangesEl.checked : false;

                    // Always check for existing timeline change elements
                    const changeContainers = document.querySelectorAll(
                        `#changes-container-${storyId} > div[id^="change-${storyId}-change-"]`
                    );
                    const timelineChanges = [];

                    changeContainers.forEach((changeEl) => {
                        const changeId = changeEl.id.replace('change-', '');
                        const dateEl = document.getElementById(`change-date-${changeId}`);
                        const prevStartEl = document.getElementById(`change-prevstart-${changeId}`);
                        const newStartEl = document.getElementById(`change-newstart-${changeId}`);
                        const prevEl = document.getElementById(`change-prev-${changeId}`);
                        const newEl = document.getElementById(`change-new-${changeId}`);
                        const descEl = document.getElementById(`change-desc-${changeId}`);

                        if (dateEl && prevEl && newEl) {
                            timelineChanges.push({
                                date: dateEl.value || '',
                                prevStartDate: prevStartEl ? prevStartEl.value || '' : '',
                                newStartDate: newStartEl ? newStartEl.value || '' : '',
                                prevEndDate: prevEl.value || '',
                                newEndDate: newEl.value || '',
                                description: descEl ? descEl.value || '' : '',
                            });
                        }
                    });

                    // Sort timeline changes by date (chronological order)
                    sortTimelineChangesByDate(timelineChanges);

                    // hasTimelineChanges should be true if either checkbox is checked OR timeline changes exist
                    const hasTimelineChanges = checkboxChecked || timelineChanges.length > 0;

                    // Collect country flags (default to Global if no flags selected)
                    const storyCountryFlags = [];
                    if (document.getElementById(`story-flag-global-${storyId}`)?.checked)
                        storyCountryFlags.push('Global');
                    if (document.getElementById(`story-flag-uk-${storyId}`)?.checked)
                        storyCountryFlags.push('UK');
                    if (document.getElementById(`story-flag-iceland-${storyId}`)?.checked)
                        storyCountryFlags.push('Iceland');
                    if (document.getElementById(`story-flag-hungary-${storyId}`)?.checked)
                        storyCountryFlags.push('Hungary');
                    if (document.getElementById(`story-flag-spain-${storyId}`)?.checked)
                        storyCountryFlags.push('Spain');
                    if (document.getElementById(`story-flag-italy-${storyId}`)?.checked)
                        storyCountryFlags.push('Italy');
                    if (document.getElementById(`story-flag-portugal-${storyId}`)?.checked)
                        storyCountryFlags.push('Portugal');
                    if (document.getElementById(`story-flag-czechia-${storyId}`)?.checked)
                        storyCountryFlags.push('Czechia');
                    if (document.getElementById(`story-flag-slovakia-${storyId}`)?.checked)
                        storyCountryFlags.push('Slovakia');
                    if (document.getElementById(`story-flag-slovenia-${storyId}`)?.checked)
                        storyCountryFlags.push('Slovenia');
                    if (document.getElementById(`story-flag-croatia-${storyId}`)?.checked)
                        storyCountryFlags.push('Croatia');
                    if (document.getElementById(`story-flag-germany-${storyId}`)?.checked)
                        storyCountryFlags.push('Germany');
                    if (document.getElementById(`story-flag-france-${storyId}`)?.checked)
                        storyCountryFlags.push('France');
                    // Default to Global if no flags are selected
                    if (storyCountryFlags.length === 0) {
                        storyCountryFlags.push('Global');
                    }

                    // Get Include in Product Roadmap flag
                    const includeInProductRoadmapEl = document.getElementById(
                        `story-include-product-roadmap-${storyId}`
                    );

                    // Get Hide From Cross-Team Search flag
                    const hideFromSearchEl = document.getElementById(
                        `story-hide-from-search-${storyId}`
                    );

                    // Get Comments field
                    const commentsEl = document.getElementById(`story-comments-${storyId}`);

                    return {
                        storyId: storyId,
                        title: titleEl ? titleEl.value : '',
                        start: startEl ? startEl.value : '',
                        end: endEl ? endEl.value : '',
                        bullets: bulletsEl ? bulletsEl.value : '',
                        directorVPId: directorVPIdEl ? directorVPIdEl.value : '',
                        imo: imoEl ? imoEl.value : '',
                        priority: document.getElementById(`story-priority-${storyId}`)?.value || '',
                        fte: parseFte(document.getElementById(`story-fte-${storyId}`)?.value),
                        comments: commentsEl ? commentsEl.value : '',
                        countryFlags: storyCountryFlags.length > 0 ? storyCountryFlags : undefined,
                        includeInProductRoadmap: includeInProductRoadmapEl
                            ? includeInProductRoadmapEl.checked
                            : false,
                        hideFromSearch: hideFromSearchEl ? hideFromSearchEl.checked : false,
                        isDone: doneEl ? doneEl.checked : false,
                        isCancelled: cancelledEl ? cancelledEl.checked : false,
                        isAtRisk: atRiskEl ? atRiskEl.checked : false,
                        isNewStory: newStoryEl ? newStoryEl.checked : false,
                        isInfo: infoEl ? infoEl.checked : false,
                        isTransferredOut: transferredOutEl ? transferredOutEl.checked : false,
                        isTransferredIn: transferredInEl ? transferredInEl.checked : false,
                        isProposed: proposedEl ? proposedEl.checked : false,
                        doneDate: doneDateEl ? doneDateEl.value : '',
                        doneNotes: doneNotesEl ? doneNotesEl.value : '',
                        cancelDate: cancelDateEl ? cancelDateEl.value : '',
                        cancelNotes: cancelNotesEl ? cancelNotesEl.value : '',
                        atRiskDate: atRiskDateEl ? atRiskDateEl.value : '',
                        atRiskNotes: atRiskNotesEl ? atRiskNotesEl.value : '',
                        newStoryDate: newStoryDateEl ? newStoryDateEl.value : '',
                        newStoryNotes: newStoryNotesEl ? newStoryNotesEl.value : '',
                        infoDate: infoDateEl ? infoDateEl.value : '',
                        infoNotes: infoNotesEl ? infoNotesEl.value : '',
                        transferredOutDate: transferredOutDateEl ? transferredOutDateEl.value : '',
                        transferredOutNotes: transferredOutNotesEl
                            ? transferredOutNotesEl.value
                            : '',
                        transferredInDate: transferredInDateEl ? transferredInDateEl.value : '',
                        transferredInNotes: transferredInNotesEl ? transferredInNotesEl.value : '',
                        proposedDate: proposedDateEl ? proposedDateEl.value : '',
                        proposedNotes: proposedNotesEl ? proposedNotesEl.value : '',
                        hasTimelineChanges: hasTimelineChanges,
                        timelineChanges: timelineChanges,
                    };
                }

                return null;
            } catch {
                return null;
            }
        }

        function saveStoryChanges() {
            if (!currentEditingStory) {
                alert('No story selected for editing.');
                return;
            }

            try {
                // Find the story in the form
                const foundStory = findStoryInForm(
                    currentEditingStory.epicName,
                    currentEditingStory.storyTitle,
                    currentEditingStory.storyIndex
                );
                if (!foundStory) {
                    alert('Could not find story in form to update.');
                    return;
                }

                const storyId = foundStory.storyId;

                // Special handling for KTLO
                if (currentEditingStory.epicName === 'KTLO') {
                    // Update KTLO form fields
                    const titleEl = document.getElementById('ktlo-title');
                    const bulletsEl = document.getElementById('ktlo-bullets');
                    const positionEl = document.getElementById('ktlo-position-toggle');

                    if (titleEl) titleEl.value = document.getElementById('editTitle').value;
                    if (bulletsEl) bulletsEl.value = document.getElementById('editBullets').value;

                    // Update KTLO position if it changed
                    const newPosition = document.getElementById('editKTLOPosition').checked;
                    if (positionEl && positionEl.checked !== newPosition) {
                        positionEl.checked = newPosition;

                        // Trigger the repositioning logic
                        repositionKTLOSection();
                    }

                    // Update KTLO monthly data from modal back to main data store
                    // First, save the currently displayed month in the modal
                    const modalSelector = document.getElementById('edit-ktlo-month-selector');
                    if (modalSelector) {
                        const currentModalMonth = modalSelector.value;
                        const modalNumberEl = document.getElementById('edit-ktlo-current-number');
                        const modalPercentageEl = document.getElementById(
                            'edit-ktlo-current-percentage'
                        );
                        const modalDescriptionEl = document.getElementById(
                            'edit-ktlo-current-description'
                        );

                        if (modalNumberEl || modalPercentageEl || modalDescriptionEl) {
                            ktloMonthlyData[currentModalMonth] = {
                                number: modalNumberEl ? modalNumberEl.value : '',
                                percentage: modalPercentageEl ? modalPercentageEl.value : '',
                                description: modalDescriptionEl ? modalDescriptionEl.value : '',
                            };
                        }
                    }

                    // Refresh the main form to show the updated values
                    const mainSelector = document.getElementById('ktlo-month-selector');
                    if (mainSelector) {
                        loadKTLOMonth(mainSelector.value);
                    }

                    // Close modal and regenerate preview
                    closeEditModal();

                    setTimeout(() => {
                        generatePreview();
                    }, 100);
                    return;
                }

                // Special handling for BTL stories
                if (currentEditingStory.epicName === 'Below the Line') {
                    // Update BTL form fields
                    const titleEl = document.getElementById(`btl-title-${storyId}`);
                    const startEl = document.getElementById(`btl-start-${storyId}`);
                    const endEl = document.getElementById(`btl-end-${storyId}`);
                    const bulletsEl = document.getElementById(`btl-bullets-${storyId}`);
                    const dateAddedEl = document.getElementById(`btl-dateadded-${storyId}`);
                    const descriptionEl = document.getElementById(`btl-description-${storyId}`);
                    const imoEl = document.getElementById(`btl-imo-${storyId}`);

                    if (titleEl) titleEl.value = document.getElementById('editTitle').value;
                    if (startEl) startEl.value = document.getElementById('editStart').value;
                    if (endEl) endEl.value = document.getElementById('editEnd').value;
                    if (bulletsEl) bulletsEl.value = document.getElementById('editBullets').value;
                    if (dateAddedEl)
                        dateAddedEl.value = document.getElementById('editBTLDateAdded').value;
                    if (descriptionEl)
                        descriptionEl.value = document.getElementById('editBTLDescription').value;
                    if (imoEl) imoEl.value = document.getElementById('editIMO').value;

                    // Update Priority
                    const priorityEl = document.getElementById(`btl-priority-${storyId}`);
                    if (priorityEl)
                        priorityEl.value = document.getElementById('editPriority').value;

                    // Update FTE
                    const fteEl = document.getElementById(`btl-fte-${storyId}`);
                    if (fteEl) {
                        fteEl.value = document.getElementById('editFte').value;
                        updateFteHint(`btl-fte-hint-${storyId}`, fteEl.value);
                    }

                    // Update Comments
                    const commentsEl = document.getElementById(`btl-comments-${storyId}`);
                    if (commentsEl)
                        commentsEl.value = document.getElementById('editComments').value;

                    // Close modal and regenerate preview
                    closeEditModal();

                    setTimeout(() => {
                        generatePreview();
                    }, 100);
                    return;
                }

                // Update form fields with modal values (for regular stories)
                const titleEl = document.getElementById(`story-title-${storyId}`);
                const startEl = document.getElementById(`story-start-${storyId}`);
                const endEl = document.getElementById(`story-end-${storyId}`);
                const bulletsEl = document.getElementById(`story-bullets-${storyId}`);
                const directorVPIdEl = document.getElementById(`story-director-vp-id-${storyId}`);
                const imoEl = document.getElementById(`story-imo-${storyId}`);

                if (titleEl) titleEl.value = document.getElementById('editTitle').value;
                if (startEl) startEl.value = document.getElementById('editStart').value;
                if (endEl) endEl.value = document.getElementById('editEnd').value;
                if (bulletsEl) bulletsEl.value = document.getElementById('editBullets').value;
                if (directorVPIdEl)
                    directorVPIdEl.value = document.getElementById('editDirectorVPId').value;
                if (imoEl) imoEl.value = document.getElementById('editIMO').value;

                // Update Priority
                const priorityEl = document.getElementById(`story-priority-${storyId}`);
                if (priorityEl) priorityEl.value = document.getElementById('editPriority').value;

                // Update FTE
                const fteEl = document.getElementById(`story-fte-${storyId}`);
                if (fteEl) {
                    fteEl.value = document.getElementById('editFte').value;
                    updateFteHint(`story-fte-hint-${storyId}`, fteEl.value);
                }

                // Update Comments
                const commentsEl = document.getElementById(`story-comments-${storyId}`);
                if (commentsEl) commentsEl.value = document.getElementById('editComments').value;

                // Update Country Flags
                const flagGlobalEl = document.getElementById(`story-flag-global-${storyId}`);
                const flagUKEl = document.getElementById(`story-flag-uk-${storyId}`);
                const flagIcelandEl = document.getElementById(`story-flag-iceland-${storyId}`);
                const flagHungaryEl = document.getElementById(`story-flag-hungary-${storyId}`);
                const flagSpainEl = document.getElementById(`story-flag-spain-${storyId}`);
                const flagItalyEl = document.getElementById(`story-flag-italy-${storyId}`);
                const flagPortugalEl = document.getElementById(`story-flag-portugal-${storyId}`);
                const flagCzechiaEl = document.getElementById(`story-flag-czechia-${storyId}`);
                const flagGermanyEl = document.getElementById(`story-flag-germany-${storyId}`);
                const flagSlovakiaEl = document.getElementById(`story-flag-slovakia-${storyId}`);
                const flagSloveniaEl = document.getElementById(`story-flag-slovenia-${storyId}`);
                const flagCroatiaEl = document.getElementById(`story-flag-croatia-${storyId}`);
                const flagFranceEl = document.getElementById(`story-flag-france-${storyId}`);
                if (flagGlobalEl)
                    flagGlobalEl.checked = document.getElementById('editFlagGlobal').checked;
                if (flagUKEl) flagUKEl.checked = document.getElementById('editFlagUK').checked;
                if (flagIcelandEl)
                    flagIcelandEl.checked = document.getElementById('editFlagIceland').checked;
                if (flagHungaryEl)
                    flagHungaryEl.checked = document.getElementById('editFlagHungary').checked;
                if (flagSpainEl)
                    flagSpainEl.checked = document.getElementById('editFlagSpain').checked;
                if (flagItalyEl)
                    flagItalyEl.checked = document.getElementById('editFlagItaly').checked;
                if (flagPortugalEl)
                    flagPortugalEl.checked = document.getElementById('editFlagPortugal').checked;
                if (flagCzechiaEl)
                    flagCzechiaEl.checked = document.getElementById('editFlagCzechia').checked;
                if (flagGermanyEl)
                    flagGermanyEl.checked = document.getElementById('editFlagGermany').checked;
                if (flagSlovakiaEl)
                    flagSlovakiaEl.checked = document.getElementById('editFlagSlovakia').checked;
                if (flagSloveniaEl)
                    flagSloveniaEl.checked = document.getElementById('editFlagSlovenia').checked;
                if (flagCroatiaEl)
                    flagCroatiaEl.checked = document.getElementById('editFlagCroatia').checked;
                if (flagFranceEl)
                    flagFranceEl.checked = document.getElementById('editFlagFrance').checked;

                // Update Include in Product Roadmap
                const includeInProductRoadmapEl = document.getElementById(
                    `story-include-product-roadmap-${storyId}`
                );
                if (includeInProductRoadmapEl)
                    includeInProductRoadmapEl.checked = document.getElementById(
                        'editIncludeInProductRoadmap'
                    ).checked;

                // Update Hide From Cross-Team Search
                const hideFromSearchEl = document.getElementById(
                    `story-hide-from-search-${storyId}`
                );
                if (hideFromSearchEl)
                    hideFromSearchEl.checked =
                        document.getElementById('editHideFromSearch').checked;

                // Update checkboxes
                const doneEl = document.getElementById(`story-done-${storyId}`);
                const cancelledEl = document.getElementById(`story-cancelled-${storyId}`);
                const atRiskEl = document.getElementById(`story-atrisk-${storyId}`);
                const newStoryEl = document.getElementById(`story-newstory-${storyId}`);
                const infoEl = document.getElementById(`story-info-${storyId}`);
                const transferredOutEl = document.getElementById(`story-transferredout-${storyId}`);
                const transferredInEl = document.getElementById(`story-transferredin-${storyId}`);
                const proposedEl = document.getElementById(`story-proposed-${storyId}`);

                const doneChecked = document.getElementById('editDone').checked;
                const cancelledChecked = document.getElementById('editCancelled').checked;
                const atRiskChecked = document.getElementById('editAtRisk').checked;
                const newStoryChecked = document.getElementById('editNewStory').checked;
                const infoChecked = document.getElementById('editInfo').checked;
                const transferredOutChecked = document.getElementById('editTransferredOut').checked;
                const transferredInChecked = document.getElementById('editTransferredIn').checked;
                const proposedChecked = document.getElementById('editProposed').checked;
                const timelineChangesChecked =
                    document.getElementById('editTimelineChanges').checked;

                if (doneEl) {
                    doneEl.checked = doneChecked;
                    handleDoneChange(storyId); // Show/hide done section
                }
                if (cancelledEl) {
                    cancelledEl.checked = cancelledChecked;
                    handleCancelledChange(storyId); // Show/hide cancelled section
                }
                if (atRiskEl) {
                    atRiskEl.checked = atRiskChecked;
                    handleAtRiskChange(storyId); // Show/hide at risk section
                }
                if (newStoryEl) {
                    newStoryEl.checked = newStoryChecked;
                    handleNewStoryChange(storyId); // Show/hide new story section
                }
                if (infoEl) {
                    infoEl.checked = infoChecked;
                    handleInfoChange(storyId); // Show/hide info section
                }
                if (transferredOutEl) {
                    transferredOutEl.checked = transferredOutChecked;
                    handleTransferredOutChange(storyId); // Show/hide transferred out section
                }
                if (transferredInEl) {
                    transferredInEl.checked = transferredInChecked;
                    handleTransferredInChange(storyId); // Show/hide transferred in section
                }
                if (proposedEl) {
                    proposedEl.checked = proposedChecked;
                    handleProposedChange(storyId); // Show/hide proposed section
                }

                // Update timeline changes checkbox
                const timelineChangesEl = document.getElementById(`story-changes-${storyId}`);
                if (timelineChangesEl) {
                    timelineChangesEl.checked = timelineChangesChecked;
                    toggleChanges(storyId); // Show/hide timeline changes section
                }

                // Update status information
                setTimeout(() => {
                    const doneDateEl = document.getElementById(`done-date-${storyId}`);
                    const doneNotesEl = document.getElementById(`done-notes-${storyId}`);
                    const cancelDateEl = document.getElementById(`cancel-date-${storyId}`);
                    const cancelNotesEl = document.getElementById(`cancel-notes-${storyId}`);
                    const atRiskDateEl = document.getElementById(`atrisk-date-${storyId}`);
                    const atRiskNotesEl = document.getElementById(`atrisk-notes-${storyId}`);
                    const newStoryDateEl = document.getElementById(`newstory-date-${storyId}`);
                    const newStoryNotesEl = document.getElementById(`newstory-notes-${storyId}`);
                    const transferredOutDateEl = document.getElementById(
                        `transferredout-date-${storyId}`
                    );
                    const transferredOutNotesEl = document.getElementById(
                        `transferredout-notes-${storyId}`
                    );
                    const transferredInDateEl = document.getElementById(
                        `transferredin-date-${storyId}`
                    );
                    const transferredInNotesEl = document.getElementById(
                        `transferredin-notes-${storyId}`
                    );
                    const proposedDateEl = document.getElementById(`proposed-date-${storyId}`);
                    const proposedNotesEl = document.getElementById(`proposed-notes-${storyId}`);

                    if (doneDateEl)
                        doneDateEl.value = document.getElementById('editDoneDate').value;
                    if (doneNotesEl)
                        doneNotesEl.value = document.getElementById('editDoneNotes').value;
                    if (cancelDateEl)
                        cancelDateEl.value = document.getElementById('editCancelDate').value;
                    if (cancelNotesEl)
                        cancelNotesEl.value = document.getElementById('editCancelNotes').value;
                    if (atRiskDateEl)
                        atRiskDateEl.value = document.getElementById('editAtRiskDate').value;
                    if (atRiskNotesEl)
                        atRiskNotesEl.value = document.getElementById('editAtRiskNotes').value;
                    if (newStoryDateEl)
                        newStoryDateEl.value = document.getElementById('editNewStoryDate').value;
                    if (newStoryNotesEl)
                        newStoryNotesEl.value = document.getElementById('editNewStoryNotes').value;
                    // Handle multiple info entries
                    const infoEntriesContainer = document.getElementById(`info-entries-${storyId}`);
                    if (infoEntriesContainer) {
                        // Clear existing entries
                        infoEntriesContainer.innerHTML = '';

                        // Collect info entries from modal
                        const editInfoEntries = document.querySelectorAll(
                            '#editInfoEntries > div[id^="edit-info-entry-"]'
                        );
                        editInfoEntries.forEach((editEntryEl, index) => {
                            const entryId = editEntryEl.id;
                            const dateEl = document.getElementById(`edit-info-date-${entryId}`);
                            const notesEl = document.getElementById(`edit-info-notes-${entryId}`);

                            if (dateEl && notesEl && (dateEl.value || notesEl.value)) {
                                // Create new entry in the main form
                                const newEntryId = `info-entry-${storyId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                const entryNumber = index + 1;
                                const entryHtml = `
                                    <div id="${newEntryId}" class="info-entry" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                            <strong>Info Entry #${entryNumber}</strong>
                                            <button type="button" onclick="removeInfoEntry('${newEntryId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">Remove</button>
                                        </div>
                                        <div class="inline-group">
                                            <div class="form-group">
                                                <label for="info-date-${newEntryId}">Info Date:</label>
                                                <input type="text" id="info-date-${newEntryId}" placeholder="15/01 or 15/01/25 or 15-01-2025" value="${dateEl.value}">
                                            </div>
                                            <div class="form-group">
                                                <label for="info-notes-${newEntryId}">Information Details:</label>
                                                <textarea id="info-notes-${newEntryId}" placeholder="Additional information about this story (multiple lines supported)" rows="3" style="height: 60px;">${notesEl.value}</textarea>
                                            </div>
                                        </div>
                                    </div>
                                `;
                                infoEntriesContainer.insertAdjacentHTML('beforeend', entryHtml);

                                // Add auto-update listeners
                                const dateInput = document.getElementById(
                                    `info-date-${newEntryId}`
                                );
                                const notesInput = document.getElementById(
                                    `info-notes-${newEntryId}`
                                );
                                if (dateInput)
                                    dateInput.addEventListener('input', () => generatePreview());
                                if (notesInput)
                                    notesInput.addEventListener('input', () => generatePreview());
                            }
                        });
                    }
                    if (transferredOutDateEl)
                        transferredOutDateEl.value =
                            document.getElementById('editTransferredOutDate').value;
                    if (transferredOutNotesEl)
                        transferredOutNotesEl.value =
                            document.getElementById('editTransferredOutNotes').value;
                    if (transferredInDateEl)
                        transferredInDateEl.value =
                            document.getElementById('editTransferredInDate').value;
                    if (transferredInNotesEl)
                        transferredInNotesEl.value =
                            document.getElementById('editTransferredInNotes').value;
                    if (proposedDateEl)
                        proposedDateEl.value = document.getElementById('editProposedDate').value;
                    if (proposedNotesEl)
                        proposedNotesEl.value = document.getElementById('editProposedNotes').value;

                    // Handle timeline changes
                    if (timelineChangesChecked) {
                        // Clear existing timeline changes first
                        const existingChanges = document.querySelectorAll(
                            `#changes-container-${storyId} > div[id^="change-${storyId}-change-"]`
                        );
                        existingChanges.forEach((changeEl) => changeEl.remove());

                        // Collect timeline changes from modal and sort by date
                        const editChanges = document.querySelectorAll(
                            '#editChangesContainer > div[id^="edit-change-"]'
                        );
                        const modalTimelineChanges = [];

                        editChanges.forEach((editChangeEl) => {
                            const editChangeId = editChangeEl.id;
                            const dateValue = document.getElementById(`${editChangeId}-date`).value;
                            const descValue = document.getElementById(`${editChangeId}-desc`).value;
                            const prevStartValue = document.getElementById(
                                `${editChangeId}-prevstart`
                            ).value;
                            const newStartValue = document.getElementById(
                                `${editChangeId}-newstart`
                            ).value;
                            const prevValue = document.getElementById(`${editChangeId}-prev`).value;
                            const newValue = document.getElementById(`${editChangeId}-new`).value;

                            if (
                                dateValue ||
                                descValue ||
                                prevStartValue ||
                                newStartValue ||
                                prevValue ||
                                newValue
                            ) {
                                modalTimelineChanges.push({
                                    date: dateValue,
                                    description: descValue,
                                    prevStartDate: prevStartValue,
                                    newStartDate: newStartValue,
                                    prevEndDate: prevValue,
                                    newEndDate: newValue,
                                });
                            }
                        });

                        // Sort timeline changes by date
                        sortTimelineChangesByDate(modalTimelineChanges);

                        // Add sorted timeline changes to the main form
                        modalTimelineChanges.forEach((change) => {
                            addChange(storyId);

                            // IMMEDIATE population without setTimeout to avoid race conditions
                            const changeContainers = document.querySelectorAll(
                                `#changes-container-${storyId} > div[id^="change-${storyId}-change-"]`
                            );
                            const latestContainer = changeContainers[changeContainers.length - 1];
                            if (latestContainer) {
                                const fullChangeId = latestContainer.id.replace('change-', '');
                                const dateEl = document.getElementById(
                                    `change-date-${fullChangeId}`
                                );
                                const descEl = document.getElementById(
                                    `change-desc-${fullChangeId}`
                                );
                                const prevStartEl = document.getElementById(
                                    `change-prevstart-${fullChangeId}`
                                );
                                const newStartEl = document.getElementById(
                                    `change-newstart-${fullChangeId}`
                                );
                                const prevEl = document.getElementById(
                                    `change-prev-${fullChangeId}`
                                );
                                const newEl = document.getElementById(`change-new-${fullChangeId}`);

                                if (dateEl) dateEl.value = change.date;
                                if (descEl) descEl.value = change.description;
                                if (prevStartEl) prevStartEl.value = change.prevStartDate || '';
                                if (newStartEl) newStartEl.value = change.newStartDate || '';
                                if (prevEl) prevEl.value = change.prevEndDate;
                                if (newEl) newEl.value = change.newEndDate;
                            }
                        });

                        // Update story's actual start/end dates to reflect the most recent timeline change from modal
                        if (modalTimelineChanges.length > 0) {
                            // modalTimelineChanges is already sorted, so the last entry is the most recent
                            const mostRecentChange =
                                modalTimelineChanges[modalTimelineChanges.length - 1];

                            if (mostRecentChange && mostRecentChange.newStartDate) {
                                const newStartDate = mostRecentChange.newStartDate;

                                const startEl = document.getElementById(`story-start-${storyId}`);
                                if (startEl) {
                                    startEl.value = newStartDate;
                                }

                                const editStartEl = document.getElementById('editStart');
                                if (editStartEl) {
                                    editStartEl.value = newStartDate;
                                }
                            }

                            if (mostRecentChange && mostRecentChange.newEndDate) {
                                const newEndDate = mostRecentChange.newEndDate;

                                // Update the main form's end date field
                                const endEl = document.getElementById(`story-end-${storyId}`);
                                if (endEl) {
                                    endEl.value = newEndDate;
                                }

                                // Also update the edit modal's end date field for consistency
                                const editEndEl = document.getElementById('editEnd');
                                if (editEndEl) {
                                    editEndEl.value = newEndDate;
                                }
                            }
                        }
                    } else {
                        // Clear all existing timeline changes if unchecked
                        const existingChanges = document.querySelectorAll(
                            `#changes-container-${storyId} > div[id^="change-${storyId}-change-"]`
                        );
                        existingChanges.forEach((changeEl) => changeEl.remove());
                    }

                    // Update button state after loading/clearing changes
                    updateChangeButton(storyId);

                    // Close modal
                    closeEditModal();

                    // Regenerate preview to show changes - add a longer delay to ensure all DOM updates are complete
                    setTimeout(() => {
                        generatePreview();
                    }, 200);
                }, 100);
            } catch (error) {
                alert('Error saving changes: ' + error.message);
            }
        }

        // Move story functions for modal
        function moveCurrentStoryUp() {
            if (!currentEditingStory) {
                alert('No story selected for editing.');
                return;
            }

            // Use the existing function with epic name and story index
            moveStoryUpByEpic(currentEditingStory.epicName, currentEditingStory.storyIndex);

            // Update the currentEditingStory index since the story moved up
            if (currentEditingStory.storyIndex > 0) {
                currentEditingStory.storyIndex--;
            }
        }

        function moveCurrentStoryDown() {
            if (!currentEditingStory) {
                alert('No story selected for editing.');
                return;
            }

            // BTL stories aren't grouped in an .epic-section - check the
            // boundary against the BTL container directly.
            if (currentEditingStory.epicName === 'Below the Line') {
                const btlContainer = document.getElementById('btl-stories-container');
                const btlStories = btlContainer.querySelectorAll('.story-section');
                if (currentEditingStory.storyIndex < btlStories.length - 1) {
                    moveStoryDownByEpic(
                        currentEditingStory.epicName,
                        currentEditingStory.storyIndex
                    );
                    currentEditingStory.storyIndex++;
                }
                return;
            }

            // Find the EPIC to check if this is the last story
            const epicElements = document.querySelectorAll('.epic-section');
            let targetEpicElement = null;

            epicElements.forEach((epicEl) => {
                const epicId = epicEl.id.split('-')[1];
                const epicNameEl = document.getElementById(`epic-name-${epicId}`);
                if (epicNameEl && epicNameEl.value.trim() === currentEditingStory.epicName) {
                    targetEpicElement = epicEl;
                }
            });

            if (targetEpicElement) {
                const storyElements = targetEpicElement.querySelectorAll('.story-section');
                // Only move if not the last story
                if (currentEditingStory.storyIndex < storyElements.length - 1) {
                    moveStoryDownByEpic(
                        currentEditingStory.epicName,
                        currentEditingStory.storyIndex
                    );
                    currentEditingStory.storyIndex++;
                }
            }
        }

        function deleteCurrentStory() {
            if (!currentEditingStory) {
                alert('No story selected for editing.');
                return;
            }

            // Handle BTL (Below the Line) stories differently
            if (currentEditingStory.epicName === 'Below the Line') {
                // BTL stories are stored in btl-stories-container
                const btlContainer = document.getElementById('btl-stories-container');
                const btlStories = btlContainer.querySelectorAll('.story-section');

                if (
                    currentEditingStory.storyIndex >= 0 &&
                    currentEditingStory.storyIndex < btlStories.length
                ) {
                    const storyToDelete = btlStories[currentEditingStory.storyIndex];
                    storyToDelete.remove();

                    // Update BTL add button state
                    updateBTLAddButton();

                    // Close the modal
                    closeEditModal();

                    // Refresh the roadmap preview
                    generatePreview();
                } else {
                    alert('Could not find BTL story to delete');
                }
                return;
            }

            // Handle regular EPIC stories
            const epicElements = document.querySelectorAll('.epic-section');
            let targetEpicElement = null;

            epicElements.forEach((epicEl) => {
                const epicId = epicEl.id.split('-')[1];
                const epicNameEl = document.getElementById(`epic-name-${epicId}`);
                if (epicNameEl && epicNameEl.value.trim() === currentEditingStory.epicName) {
                    targetEpicElement = epicEl;
                }
            });

            if (targetEpicElement) {
                const storyElements = targetEpicElement.querySelectorAll('.story-section');
                if (
                    currentEditingStory.storyIndex >= 0 &&
                    currentEditingStory.storyIndex < storyElements.length
                ) {
                    const storyToDelete = storyElements[currentEditingStory.storyIndex];
                    storyToDelete.remove();

                    // Update story numbers in the EPIC
                    updateStoryNumbers(targetEpicElement);

                    // Close the modal
                    closeEditModal();

                    // Refresh the roadmap preview
                    generatePreview();
                } else {
                    alert('Could not find EPIC story to delete');
                }
            } else {
                alert('Could not find EPIC for story');
            }
        }
        // Close modal when clicking outside
        document.addEventListener('click', function (event) {
            const modal = document.getElementById('editStoryModal');
            if (event.target === modal) {
                closeEditModal();
            }

            const monthlyKTLOModal = document.getElementById('editMonthlyKTLOModal');
            if (event.target === monthlyKTLOModal) {
                closeEditMonthlyKTLOModal();
            }
        });

        // Prevent form submission in modal to avoid page jumping
        document.addEventListener('DOMContentLoaded', function () {
            const modalForm = document.getElementById('editStoryForm');
            if (modalForm) {
                modalForm.addEventListener('submit', function (event) {
                    event.preventDefault();
                    return false;
                });
            }
        });

        // Enable hover for all monthly boxes including January/December
        function setupMonthlyBoxPriming(doc) {
            // Override the embedded CSS to allow January/December hover
            const style = doc.createElement('style');
            style.textContent = `
                /* Fix KTLO story blocking monthly boxes - using higher specificity */
                body iframe .roadmap-container .ktlo-story {
                    pointer-events: none;
                }
                
                body iframe .roadmap-container .ktlo-story .task-title,
                body iframe .roadmap-container .ktlo-story .task-bullets,
                body iframe .roadmap-container .ktlo-story .edit-icon {
                    pointer-events: auto;
                }
                
                /* 
                 * CONSOLIDATED MONTHLY BOX HOVER EFFECTS 
                 * Using iframe-specific high specificity to avoid !important
                 * These rules apply within the iframe only
                 */
                body iframe .roadmap-container .monthly-boxes-container .monthly-box .monthly-box-content:hover {
                    z-index: 1000;
                    position: relative;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                    transform: scale(1.3);
                }
                
                /* Specific month transforms with iframe specificity */
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-january .monthly-box-content:hover {
                    transform: translateX(-2px) scale(1.3);
                }
                
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-february .monthly-box-content:hover,
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-march .monthly-box-content:hover,
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-october .monthly-box-content:hover,
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-november .monthly-box-content:hover {
                    transform: scale(1.3);
                }
                
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-april .monthly-box-content:hover {
                    transform: translateX(2px) scale(1.3);
                }
                
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-may .monthly-box-content:hover,
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-june .monthly-box-content:hover {
                    transform: translateX(4px) scale(1.3);
                }
                
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-july .monthly-box-content:hover,
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-august .monthly-box-content:hover {
                    transform: translateX(6px) scale(1.3);
                }
                
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-september .monthly-box-content:hover {
                    transform: translateX(7px) scale(1.3);
                }
                
                body iframe .roadmap-container .monthly-boxes-container .monthly-box-december .monthly-box-content:hover {
                    transform: translateX(1px) scale(1.3);
                }
            `;
            doc.head.appendChild(style);
        }

        // Update document title based on team name
        function updateDocumentTitle() {
            const teamNameInput = document.getElementById('teamName');
            const teamName = teamNameInput ? teamNameInput.value.trim() : '';

            // Use same format as filename: fallback to 'MyTeam' if no team name
            const roadmapYear = document.getElementById('roadmapYear').value || '2025';
            document.title = `${teamName || 'MyTeam'}.Teya-Roadmap.${roadmapYear}.html`;
        }

        // Initialize title update when page loads
        document.addEventListener('DOMContentLoaded', function () {
            const teamNameInput = document.getElementById('teamName');
            if (teamNameInput) {
                // Update title when team name changes
                teamNameInput.addEventListener('input', updateDocumentTitle);
                teamNameInput.addEventListener('blur', updateDocumentTitle);

                // Update title on initial load
                updateDocumentTitle();
            }
        });

        // File Browser functionality. Directory selection is owned by the
        // shared directory store (see /app/directory-store.js) - we just read
        // from it and re-render the file list when it changes.

        // Toggle file browser collapse

        // Update file browser button visibility based on panel state

        // Delegates to the shared folder picker in the top nav. Kept for any
        // legacy callers that still invoke selectDirectory() directly.

        // Load and display files from selected directory

        // Open roadmap file - handle both JSON and Excel files

        // Process Excel workbook directly without localStorage

        // Check for loaded data from URL parameters
        function checkForLoadedData() {
            const urlParams = new URLSearchParams(window.location.search);
            const loadDataKey = urlParams.get('loadData');

            if (loadDataKey) {
                // Set flag to prevent default template loading
                window.loadingExternalData = true;
                try {
                    const dataStr = localStorage.getItem(loadDataKey);
                    if (dataStr) {
                        const loadedData = JSON.parse(dataStr);

                        if (loadedData._fileType === 'excel') {
                            // Excel handling removed
                        } else {
                            // Handle JSON data
                            const teamData = loadedData.teamData || loadedData;
                            loadTeamData(teamData);

                            // Ensure KTLO month data is displayed after JSON loading
                            setTimeout(() => {
                                const selector = document.getElementById('ktlo-month-selector');
                                if (selector) {
                                    const currentMonth = selector.value || 'jan';
                                    loadKTLOMonth(currentMonth);
                                }
                            }, 100);
                        }

                        // Collapse the builder if requested
                        if (loadedData._collapseBuilder) {
                            setTimeout(() => {
                                if (!isBuilderCollapsed()) {
                                    toggleBuilderCollapse();
                                }
                            }, 100);
                        }

                        // Clean up localStorage
                        localStorage.removeItem(loadDataKey);

                        // Remove the parameter from URL for cleaner appearance
                        const newUrl = window.location.href.split('?')[0];
                        window.history.replaceState({}, document.title, newUrl);

                        return true; // Indicate that external data was loaded
                    }
                } catch (error) {
                    console.error('Error loading roadmap data:', error);
                    alert('Error loading roadmap data: ' + error.message);

                    // Clear the flag since loading failed
                    window.loadingExternalData = false;
                    return false; // Indicate that external data loading failed
                }
            } else {
                return false; // No external data found
            }
        }

        // Check if File System Access API is supported and show warning if not
        document.addEventListener('DOMContentLoaded', async function () {
            // Check for loaded data first - this must happen before default template loading
            checkForLoadedData();

            // Initialize sorting checkboxes from saved prefs
            const sortingToggle = document.getElementById('story-sorting-toggle');
            const endToggle = document.getElementById('story-sorting-end-toggle');
            const textBelowToggle = document.getElementById('force-text-below-toggle');
            if (sortingToggle) {
                const byStart =
                    ConfigUtility.shouldSortByStart() || ConfigUtility.shouldSortStories();
                sortingToggle.checked = !!byStart;
            }
            if (endToggle) {
                endToggle.checked = !!ConfigUtility.shouldSortByEnd();
            }
            // Force text below is a one-time action, don't restore from saved state
            if (textBelowToggle) {
                textBelowToggle.checked = false;
            }

            // The shared directory store drives the file list. Subscribe once
            // and re-render whenever the selected folder (or its permission)
            // changes. Works for the initial state too since the store emits
            // synchronously on subscribe.
        });

        // === END legacy script body ===

        // Inline event attributes resolve their handlers against window.
        // toggleShareDropdown, closeShareDropdown, toggleShareDropdownBottom,
        // closeShareDropdownBottom, exportJPG, exportPDF are exposed at the top
        // of init() via Object.assign(window, share, exportLib).
        if (typeof createEpicId === 'function') window.createEpicId = createEpicId;
        if (typeof createStoryId === 'function') window.createStoryId = createStoryId;
        if (typeof loadDefaultTemplate === 'function')
            window.loadDefaultTemplate = loadDefaultTemplate;
        if (typeof initializeBasicTemplate === 'function')
            window.initializeBasicTemplate = initializeBasicTemplate;
        if (typeof attemptInitialization === 'function')
            window.attemptInitialization = attemptInitialization;
        if (typeof initializeKTLOMonths === 'function')
            window.initializeKTLOMonths = initializeKTLOMonths;
        if (typeof switchKTLOMonth === 'function') window.switchKTLOMonth = switchKTLOMonth;
        if (typeof loadKTLOMonth === 'function') window.loadKTLOMonth = loadKTLOMonth;
        if (typeof saveCurrentKTLOData === 'function')
            window.saveCurrentKTLOData = saveCurrentKTLOData;
        if (typeof addEpic === 'function') window.addEpic = addEpic;
        if (typeof removeEpic === 'function') window.removeEpic = removeEpic;
        if (typeof toggleEpicCollapse === 'function')
            window.toggleEpicCollapse = toggleEpicCollapse;
        if (typeof toggleBTLCollapse === 'function') window.toggleBTLCollapse = toggleBTLCollapse;
        if (typeof toggleStoryCollapse === 'function')
            window.toggleStoryCollapse = toggleStoryCollapse;
        if (typeof updateStoryHeaderTitle === 'function')
            window.updateStoryHeaderTitle = updateStoryHeaderTitle;
        if (typeof debouncedGeneratePreview === 'function')
            window.debouncedGeneratePreview = debouncedGeneratePreview;
        if (typeof handleForceTextBelowToggle === 'function')
            window.handleForceTextBelowToggle = handleForceTextBelowToggle;
        window.handleEpicTitleTopToggle = handleEpicTitleTopToggle;
        window.handleHideStoryTextToggle = handleHideStoryTextToggle;
        if (typeof addAutoUpdateListeners === 'function')
            window.addAutoUpdateListeners = addAutoUpdateListeners;
        if (typeof addListenersToExistingElements === 'function')
            window.addListenersToExistingElements = addListenersToExistingElements;
        if (typeof addListenersToElement === 'function')
            window.addListenersToElement = addListenersToElement;
        if (typeof addStory === 'function') window.addStory = addStory;
        if (typeof removeStory === 'function') window.removeStory = removeStory;
        if (typeof addBTLStory === 'function') window.addBTLStory = addBTLStory;
        if (typeof deleteBTLStory === 'function') window.deleteBTLStory = deleteBTLStory;
        if (typeof updateBTLAddButton === 'function')
            window.updateBTLAddButton = updateBTLAddButton;
        if (typeof getTodaysDateEuropean === 'function')
            window.getTodaysDateEuropean = getTodaysDateEuropean;
        if (typeof getCurrentRoadmapYear === 'function')
            window.getCurrentRoadmapYear = getCurrentRoadmapYear;
        // addInfoEntry/removeInfoEntry/convertSingleInfoToMultiple come from the
        // info-entries factory and are exposed via Object.assign at the top of init().
        if (typeof addEditInfoEntry === 'function') window.addEditInfoEntry = addEditInfoEntry;
        if (typeof removeEditInfoEntry === 'function')
            window.removeEditInfoEntry = removeEditInfoEntry;
        if (typeof updateStoryNumbers === 'function')
            window.updateStoryNumbers = updateStoryNumbers;
        if (typeof generatePreview === 'function') window.generatePreview = generatePreview;
        if (typeof initializeIframeInteraction === 'function')
            window.initializeIframeInteraction = initializeIframeInteraction;
        if (typeof addAlignmentGuide === 'function') window.addAlignmentGuide = addAlignmentGuide;
        if (typeof collectFormData === 'function') window.collectFormData = collectFormData;
        if (typeof collectStoryData === 'function') window.collectStoryData = collectStoryData;
        if (typeof collectKTLOData === 'function') window.collectKTLOData = collectKTLOData;
        if (typeof collectBTLData === 'function') window.collectBTLData = collectBTLData;
        if (typeof updateFilenameDisplay === 'function')
            window.updateFilenameDisplay = updateFilenameDisplay;
        if (typeof newRoadmap === 'function') window.newRoadmap = newRoadmap;
        if (typeof closeNewRoadmapModal === 'function')
            window.closeNewRoadmapModal = closeNewRoadmapModal;
        if (typeof confirmNewRoadmap === 'function') window.confirmNewRoadmap = confirmNewRoadmap;
        if (typeof saveRoadmapInPlace === 'function')
            window.saveRoadmapInPlace = saveRoadmapInPlace;
        if (typeof prepareRoadmapForSave === 'function')
            window.prepareRoadmapForSave = prepareRoadmapForSave;
        if (typeof downloadRoadmap === 'function') window.downloadRoadmap = downloadRoadmap;
        if (typeof loadRoadmap === 'function') window.loadRoadmap = loadRoadmap;
        if (typeof handleRoadmapLoad === 'function') window.handleRoadmapLoad = handleRoadmapLoad;
        if (typeof fixDatesOnLoad === 'function') window.fixDatesOnLoad = fixDatesOnLoad;
        if (typeof handleFileLoad === 'function') window.handleFileLoad = handleFileLoad;
        // Stats functions are exposed via Object.assign at the top of init().
        if (typeof updateIdCountersAfterImport === 'function')
            window.updateIdCountersAfterImport = updateIdCountersAfterImport;
        if (typeof loadTeamData === 'function') window.loadTeamData = loadTeamData;
        if (typeof roundToNearestFive === 'function')
            window.roundToNearestFive = roundToNearestFive;
        if (typeof loadKTLOData === 'function') window.loadKTLOData = loadKTLOData;
        if (typeof loadBTLData === 'function') window.loadBTLData = loadBTLData;
        if (typeof loadStoryData === 'function') window.loadStoryData = loadStoryData;
        if (typeof openEditStoryModal === 'function')
            window.openEditStoryModal = openEditStoryModal;
        if (typeof closeEditModal === 'function') window.closeEditModal = closeEditModal;
        if (typeof toggleEditStatusFields === 'function')
            window.toggleEditStatusFields = toggleEditStatusFields;
        if (typeof initializeEditKTLOMonths === 'function')
            window.initializeEditKTLOMonths = initializeEditKTLOMonths;
        if (typeof switchEditKTLOMonth === 'function')
            window.switchEditKTLOMonth = switchEditKTLOMonth;
        if (typeof loadEditKTLOMonth === 'function') window.loadEditKTLOMonth = loadEditKTLOMonth;
        if (typeof openEditMonthlyKTLOModal === 'function')
            window.openEditMonthlyKTLOModal = openEditMonthlyKTLOModal;
        if (typeof closeEditMonthlyKTLOModal === 'function')
            window.closeEditMonthlyKTLOModal = closeEditMonthlyKTLOModal;
        if (typeof saveMonthlyKTLOChanges === 'function')
            window.saveMonthlyKTLOChanges = saveMonthlyKTLOChanges;
        if (typeof findStoryInForm === 'function') window.findStoryInForm = findStoryInForm;
        if (typeof saveStoryChanges === 'function') window.saveStoryChanges = saveStoryChanges;
        if (typeof moveCurrentStoryUp === 'function')
            window.moveCurrentStoryUp = moveCurrentStoryUp;
        if (typeof moveCurrentStoryDown === 'function')
            window.moveCurrentStoryDown = moveCurrentStoryDown;
        if (typeof deleteCurrentStory === 'function')
            window.deleteCurrentStory = deleteCurrentStory;
        if (typeof setupMonthlyBoxPriming === 'function')
            window.setupMonthlyBoxPriming = setupMonthlyBoxPriming;
        if (typeof updateDocumentTitle === 'function')
            window.updateDocumentTitle = updateDocumentTitle;
        if (typeof checkForLoadedData === 'function')
            window.checkForLoadedData = checkForLoadedData;
    } finally {
        document.addEventListener = __origAdd;
    }
    for (const fn of __viewReady) {
        try {
            fn.call(document, new Event('DOMContentLoaded'));
        } catch (e) {
            console.error(e);
        }
    }
    return cleanupDirectorySubscription;
}
