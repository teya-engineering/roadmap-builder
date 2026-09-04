// Custom select. Wraps a native <select> in a button + listbox pair so the
// closed control and the open menu both follow the app's design tokens - a
// native <select> popup is drawn by the OS and cannot be themed.
//
// The native <select> stays inside the wrapper as the source of truth, so
// every existing `getElementById(id).value` read/write, inline `onchange`
// attribute and `addEventListener('change')` keeps working untouched. The
// only extra wiring is a `value` property hook, so that code which assigns
// `.value` programmatically (which fires no event) still refreshes the label.

const OPEN_MENU_CLASS = 'ui-select-menu';

// Layout-only attributes belong on the wrapper, since the wrapper is now the
// visible box. Everything else stays on the hidden native select.
function adoptLayoutAttributes(wrapper, select) {
    if (select.className) {
        wrapper.className = `ui-select ${select.className}`;
        select.className = '';
    }
    if (select.getAttribute('style')) {
        wrapper.setAttribute('style', select.getAttribute('style'));
        select.removeAttribute('style');
    }
}

/** @returns {HTMLElement | null} */
function optionUnder(event) {
    const target = /** @type {Element | null} */ (event.target);
    return /** @type {HTMLElement | null} */ (target?.closest?.('.ui-select-menu__option') ?? null);
}

function selectedOption(select) {
    return select.options[select.selectedIndex] || null;
}

// An option with an empty value is a prompt ("Any Priority", "Select..."),
// so it renders in muted placeholder text rather than as a real value.
function isPlaceholder(option) {
    return !option || option.value === '';
}

/** @param {HTMLSelectElement} select */
export function enhanceSelect(select) {
    if (select.dataset.uiEnhanced === 'true') return;
    select.dataset.uiEnhanced = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'ui-select';
    adoptLayoutAttributes(wrapper, select);
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add('ui-select__native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ui-select__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (select.id) trigger.id = `${select.id}-trigger`;

    const valueLabel = document.createElement('span');
    valueLabel.className = 'ui-select__value';
    const arrow = document.createElement('span');
    arrow.className = 'ui-icon ui-select__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    trigger.append(valueLabel, arrow);
    wrapper.appendChild(trigger);

    // A <label for="..."> points at the native select, which is unreachable.
    // Bounce that focus over to the trigger so label clicks still work.
    select.addEventListener('focus', () => trigger.focus());

    let menu = null;
    let activeIndex = -1;

    function syncTrigger() {
        const option = selectedOption(select);
        valueLabel.textContent = option ? option.textContent.trim() : '';
        valueLabel.dataset.placeholder = String(isPlaceholder(option));
        const disabled = select.disabled;
        trigger.disabled = disabled;
        wrapper.dataset.disabled = String(disabled);
        if (select.title) trigger.title = select.title;
    }

    function setActive(index) {
        if (!menu) return;
        const options = menu.children;
        if (index < 0 || index >= options.length) return;
        if (activeIndex >= 0 && options[activeIndex]) options[activeIndex].dataset.active = 'false';
        activeIndex = index;
        options[index].dataset.active = 'true';
        menu.setAttribute('aria-activedescendant', options[index].id);
        options[index].scrollIntoView({ block: 'nearest' });
    }

    function position() {
        if (!menu) return;
        const rect = wrapper.getBoundingClientRect();
        const height = menu.offsetHeight;
        const spaceBelow = window.innerHeight - rect.bottom;
        // Flip above the trigger when the menu would run off the bottom of
        // the viewport and there is more headroom up top.
        const openUpward = spaceBelow < height + 8 && rect.top > spaceBelow;
        menu.style.left = `${rect.left}px`;
        menu.style.top = openUpward ? `${rect.top - height - 4}px` : `${rect.bottom + 4}px`;
        menu.style.minWidth = `${rect.width}px`;
    }

    function close({ refocus = false } = {}) {
        if (!menu) return;
        // Detaching the menu blurs it, and the blur handler closes again, so
        // the state has to be cleared before the node leaves the document or
        // the second pass tries to remove an element that is already gone.
        const open = menu;
        menu = null;
        activeIndex = -1;
        wrapper.dataset.open = 'false';
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onOutsidePointer, true);
        window.removeEventListener('scroll', position, true);
        window.removeEventListener('resize', position);
        open.remove();
        if (refocus) trigger.focus();
    }

    function onOutsidePointer(event) {
        if (menu && !menu.contains(event.target) && !wrapper.contains(event.target)) close();
    }

    function commit(index) {
        const option = select.options[index];
        if (!option || option.disabled) return;
        const changed = select.selectedIndex !== index;
        select.selectedIndex = index;
        syncTrigger();
        close({ refocus: true });
        if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function open() {
        if (menu || select.disabled) return;

        menu = document.createElement('div');
        menu.className = OPEN_MENU_CLASS;
        menu.setAttribute('role', 'listbox');
        menu.tabIndex = -1;

        Array.from(select.options).forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'ui-select-menu__option';
            item.id = `${select.id || 'ui-select'}-option-${index}`;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(index === select.selectedIndex));
            item.dataset.index = String(index);
            item.textContent = option.textContent.trim();
            if (option.disabled) item.setAttribute('aria-disabled', 'true');
            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        wrapper.dataset.open = 'true';
        trigger.setAttribute('aria-expanded', 'true');
        position();
        menu.focus();
        setActive(Math.max(select.selectedIndex, 0));

        menu.addEventListener('pointerdown', (event) => event.preventDefault());
        menu.addEventListener('click', (event) => {
            const item = optionUnder(event);
            if (item) commit(Number(item.dataset.index));
        });
        menu.addEventListener('pointermove', (event) => {
            const item = optionUnder(event);
            if (item) setActive(Number(item.dataset.index));
        });
        menu.addEventListener('keydown', onMenuKeyDown);
        menu.addEventListener('blur', () => close());

        // Capture phase so the menu follows the trigger when any ancestor
        // panel scrolls, not just the window.
        document.addEventListener('pointerdown', onOutsidePointer, true);
        window.addEventListener('scroll', position, true);
        window.addEventListener('resize', position);
    }

    function onMenuKeyDown(event) {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                setActive(Math.min(activeIndex + 1, select.options.length - 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                setActive(Math.max(activeIndex - 1, 0));
                break;
            case 'Home':
                event.preventDefault();
                setActive(0);
                break;
            case 'End':
                event.preventDefault();
                setActive(select.options.length - 1);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                commit(activeIndex);
                break;
            case 'Escape':
                event.preventDefault();
                event.stopPropagation();
                close({ refocus: true });
                break;
            case 'Tab':
                close();
                break;
            default:
                break;
        }
    }

    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        if (menu) close({ refocus: true });
        else open();
    });

    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
            event.preventDefault();
            open();
        }
    });

    // Assigning `select.value` fires no event, and plenty of app code does
    // exactly that when loading a roadmap. Hook the property so the visible
    // label never drifts from the native element.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
        configurable: true,
        get() {
            return descriptor.get.call(this);
        },
        set(next) {
            descriptor.set.call(this, next);
            syncTrigger();
        },
    });

    select.addEventListener('change', syncTrigger);
    syncTrigger();
}
