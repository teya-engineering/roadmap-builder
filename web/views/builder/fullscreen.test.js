import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const styles = new Map();
const controls = {
    'fullscreen-zoom-out': { disabled: false },
    'fullscreen-zoom-reset': { textContent: '' },
    'fullscreen-zoom-in': { disabled: false },
};
const panel = {
    style: {
        setProperty(name, value) {
            styles.set(name, value);
        },
    },
    querySelector() {
        return null;
    },
};

const testDocument = {
    fullscreenElement: /** @type {typeof panel | null} */ (panel),
    querySelector(selector) {
        return selector === '.preview-panel' ? panel : null;
    },
    getElementById(id) {
        return controls[id] || null;
    },
    addEventListener() {},
};
globalThis.document = /** @type {Document} */ (/** @type {unknown} */ (testDocument));

const { handleFullscreenZoomShortcut, handleFullscreenZoomWheel, resetFullscreenZoom, zoomIn } =
    await import('./fullscreen.js');

function createEvent(overrides) {
    return {
        key: '',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        deltaY: 0,
        prevented: false,
        preventDefault() {
            this.prevented = true;
        },
        ...overrides,
    };
}

beforeEach(() => {
    testDocument.fullscreenElement = panel;
    resetFullscreenZoom();
});

test('fullscreen browser zoom shortcuts change the roadmap zoom', () => {
    const zoomInEvent = createEvent({ key: '=', metaKey: true });
    assert.equal(handleFullscreenZoomShortcut(zoomInEvent), true);
    assert.equal(zoomInEvent.prevented, true);
    assert.equal(styles.get('--fullscreen-roadmap-zoom'), '1.1');
    assert.equal(controls['fullscreen-zoom-reset'].textContent, '110%');

    const resetEvent = createEvent({ key: '0', metaKey: true });
    assert.equal(handleFullscreenZoomShortcut(resetEvent), true);
    assert.equal(styles.get('--fullscreen-roadmap-zoom'), '1');
    assert.equal(controls['fullscreen-zoom-reset'].textContent, '100%');
});

test('zoom shortcuts remain available with Ctrl and alternate key values', () => {
    const zoomInEvent = createEvent({ key: '+', ctrlKey: true });
    handleFullscreenZoomShortcut(zoomInEvent);

    const zoomOutEvent = createEvent({ key: '_', ctrlKey: true });
    assert.equal(handleFullscreenZoomShortcut(zoomOutEvent), true);
    assert.equal(styles.get('--fullscreen-roadmap-zoom'), '1');
});

test('zoom shortcuts do not replace browser zoom outside preview fullscreen', () => {
    testDocument.fullscreenElement = null;
    const event = createEvent({ key: '+', metaKey: true });

    assert.equal(handleFullscreenZoomShortcut(event), false);
    assert.equal(event.prevented, false);
    assert.equal(styles.get('--fullscreen-roadmap-zoom'), '1');
});

test('modified wheel gestures accumulate before changing zoom', () => {
    const firstEvent = createEvent({ ctrlKey: true, deltaY: -30 });
    assert.equal(handleFullscreenZoomWheel(firstEvent), true);
    assert.equal(firstEvent.prevented, true);
    assert.equal(styles.get('--fullscreen-roadmap-zoom'), '1');

    const secondEvent = createEvent({ ctrlKey: true, deltaY: -30 });
    assert.equal(handleFullscreenZoomWheel(secondEvent), true);
    assert.equal(styles.get('--fullscreen-roadmap-zoom'), '1.1');
});

test('zoom controls stop at 200 percent', () => {
    for (let i = 0; i < 20; i++) zoomIn();

    assert.equal(styles.get('--fullscreen-roadmap-zoom'), '2');
    assert.equal(controls['fullscreen-zoom-in'].disabled, true);
    assert.equal(controls['fullscreen-zoom-reset'].textContent, '200%');
});
