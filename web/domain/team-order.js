// Team swimlane order in cross-team search results.
//
// The user drags teams into the order they want and it is remembered as a
// plain list of team names. A search only shows some teams, so the saved list
// also holds teams that aren't on screen, and teams never ordered before fall
// back to alphabetical after the ones that were. No DOM/window access so it
// stays unit-testable under `node --test`.

/**
 * Sort team names by the saved order, putting unknown teams last, A-Z.
 *
 * @param {string[]} teamNames
 * @param {string[]} savedOrder
 * @returns {string[]}
 */
export function orderTeamNames(teamNames, savedOrder = []) {
    const rank = new Map(savedOrder.map((name, index) => [name, index]));
    return [...teamNames].sort((a, b) => {
        const rankA = rank.has(a) ? rank.get(a) : Infinity;
        const rankB = rank.has(b) ? rank.get(b) : Infinity;
        if (rankA !== rankB) return rankA - rankB;
        return a.localeCompare(b);
    });
}

/**
 * Move one team before or after another in the visible order.
 *
 * @param {string[]} visibleOrder
 * @param {string} dragged
 * @param {string} target
 * @param {'before' | 'after'} placement
 * @returns {string[]}
 */
export function moveTeam(visibleOrder, dragged, target, placement) {
    if (dragged === target || !visibleOrder.includes(dragged) || !visibleOrder.includes(target)) {
        return [...visibleOrder];
    }
    const result = visibleOrder.filter((name) => name !== dragged);
    const targetIndex = result.indexOf(target);
    result.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, dragged);
    return result;
}

/**
 * Fold a reordered set of visible teams back into the saved order. Visible
 * teams take the slots visible teams held before, so teams hidden by the
 * current search keep their place.
 *
 * @param {string[]} savedOrder
 * @param {string[]} visibleOrder - every visible team, in its new order
 * @returns {string[]}
 */
export function mergeTeamOrder(savedOrder, visibleOrder) {
    const visible = new Set(visibleOrder);
    const known = orderTeamNames([...new Set([...savedOrder, ...visibleOrder])], savedOrder);
    const queue = [...visibleOrder];
    return known.map((name) => (visible.has(name) ? queue.shift() : name));
}
