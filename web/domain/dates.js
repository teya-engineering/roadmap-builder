export const MONTH_SHORT = Object.freeze([
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
]);

export const MONTH_LONG = Object.freeze([
    'JANUARY',
    'FEBRUARY',
    'MARCH',
    'APRIL',
    'MAY',
    'JUNE',
    'JULY',
    'AUGUST',
    'SEPTEMBER',
    'OCTOBER',
    'NOVEMBER',
    'DECEMBER',
]);

export const EUROPEAN_DATE_REGEX = /^\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?$/;
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function todayEuropean() {
    const today = new Date();
    return formatParts(today.getDate(), today.getMonth() + 1, today.getFullYear());
}

export function formatEuropean(dateStr, roadmapYear = null) {
    const parts = parseEuropeanParts(dateStr, roadmapYear);
    return parts ? formatParts(parts.day, parts.month, parts.year) : dateStr;
}

export function europeanToIso(dateStr, roadmapYear = null) {
    const parts = parseEuropeanParts(dateStr, roadmapYear);
    if (!parts) return dateStr;

    return [
        parts.year,
        String(parts.month).padStart(2, '0'),
        String(parts.day).padStart(2, '0'),
    ].join('-');
}

export function parseEuropean(dateStr) {
    if (!dateStr) return new Date(0);

    const parts = parseEuropeanParts(String(dateStr));
    if (!parts) return new Date(Number.NaN);

    return new Date(parts.year, parts.month - 1, parts.day);
}

export function looksEuropean(dateStr) {
    return typeof dateStr === 'string' && EUROPEAN_DATE_REGEX.test(dateStr);
}

export function looksIso(dateStr) {
    return typeof dateStr === 'string' && ISO_DATE_REGEX.test(dateStr);
}

export function monthIndex(name) {
    if (typeof name !== 'string') return -1;

    const normalized = name.trim().toUpperCase();
    const shortIndex = MONTH_SHORT.indexOf(normalized);
    return shortIndex >= 0 ? shortIndex : MONTH_LONG.indexOf(normalized);
}

function parseEuropeanParts(dateStr, roadmapYear = null) {
    if (typeof dateStr !== 'string') return null;

    const match = dateStr.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);
    if (!match) return null;

    let day = Number(match[1]);
    let month = Number(match[2]);
    const fallbackYear = roadmapYear ?? new Date().getFullYear();
    let year = Number(match[3] ?? fallbackYear);

    if (month > 12 && day <= 12) {
        [day, month] = [month, day];
    }
    if (year < 100) year += 2000;
    if (!isCalendarDate(day, month, year)) return null;

    return { day, month, year };
}

function isCalendarDate(day, month, year) {
    if (day < 1 || month < 1 || month > 12) return false;

    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatParts(day, month, year) {
    return [
        String(day).padStart(2, '0'),
        String(month).padStart(2, '0'),
        String(year).slice(-2),
    ].join('/');
}
