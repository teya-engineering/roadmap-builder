import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    MONTH_SHORT,
    MONTH_LONG,
    formatEuropean,
    europeanToIso,
    parseEuropean,
    looksEuropean,
    looksIso,
    monthIndex,
} from './dates.js';

test('MONTH_SHORT and MONTH_LONG have 12 entries', () => {
    assert.equal(MONTH_SHORT.length, 12);
    assert.equal(MONTH_LONG.length, 12);
    assert.equal(MONTH_SHORT[0], 'JAN');
    assert.equal(MONTH_LONG[0], 'JANUARY');
});

test('formatEuropean canonicalizes DD/MM/YY shapes', () => {
    assert.equal(formatEuropean('1/3/26'), '01/03/26');
    assert.equal(formatEuropean('01/03/2026'), '01/03/26');
    assert.equal(formatEuropean('1-3-26'), '01/03/26');
});

test('formatEuropean fills in roadmapYear when year is missing', () => {
    assert.equal(formatEuropean('15/06', 2026), '15/06/26');
});

test('formatEuropean returns input when not a date', () => {
    assert.equal(formatEuropean(''), '');
    assert.equal(formatEuropean(null), null);
    assert.equal(formatEuropean('not a date'), 'not a date');
});

test('europeanToIso converts to YYYY-MM-DD', () => {
    assert.equal(europeanToIso('15/06/26'), '2026-06-15');
    assert.equal(europeanToIso('01/12/2025'), '2025-12-01');
});

test('europeanToIso auto-corrects an obvious month/day swap', () => {
    // 13 cannot be a month, so the parser must read this as 13-Jun.
    assert.equal(europeanToIso('06/13/26'), '2026-06-13');
});

test('europeanToIso uses roadmapYear when year is missing', () => {
    assert.equal(europeanToIso('15/06', 2027), '2027-06-15');
});

test('European date parsing validates calendar dates', () => {
    assert.equal(europeanToIso('29/02/24'), '2024-02-29');
    assert.equal(europeanToIso('29/02/25'), '29/02/25');
    assert.equal(europeanToIso('31/04/25'), '31/04/25');
    assert.equal(Number.isNaN(parseEuropean('31/04/25').getTime()), true);
});

test('parseEuropean returns Date(0) for empty input', () => {
    assert.equal(parseEuropean('').getTime(), 0);
    assert.equal(parseEuropean(null).getTime(), 0);
});

test('parseEuropean parses DD/MM/YY into the correct local date', () => {
    const d = parseEuropean('15/06/26');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 5); // June
    assert.equal(d.getDate(), 15);
});

test('parseEuropean orders dates monotonically', () => {
    const a = parseEuropean('01/01/26');
    const b = parseEuropean('15/06/26');
    const c = parseEuropean('31/12/26');
    assert.ok(a.getTime() < b.getTime());
    assert.ok(b.getTime() < c.getTime());
});

test('looksEuropean recognizes valid shapes', () => {
    assert.equal(looksEuropean('15/06/26'), true);
    assert.equal(looksEuropean('1/6/2026'), true);
    assert.equal(looksEuropean('15-06-2026'), true);
    assert.equal(looksEuropean('15/06'), true);
});

test('looksEuropean rejects non-dates', () => {
    assert.equal(looksEuropean(''), false);
    assert.equal(looksEuropean('JAN 2026'), false);
    assert.equal(looksEuropean('2026-06-15'), false);
    assert.equal(looksEuropean(null), false);
});

test('looksIso recognizes ISO 8601 dates', () => {
    assert.equal(looksIso('2026-06-15'), true);
    assert.equal(looksIso('15/06/26'), false);
    assert.equal(looksIso(null), false);
});

test('monthIndex handles short, long, and casing', () => {
    assert.equal(monthIndex('JAN'), 0);
    assert.equal(monthIndex('jan'), 0);
    assert.equal(monthIndex('January'), 0);
    assert.equal(monthIndex('DEC'), 11);
    assert.equal(monthIndex('December'), 11);
    assert.equal(monthIndex('  June  '), 5);
});

test('monthIndex returns -1 for unknown input', () => {
    assert.equal(monthIndex(''), -1);
    assert.equal(monthIndex('Smarch'), -1);
    assert.equal(monthIndex(null), -1);
});
