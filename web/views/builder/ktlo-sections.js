// KTLO section show/hide/position helpers.
//
//   - toggleKTLOCollapse: collapses or expands the KTLO form section.
//   - hideKTLOSection / showKTLOSection: visibility toggles for the entire
//     section (used when a roadmap is loaded with KTLO disabled).
//   - repositionKTLOSection: moves the KTLO header+content above EPICs (top)
//     or between EPICs and BTL (bottom) based on the position checkbox.
//   - handleKTLOToggleShortcut: Shift+K keyboard shortcut binding.
//   - toggleKTLOPosition: the action - flips the toggle, repositions, refreshes
//     the preview, and surfaces a toast.

import { showToast } from './notifications.js';

export function hideKTLOSection() {
    const section = document.querySelector('.ktlo-section');
    if (section) section.style.display = 'none';
}

export function showKTLOSection() {
    const section = document.querySelector('.ktlo-section');
    if (section) section.style.display = '';
}

export function repositionKTLOSection() {
    const ktloToggle = document.getElementById('ktlo-position-toggle');
    if (!ktloToggle) return;

    const ktloSection = document.querySelector('.ktlo-section');
    const epicsContainer = document.getElementById('epics-container');
    const epicsButton = document.querySelector('.epic-add-button');
    const btlSection = document.querySelector('.btl-section');

    if (!ktloSection || !epicsContainer || !epicsButton || !btlSection) return;

    if (ktloToggle.checked) {
        epicsContainer.parentNode.insertBefore(ktloSection, epicsContainer);
        return;
    }

    btlSection.parentNode.insertBefore(ktloSection, btlSection);
}

function showKTLOPositionNotification(isTop) {
    showToast(`KTLO moved to ${isTop ? 'TOP' : 'BOTTOM'} (Shift+K to toggle)`);
}

/**
 * @param {object} deps
 * @param {(sectionType: string) => void} deps.initializeDatePickersForSection
 *        Initializes date pickers within a named section ('ktlo' or 'btl').
 * @param {() => void} deps.generatePreview
 */
export function createKTLOSectionHandlers({ initializeDatePickersForSection, generatePreview }) {
    function toggleKTLOCollapse() {
        const contentDiv = document.getElementById('ktlo-content');
        const collapseBtn = document.getElementById('ktlo-collapse-btn');
        if (!contentDiv || !collapseBtn) return;

        if (contentDiv.style.display === 'none') {
            contentDiv.style.display = '';
            collapseBtn.textContent = '▼';
            collapseBtn.title = 'Collapse KTLO';
            collapseBtn.classList.remove('collapse-btn-collapsed');
            // Date pickers can only initialize on visible inputs; defer one
            // tick so the section's children layout before we attach.
            setTimeout(() => initializeDatePickersForSection('ktlo'), 50);
        } else {
            contentDiv.style.display = 'none';
            collapseBtn.textContent = '▶';
            collapseBtn.title = 'Expand KTLO';
            collapseBtn.classList.add('collapse-btn-collapsed');
        }
    }

    function toggleKTLOPosition() {
        const ktloToggle = document.getElementById('ktlo-position-toggle');
        if (!ktloToggle) return;

        if (ktloToggle.dataset.originalPosition === 'hidden') {
            // Special case: KTLO was hidden via JSON. Shift+K reveals it at the top.
            delete ktloToggle.dataset.originalPosition;
            ktloToggle.checked = true;
            showKTLOSection();
        } else {
            ktloToggle.checked = !ktloToggle.checked;
        }

        repositionKTLOSection();
        generatePreview();
        showKTLOPositionNotification(ktloToggle.checked);
    }

    function handleKTLOToggleShortcut(event) {
        // Don't intercept the shortcut while the user is typing.
        const active = document.activeElement;
        const isEditable =
            active &&
            (active.tagName === 'INPUT' ||
                active.tagName === 'TEXTAREA' ||
                active.contentEditable === 'true');
        if (isEditable) return;

        if (!(event.shiftKey && event.key === 'K')) return;

        // If KTLO is hidden via JSON (originalPosition === 'hidden'), the
        // shortcut is a no-op until the user explicitly enables KTLO.
        const ktloToggle = document.getElementById('ktlo-position-toggle');
        if (ktloToggle && ktloToggle.dataset.originalPosition === 'hidden') return;

        event.preventDefault();
        toggleKTLOPosition();
    }

    return { toggleKTLOCollapse, toggleKTLOPosition, handleKTLOToggleShortcut };
}
