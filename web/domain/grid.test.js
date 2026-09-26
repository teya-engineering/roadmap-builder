import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    COLUMNS_PER_MONTH,
    MONTHS_IN_YEAR,
    MAX_COLUMNS,
    monthToGridStart,
    gridToMonthIndex,
    textBoxWidth,
    zoomLevel,
    shouldPlaceBadgeBelow,
} from './grid.js';

test('grid constants', () => {
    assert.equal(COLUMNS_PER_MONTH, 10);
    assert.equal(MONTHS_IN_YEAR, 12);
    assert.equal(MAX_COLUMNS, 120);
});

test('monthToGridStart maps each month to its starting column', () => {
    assert.equal(monthToGridStart('JAN'), 1);
    assert.equal(monthToGridStart('FEB'), 11);
    assert.equal(monthToGridStart('MAR'), 21);
    assert.equal(monthToGridStart('APR'), 31);
    assert.equal(monthToGridStart('MAY'), 41);
    assert.equal(monthToGridStart('JUN'), 51);
    assert.equal(monthToGridStart('JUL'), 61);
    assert.equal(monthToGridStart('AUG'), 71);
    assert.equal(monthToGridStart('SEP'), 81);
    assert.equal(monthToGridStart('OCT'), 91);
    assert.equal(monthToGridStart('NOV'), 101);
    assert.equal(monthToGridStart('DEC'), 111);
});

test('monthToGridStart accepts long names and is case-insensitive', () => {
    assert.equal(monthToGridStart('January'), 1);
    assert.equal(monthToGridStart('june'), 51);
});

test('gridToMonthIndex inverts monthToGridStart at month boundaries', () => {
    assert.equal(gridToMonthIndex(1), 0); // Jan
    assert.equal(gridToMonthIndex(11), 1); // Feb
    assert.equal(gridToMonthIndex(111), 11); // Dec
});

test('gridToMonthIndex maps mid-month columns correctly', () => {
    assert.equal(gridToMonthIndex(5), 0); // mid-Jan
    assert.equal(gridToMonthIndex(15), 1); // mid-Feb
    assert.equal(gridToMonthIndex(120), 11); // last column of Dec
});

test('gridToMonthIndex returns -1 for out-of-range columns', () => {
    assert.equal(gridToMonthIndex(0), -1);
    assert.equal(gridToMonthIndex(121), -1);
    assert.equal(gridToMonthIndex(-1), -1);
});

test('textBoxWidth follows the small-count table', () => {
    assert.equal(textBoxWidth(1), 16);
    assert.equal(textBoxWidth(2), 26);
    assert.equal(textBoxWidth(3), 38);
    assert.equal(textBoxWidth(4), 50);
    assert.equal(textBoxWidth(5), 62);
    assert.equal(textBoxWidth(6), 74);
    assert.equal(textBoxWidth(7), 85);
});

test('textBoxWidth extrapolates linearly past 7 items', () => {
    // 7 items = 85, then +12 per additional item.
    assert.equal(textBoxWidth(8), 85 + 12);
    assert.equal(textBoxWidth(10), 85 + 36);
});

test('zoomLevel: short stories zoom in, long stories collapse', () => {
    assert.equal(zoomLevel(20), 'large');
    assert.equal(zoomLevel(50), 'medium');
    assert.equal(zoomLevel(100), 'small');
});

test('zoomLevel: stories anchored to January are capped to small if wider than 3 months', () => {
    // startGrid <= 10 (January) AND width > 30: cap at 'small'.
    assert.equal(zoomLevel(35, 5, 50), 'small');
    assert.equal(zoomLevel(60, 5, 70), 'small');
});

test('zoomLevel: stories anchored to December are capped to small if wider than 3 months', () => {
    // endGrid >= 111 (December) AND width > 30: cap at 'small'.
    assert.equal(zoomLevel(35, 80, 115), 'small');
});

test('zoomLevel: short stories near edges still zoom large', () => {
    // width <= 30 means no edge cap kicks in.
    assert.equal(zoomLevel(20, 5, 25), 'large');
});

test('shouldPlaceBadgeBelow when story+badge overflow right edge', () => {
    // POSITION_LIMIT is 109. story=80 + badge=40 = 120 > 109.
    assert.equal(shouldPlaceBadgeBelow(80, 40, 1), true);
});

test('shouldPlaceBadgeBelow when there are 3+ items regardless of width', () => {
    assert.equal(shouldPlaceBadgeBelow(20, 20, 3), true);
    assert.equal(shouldPlaceBadgeBelow(10, 10, 5), true);
});

test('shouldPlaceBadgeBelow false for short stories with 1-2 items', () => {
    assert.equal(shouldPlaceBadgeBelow(20, 20, 1), false);
    assert.equal(shouldPlaceBadgeBelow(30, 26, 2), false);
});
