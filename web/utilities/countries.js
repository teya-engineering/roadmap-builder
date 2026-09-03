/**
 * Canonical country list used across the builder and search UIs.
 *
 * Contract:
 *  - `name` is the display label AND the persisted value in roadmap JSONs
 *    (`story.countryFlags` contains strings like "Global", "UK", "Czechia").
 *  - `code` is the ISO 3166-1 alpha-2 (with `global` as the meta-option).
 *  - `flag` is the SVG filename under `./assets/flags/`.
 *
 * `Global` is pinned first and is mutually exclusive with individual
 * countries: picking Global clears countries and picking any country
 * clears Global. Callers are responsible for enforcing that via their
 * own onChange handlers (see clearStoryCountriesIfGlobalSelected etc).
 */

/** @typedef {{ code: string, name: string, flag: string }} Country */

/** @type {readonly Country[]} */
export const COUNTRIES = Object.freeze([
    { code: 'global', name: 'Global', flag: 'global.svg' },
    { code: 'hr', name: 'Croatia', flag: 'hr.svg' },
    { code: 'cz', name: 'Czechia', flag: 'cz.svg' },
    { code: 'fr', name: 'France', flag: 'fr.svg' },
    { code: 'de', name: 'Germany', flag: 'de.svg' },
    { code: 'hu', name: 'Hungary', flag: 'hu.svg' },
    { code: 'is', name: 'Iceland', flag: 'is.svg' },
    { code: 'it', name: 'Italy', flag: 'it.svg' },
    { code: 'pt', name: 'Portugal', flag: 'pt.svg' },
    { code: 'sk', name: 'Slovakia', flag: 'sk.svg' },
    { code: 'si', name: 'Slovenia', flag: 'si.svg' },
    { code: 'es', name: 'Spain', flag: 'es.svg' },
    { code: 'uk', name: 'UK', flag: 'gb.svg' },
]);

export const GLOBAL_COUNTRY_CODE = 'global';

function escapeHTML(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
}

/**
 * Render the country-flag checkbox group as an HTML string.
 *
 * @param {object} opts
 * @param {(country: Country) => string} [opts.id]
 *        Function returning the DOM id for each checkbox. Existing save/load
 *        code looks these up by id, so callers must preserve their id scheme.
 * @param {(country: Country) => string} [opts.onChange]
 *        JS expression to put in the input's `onchange` attribute.
 *        The string is inserted verbatim, so return something like
 *        `"clearEditGlobalIfCountrySelected()"`.
 * @param {(country: Country) => boolean} [opts.checked]
 *        Whether the checkbox starts checked.
 * @param {boolean} [opts.readOnly]
 *        Disable all inputs (used by the story detail view modal).
 * @param {string} [opts.legend]
 *        Fieldset legend text.
 * @param {boolean} [opts.visuallyHiddenLegend]
 *        Hide the legend visually but keep it for assistive tech.
 * @returns {string}
 */
export function renderCountryFlagsHTML(opts) {
    const o = opts || {};
    const idOf = o.id || ((c) => c.code);
    const onChangeOf = o.onChange || (() => '');
    const checkedOf = o.checked || (() => false);
    const readOnly = Boolean(o.readOnly);
    const legend = o.legend || 'Country Flags';
    const hiddenLegend = Boolean(o.visuallyHiddenLegend);

    const disabledAttr = readOnly ? ' disabled' : '';
    const readOnlyClass = readOnly ? ' country-flags-fieldset--readonly' : '';
    const legendClass = hiddenLegend ? ' country-flags-legend--hidden' : '';

    const renderOption = (c) => {
        const elId = idOf(c);
        const change = onChangeOf(c);
        const changeAttr = change ? ` onchange="${escapeHTML(change)}"` : '';
        const checkedAttr = checkedOf(c) ? ' checked' : '';
        return `<label class="country-flag-option">
            <input type="checkbox" id="${escapeHTML(elId)}"${changeAttr}${checkedAttr}${disabledAttr}>
            <img src="./assets/flags/${escapeHTML(c.flag)}" class="flag-icon" alt="" aria-hidden="true">
            <span>${escapeHTML(c.name)}</span>
        </label>`;
    };

    const global = COUNTRIES.find((c) => c.code === GLOBAL_COUNTRY_CODE);
    const others = COUNTRIES.filter((c) => c.code !== GLOBAL_COUNTRY_CODE);

    return `<fieldset class="country-flags-fieldset${readOnlyClass}">
        <legend class="country-flags-legend${legendClass}">${escapeHTML(legend)}</legend>
        <div class="country-flags-global-row">${renderOption(global)}</div>
        <div class="country-flags-list">${others.map(renderOption).join('')}</div>
    </fieldset>`;
}
