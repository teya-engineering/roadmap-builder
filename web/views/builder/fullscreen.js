import { RoadmapGenerator } from '../../roadmap-generator.js';

// Fullscreen helpers for the preview pane.
//
// showFullscreen / hideFullscreen drive the in-page #fullscreen-overlay
// (an iframe rendered without edit affordances). toggleFullscreen drives
// the browser's native fullscreen API on the .preview-panel container.
// The two paths are independent - users may use either.

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
    const panel = document.querySelector('.preview-panel');
    if (!panel) return;

    if (!document.fullscreenElement) {
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
