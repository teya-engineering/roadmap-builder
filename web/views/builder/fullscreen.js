import { RoadmapGenerator } from '../../roadmap-generator.js';

// Chrome sends browser zoom input to the page while an element is fullscreen,
// so the preview owns zoom until it leaves fullscreen.
const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const DEFAULT_ZOOM_INDEX = ZOOM_LEVELS.indexOf(1);
const WHEEL_ZOOM_THRESHOLD = 50;

let zoomIndex = DEFAULT_ZOOM_INDEX;
let wheelDelta = 0;
let fullscreenZoomInitialized = false;

/** @returns {HTMLElement | null} */
function getPreviewPanel() {
    return /** @type {HTMLElement | null} */ (document.querySelector('.preview-panel'));
}

function getFullscreenElement() {
    const legacyDocument = /** @type {Document & {
     *   webkitFullscreenElement?: Element,
     *   mozFullScreenElement?: Element,
     *   msFullscreenElement?: Element
     * }} */ (document);
    return (
        legacyDocument.fullscreenElement ||
        legacyDocument.webkitFullscreenElement ||
        legacyDocument.mozFullScreenElement ||
        legacyDocument.msFullscreenElement
    );
}

function isPreviewFullscreen(panel = getPreviewPanel()) {
    return Boolean(panel && getFullscreenElement() === panel);
}

function applyZoom() {
    const panel = getPreviewPanel();
    if (!panel) return;

    const zoom = ZOOM_LEVELS[zoomIndex];
    panel.style.setProperty('--fullscreen-roadmap-zoom', String(zoom));

    const resetButton = document.getElementById('fullscreen-zoom-reset');
    if (resetButton) resetButton.textContent = `${Math.round(zoom * 100)}%`;

    const zoomOutButton = /** @type {HTMLButtonElement | null} */ (
        document.getElementById('fullscreen-zoom-out')
    );
    if (zoomOutButton) zoomOutButton.disabled = zoomIndex === 0;

    const zoomInButton = /** @type {HTMLButtonElement | null} */ (
        document.getElementById('fullscreen-zoom-in')
    );
    if (zoomInButton) zoomInButton.disabled = zoomIndex === ZOOM_LEVELS.length - 1;
}

export function zoomIn() {
    zoomIndex = Math.min(zoomIndex + 1, ZOOM_LEVELS.length - 1);
    applyZoom();
}

export function zoomOut() {
    zoomIndex = Math.max(zoomIndex - 1, 0);
    applyZoom();
}

export function resetFullscreenZoom() {
    zoomIndex = DEFAULT_ZOOM_INDEX;
    wheelDelta = 0;
    applyZoom();
}

export function handleFullscreenZoomShortcut(event) {
    if (!isPreviewFullscreen() || !(event.metaKey || event.ctrlKey) || event.altKey) {
        return false;
    }

    if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomIn();
        return true;
    }

    if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomOut();
        return true;
    }

    if (event.key === '0') {
        event.preventDefault();
        resetFullscreenZoom();
        return true;
    }

    return false;
}

export function handleFullscreenZoomWheel(event) {
    if (!isPreviewFullscreen() || !(event.metaKey || event.ctrlKey) || event.deltaY === 0) {
        return false;
    }

    event.preventDefault();

    if (wheelDelta !== 0 && Math.sign(wheelDelta) !== Math.sign(event.deltaY)) {
        wheelDelta = 0;
    }
    wheelDelta += event.deltaY;

    if (Math.abs(wheelDelta) < WHEEL_ZOOM_THRESHOLD) return true;

    if (wheelDelta < 0) zoomIn();
    else zoomOut();
    wheelDelta = 0;
    return true;
}

function handleFullscreenChange() {
    const panel = getPreviewPanel();
    const button = /** @type {HTMLButtonElement | null | undefined} */ (
        panel?.querySelector('.fullscreen-button')
    );
    const fullscreen = isPreviewFullscreen(panel);

    if (button) {
        const label = fullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
        button.title = label;
        button.setAttribute('aria-label', label);
    }

    if (!fullscreen) resetFullscreenZoom();
}

export function initFullscreenZoom() {
    if (fullscreenZoomInitialized) return;
    fullscreenZoomInitialized = true;

    document.addEventListener('keydown', handleFullscreenZoomShortcut);
    document.addEventListener('wheel', handleFullscreenZoomWheel, { passive: false });
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    applyZoom();
}

/**
 * Render the current team data into the fullscreen overlay iframe and show
 * the overlay. The form load flow keeps the latest team data on window for
 * preview features that live outside the form module.
 */
export function showFullscreen() {
    if (window.currentTeamData) {
        const generator = new RoadmapGenerator(window.currentTeamData.roadmapYear);
        // generateRoadmap(teamData, embedded=false, enableEditing=false) -> read-only fullscreen render.
        const html = generator.generateRoadmap(window.currentTeamData, false, false);
        const iframe = document.getElementById('fullscreen-preview');
        if (iframe) iframe.srcdoc = html;
    }

    const overlay = document.getElementById('fullscreen-overlay');
    if (overlay) overlay.style.display = 'flex';
    // Prevent the page underneath from scrolling while the overlay is up.
    document.body.style.overflow = 'hidden';
}

export function hideFullscreen() {
    const overlay = document.getElementById('fullscreen-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = 'auto';
}

/**
 * Toggle the browser's native fullscreen on the preview panel. Vendor prefixes
 * cover legacy Safari/Firefox/IE; the unprefixed API works in current Chrome
 * and Edge. We keep all four to match the original behavior.
 */
export function toggleFullscreen() {
    const panel = getPreviewPanel();
    if (!panel) return;

    if (!getFullscreenElement()) {
        const enter =
            panel.requestFullscreen ||
            panel.mozRequestFullScreen ||
            panel.webkitRequestFullscreen ||
            panel.msRequestFullscreen;
        if (enter) enter.call(panel);
    } else {
        const exit =
            document.exitFullscreen ||
            document.mozCancelFullScreen ||
            document.webkitExitFullscreen ||
            document.msExitFullscreen;
        if (exit) exit.call(document);
    }
}
