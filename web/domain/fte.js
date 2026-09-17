// Story staffing: roughly how many people work on a story, in halves.
//
// The field is optional, so "nobody has said" has to stay distinguishable from
// "staffed with nobody". Unknown is absent (null); zero is a real answer and
// gets its own tag. No DOM/window access so it stays unit-testable under
// `node --test`.

/**
 * Read a raw form value (or a value from a hand-edited JSON file) into a
 * story `fte`.
 *
 * @param {unknown} raw
 * @returns {number|null} null when empty or not a usable number
 */
export function parseFte(raw) {
    if (raw == null) return null;
    const text = String(raw).trim();
    if (text === '') return null;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
}

/**
 * `2` rather than `2.0`, `1.5` rather than `1.50`. The rounding keeps a float
 * sum like `0.1 + 0.2` from leaking its tail into the UI.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatFte(value) {
    return String(Math.round(value * 100) / 100);
}

/**
 * The text on a story bar, e.g. `1.5 FTE`.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatFteTag(value) {
    return `${formatFte(value)} FTE`;
}
