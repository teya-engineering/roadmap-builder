// Text-filter and number fields.
//
// Both wrap the native input rather than replacing it, so `.value`, inline
// `onkeypress`/`onchange` attributes and the app's global `input` listener all
// keep working. The wrapper becomes the visible box; the input inside is
// stripped of its own border and padding.

// Layout-only attributes belong on the wrapper, since the wrapper is now the
// visible box. Everything else stays on the input.
function adoptLayoutAttributes(wrapper, input, baseClass) {
    wrapper.className = input.className ? `${baseClass} ${input.className}` : baseClass;
    input.className = '';
    if (input.getAttribute('style')) {
        wrapper.setAttribute('style', input.getAttribute('style'));
        input.removeAttribute('style');
    }
}

function wrap(input, baseClass) {
    const wrapper = document.createElement('div');
    adoptLayoutAttributes(wrapper, input, baseClass);
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    return wrapper;
}

// Mirrors what a user edit looks like: `input` drives the live preview and the
// unsaved-changes flag, `change` drives the search filters.
function announceEdit(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Search/filter text field: leading magnifier plus a clear button.
 * @param {HTMLInputElement} input
 */
export function enhanceSearchField(input) {
    if (input.dataset.uiEnhanced === 'true') return;
    input.dataset.uiEnhanced = 'true';

    const wrapper = wrap(input, 'ui-field');
    input.classList.add('ui-field__input');

    const icon = document.createElement('span');
    icon.className = 'ui-icon ui-field__icon';
    icon.setAttribute('aria-hidden', 'true');

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ui-field__clear';
    clear.tabIndex = -1;
    clear.setAttribute('aria-label', 'Clear');
    clear.title = 'Clear';

    // The clear button's visibility is CSS-driven off :placeholder-shown, so a
    // placeholder is what makes an emptied field hide it again.
    if (!input.placeholder) input.placeholder = ' ';

    wrapper.prepend(icon);
    wrapper.appendChild(clear);

    clear.addEventListener('click', () => {
        if (!input.value) return;
        input.value = '';
        announceEdit(input);
        input.focus();
    });

    // Clicking the padding around the input should still land in the text.
    wrapper.addEventListener('click', (event) => {
        if (event.target === wrapper || event.target === icon) input.focus();
    });
}

/**
 * Number field: native spinners swapped for steppers that match the app.
 * @param {HTMLInputElement} input
 */
export function enhanceNumberField(input) {
    if (input.dataset.uiEnhanced === 'true') return;
    input.dataset.uiEnhanced = 'true';

    const wrapper = wrap(input, 'ui-number');
    input.classList.add('ui-number__input');

    const steppers = document.createElement('span');
    steppers.className = 'ui-number__steppers';

    for (const direction of ['up', 'down']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ui-number__step';
        button.dataset.direction = direction;
        button.tabIndex = -1;
        button.setAttribute('aria-label', direction === 'up' ? 'Increase' : 'Decrease');
        button.addEventListener('click', () => {
            if (input.disabled || input.readOnly) return;
            try {
                // stepUp/stepDown honour min, max and step, and treat an
                // empty field as 0, matching the native spinners. They throw
                // when the current value isn't a number the step can apply to.
                if (direction === 'up') input.stepUp();
                else input.stepDown();
            } catch {
                return;
            }
            announceEdit(input);
        });
        steppers.appendChild(button);
    }

    wrapper.appendChild(steppers);
}
