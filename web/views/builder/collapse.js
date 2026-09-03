// Collapse/expand helpers. Three layers:
//   - toggleCollapse(contentId, buttonId, sectionName): generic helper used
//     for KTLO and BTL section content. Pure DOM, no internal state.
//   - collapseAllSections(): one-shot collapse of every collapsible section
//     (epics, KTLO, BTL, monthly KTLO). Used after a roadmap loads.
//   - createBuilderCollapse(): factory for the builder-panel collapse, which
//     owns its open/closed state internally and exposes a getter for the
//     body's "is it already collapsed?" check.

export function toggleCollapse(contentId, buttonId, sectionName) {
    const contentDiv = document.getElementById(contentId);
    const collapseBtn = document.getElementById(buttonId);
    if (!contentDiv || !collapseBtn) return;

    if (contentDiv.style.display === 'none') {
        contentDiv.style.display = 'block';
        collapseBtn.textContent = '▼';
        collapseBtn.title = `Collapse ${sectionName}`;
        collapseBtn.classList.remove('collapse-btn-collapsed');
    } else {
        contentDiv.style.display = 'none';
        collapseBtn.textContent = '▶';
        collapseBtn.title = `Expand ${sectionName}`;
        collapseBtn.classList.add('collapse-btn-collapsed');
    }
}

// All sections collapse to ▶ + add the .collapse-btn-collapsed class. The
// pairs of ids match what the builder markup renders for each section type.
const SECTION_COLLAPSE_TARGETS = [
    { contentId: 'ktlo-content', btnId: 'ktlo-collapse-btn', name: 'KTLO' },
    { contentId: 'btl-content', btnId: 'btl-collapse-btn', name: 'BTL' },
    { contentId: 'ktlo-monthly-content', btnId: 'ktlo-monthly-collapse-btn', name: 'Monthly KTLO' },
];

export function collapseAllSections() {
    // Each epic gets its own collapse pair keyed by epic id.
    document.querySelectorAll('.epic-section').forEach((epicEl) => {
        const epicId = epicEl.id.split('-')[1];
        const contentDiv = document.getElementById(`epic-content-${epicId}`);
        const collapseBtn = document.getElementById(`collapse-btn-${epicId}`);
        if (!contentDiv || !collapseBtn) return;
        contentDiv.style.display = 'none';
        collapseBtn.textContent = '▶';
        collapseBtn.title = 'Expand EPIC';
        collapseBtn.classList.add('collapse-btn-collapsed');
    });

    for (const { contentId, btnId, name } of SECTION_COLLAPSE_TARGETS) {
        const contentDiv = document.getElementById(contentId);
        const btn = document.getElementById(btnId);
        if (!contentDiv || !btn) continue;
        contentDiv.style.display = 'none';
        btn.textContent = '▶';
        btn.title = `Expand ${name}`;
        btn.classList.add('collapse-btn-collapsed');
    }
}

/**
 * Builder panel collapse. Returns the toggle function plus a getter so body
 * code can ask "is the builder already collapsed?" without reading our state.
 */
export function createBuilderCollapse() {
    let collapsed = false;

    function toggleBuilderCollapse() {
        const panel = document.querySelector('.builder-panel');
        const btn = document.getElementById('builderCollapseBtn');
        if (!panel || !btn) return;

        if (collapsed) {
            panel.classList.remove('collapsed');
            btn.textContent = '▲';
            btn.title = 'Collapse builder';
            btn.setAttribute('aria-label', 'Collapse builder');
            collapsed = false;
        } else {
            panel.classList.add('collapsed');
            btn.textContent = '▼';
            btn.title = 'Expand builder';
            btn.setAttribute('aria-label', 'Expand builder');
            collapsed = true;
        }
    }

    function isBuilderCollapsed() {
        return collapsed;
    }

    return { toggleBuilderCollapse, isBuilderCollapsed };
}
