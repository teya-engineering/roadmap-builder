import { test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// slack-notify.js reaches for a few browser globals (document, fetch) that
// don't exist under `node --test`. Stub them before importing the module so
// init() can wire its listeners. structuredClone is already a Node global.
const savedHandlers = {};
globalThis.document = {
    addEventListener(type, fn) {
        savedHandlers[type] = fn;
    },
};
let fetchMock;

const { init } = await import('./slack-notify.js');
const state = await import('./state.js');

// Fire the captured roadmap:saved handler the way the save module would.
function fireSave({ auto }) {
    savedHandlers['roadmap:saved']({ detail: { auto } });
}

// Fire the captured roadmap:loaded handler the way builder.js does once a
// roadmap finishes loading. This is what resets the notifier baseline.
function fireLoad() {
    savedHandlers['roadmap:loaded']();
}

function lastPostedText() {
    const calls = fetchMock.mock.calls;
    if (calls.length === 0) return null;
    return JSON.parse(calls[calls.length - 1].arguments[1].body).text;
}

function makeTeam(over = {}) {
    return {
        teamName: 'Product Team',
        em: 'John Citizen',
        pm: 'Jane Doe',
        epics: [
            {
                name: 'E1',
                epicId: 'e1',
                stories: [
                    {
                        title: 'Important Project Name',
                        storyId: 's1',
                        startDate: '01/01/26',
                        endDate: '15/05/26',
                        isAtRisk: false,
                        isDone: false,
                        isCancelled: false,
                        isNewStory: false,
                        isProposed: false,
                        isTransferredIn: false,
                        isTransferredOut: false,
                        roadmapChanges: { changes: [] },
                    },
                ],
            },
        ],
        ...over,
    };
}

// Move story s1's end date. The real app re-collects the form and calls
// setState (kind 'replace') on every edit, so simulate edits that way — this
// also guards the regression where 'replace' was wrongly treated as a baseline
// reset, making every diff empty.
function moveEndDate(to) {
    const next = structuredClone(state.getState());
    next.epics[0].stories[0].endDate = to;
    state.setState(next);
}

before(() => {
    fetchMock = mock.fn(async () => ({ ok: true }));
    globalThis.fetch = fetchMock;
    init();
});

beforeEach(() => {
    fetchMock.mock.resetCalls();
    // Simulate loading a roadmap: state is synced, then builder.js fires
    // roadmap:loaded, which is what resets the notifier baseline.
    state.setState(makeTeam());
    fireLoad();
});

test('manual save posts a summary of the diff', () => {
    moveEndDate('30/05/26');
    fireSave({ auto: false });

    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, '/api/roadmap-saved');
    assert.equal(opts.method, 'POST');
    const text = JSON.parse(opts.body).text;
    assert.match(text, /Roadmap Update — Product Team/);
    assert.match(text, /End date moved {2}15 May {2}→ {2}30 May/);
    assert.match(text, /John Citizen {2}· {2}Jane Doe/);
});

test('no changes since baseline -> no post', () => {
    fireSave({ auto: false });
    assert.equal(fetchMock.mock.calls.length, 0);
});

test('auto-saves are coalesced into one post after the window', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    moveEndDate('20/05/26');
    fireSave({ auto: true });
    assert.equal(fetchMock.mock.calls.length, 0, 'nothing sent immediately');

    moveEndDate('30/05/26');
    fireSave({ auto: true });
    assert.equal(fetchMock.mock.calls.length, 0, 'still coalescing');

    t.mock.timers.tick(5 * 60 * 1000);
    assert.equal(fetchMock.mock.calls.length, 1, 'one post after the window');
    // Diff is baseline -> latest, so intermediate edits collapse.
    assert.match(lastPostedText(), /End date moved {2}15 May {2}→ {2}30 May/);
});

test('manual save flushes immediately and cancels a pending coalesce timer', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    moveEndDate('20/05/26');
    fireSave({ auto: true }); // arms the coalesce timer
    assert.equal(fetchMock.mock.calls.length, 0);

    moveEndDate('30/05/26');
    fireSave({ auto: false }); // manual -> flush now
    assert.equal(fetchMock.mock.calls.length, 1);

    t.mock.timers.tick(5 * 60 * 1000); // the cancelled timer must not re-fire
    assert.equal(fetchMock.mock.calls.length, 1);
});

test('delivery failure is swallowed and the baseline still advances', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    fetchMock.mock.mockImplementationOnce(async () => {
        throw new Error('network down');
    });

    moveEndDate('30/05/26');
    fireSave({ auto: false });
    // Let the awaited fetch rejection settle into the catch block.
    await new Promise((r) => setImmediate(r));

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.ok(warn.mock.calls.length >= 1, 'failure is logged, not thrown');

    // Baseline advanced despite the failure: a re-save with no further change
    // produces no new post (the failed change is not re-reported).
    fireSave({ auto: false });
    assert.equal(fetchMock.mock.calls.length, 1);
});
