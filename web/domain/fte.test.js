import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFte, formatFte, formatFteTag } from './fte.js';

test('parseFte keeps unknown and zero apart', () => {
    assert.equal(parseFte(''), null);
    assert.equal(parseFte('   '), null);
    assert.equal(parseFte(null), null);
    assert.equal(parseFte(undefined), null);
    assert.equal(parseFte('0'), 0);
    assert.equal(parseFte(0), 0);
});

test('parseFte reads halves and whole numbers', () => {
    assert.equal(parseFte('1.5'), 1.5);
    assert.equal(parseFte(' 2 '), 2);
    assert.equal(parseFte(2), 2);
});

test('parseFte rejects negatives and non-numbers', () => {
    assert.equal(parseFte('-1'), null);
    assert.equal(parseFte('-0.5'), null);
    assert.equal(parseFte('two'), null);
    assert.equal(parseFte(NaN), null);
    assert.equal(parseFte(Infinity), null);
});

test('formatFte drops trailing zeros and float tails', () => {
    assert.equal(formatFte(2), '2');
    assert.equal(formatFte(1.5), '1.5');
    assert.equal(formatFte(0), '0');
    assert.equal(formatFte(0.1 + 0.2), '0.3');
});

test('formatFteTag renders the story-bar label', () => {
    assert.equal(formatFteTag(1.5), '1.5 FTE');
    assert.equal(formatFteTag(2), '2 FTE');
    assert.equal(formatFteTag(0), '0 FTE');
});
