import test from 'node:test';
import assert from 'node:assert/strict';

import { orderTeamNames, moveTeam, mergeTeamOrder } from './team-order.js';

test('orderTeamNames is alphabetical without a saved order', () => {
    assert.deepEqual(orderTeamNames(['Gamma', 'Alpha', 'Beta']), ['Alpha', 'Beta', 'Gamma']);
});

test('orderTeamNames follows the saved order and puts unknown teams last, A-Z', () => {
    assert.deepEqual(
        orderTeamNames(['Alpha', 'Delta', 'Beta', 'Gamma'], ['Gamma', 'Missing', 'Alpha']),
        ['Gamma', 'Alpha', 'Beta', 'Delta']
    );
});

test('moveTeam places the dragged team before or after the target', () => {
    const order = ['A', 'B', 'C', 'D'];
    assert.deepEqual(moveTeam(order, 'D', 'B', 'before'), ['A', 'D', 'B', 'C']);
    assert.deepEqual(moveTeam(order, 'A', 'C', 'after'), ['B', 'C', 'A', 'D']);
    assert.deepEqual(moveTeam(order, 'B', 'B', 'after'), order);
    assert.deepEqual(moveTeam(order, 'X', 'B', 'after'), order);
});

test('mergeTeamOrder keeps hidden teams in place', () => {
    // Saved: A B C D E. The search shows B and D, and the user puts D first.
    assert.deepEqual(mergeTeamOrder(['A', 'B', 'C', 'D', 'E'], ['D', 'B']), [
        'A',
        'D',
        'C',
        'B',
        'E',
    ]);
});

test('mergeTeamOrder adds teams that were never ordered', () => {
    assert.deepEqual(mergeTeamOrder(['A', 'B'], ['C', 'A']), ['C', 'B', 'A']);
    assert.deepEqual(mergeTeamOrder([], ['B', 'A']), ['B', 'A']);
});
