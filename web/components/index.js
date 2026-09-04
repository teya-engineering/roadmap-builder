// Component bootstrap.
//
// The app renders most of its markup with innerHTML - views, epics, stories
// and modals are all rebuilt at runtime - so enhancement is driven by a
// MutationObserver rather than by a call at every render site. Anything that
// appears in the DOM is upgraded once and marked, so re-renders are cheap and
// repeat passes are no-ops.

import { enhanceSelect } from './select.js';
import { enhanceSearchField, enhanceNumberField } from './field.js';

const SELECTORS = {
    select: 'select:not([data-ui-enhanced])',
    // Opt-in: only fields meant to read as filters get the magnifier and the
    // clear button, so ordinary form inputs stay plain.
    search: 'input[data-ui-search]:not([data-ui-enhanced])',
    number: 'input[type="number"]:not([data-ui-enhanced]):not(.plain-text-field)',
};

// The rendered roadmap holds no form controls and is re-rendered on almost
// every keystroke, so walking it would be pure overhead.
const IGNORED_CONTAINERS = '#roadmap-mount, .preview-panel, .fullscreen-content';

function upgrade(root, selector, enhance) {
    if (root.matches?.(selector)) enhance(root);
    root.querySelectorAll?.(selector).forEach(enhance);
}

/** Upgrade every native control inside `root` that isn't already enhanced. */
export function enhanceComponents(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.closest?.(IGNORED_CONTAINERS)) return;
    upgrade(root, SELECTORS.select, enhanceSelect);
    upgrade(root, SELECTORS.search, enhanceSearchField);
    upgrade(root, SELECTORS.number, enhanceNumberField);
}

let observer = null;

/**
 * Enhance what is on the page now and keep enhancing whatever gets added.
 * Safe to call more than once - the observer is installed a single time.
 */
export function startComponents() {
    enhanceComponents(document.body);
    if (observer) return;

    observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) enhanceComponents(node);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
