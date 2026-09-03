// Manual save: writes the current state back to the JSON file in place
// (Chromium only) or downloads it as a file (any browser). Triggered
// explicitly from the Save dropdown.
//
// Optional auto-save: when enabled by the user via the nav toggle and a
// writable handle is available, edits are persisted to disk after a short
// debounce window. The toggle is Chromium-only - on Safari/Firefox the
// File System Access API is unavailable, so the nav doesn't render it.
//
// In-place save requires a writable file/folder handle from the File
// System Access API. Without one, save() refuses. Download builds a
// blob and triggers a browser download via <a download>; works
// everywhere and never touches a file handle.
//
// In-place write paths, in order:
//   1. Existing writable file handle (from showOpenFilePicker, the
//      file-browser side panel, or the "Save As" dialog). Silent write
//      in place.
//   2. Selected directory handle: synthesise a writable file handle via
//      dirHandle.getFileHandle(filename, {create:true}) and write. Covers
//      the new-roadmap and drag-drop cases where we have a folder but no
//      per-file handle.

import { getState } from './state.js';
import { directoryStore } from '../../app/directory-store.js';

const AUTO_SAVE_KEY = 'roadmap-autosave';
const AUTO_SAVE_DEBOUNCE_MS = 1500;

let fileHandle = null;
let dirHandle = null;
let dirKind = null; // 'native' | 'fallback' | null
let statusEl = null;
let saving = false;
let lastErrorMessage = '';

// Dirty tracker: true while the in-memory form has edits not yet written to
// disk. The router and beforeunload handler use this to prompt before
// discarding unsaved work. Cleared on successful save or fresh file load.
let dirty = false;

let autoSaveEnabled = false;
let autoSaveTimer = null;
let autoSavePrepare = null; // () => suggestedName, supplied by builder

export function isDirty() {
    return dirty;
}

export function markDirty() {
    dirty = true;
    scheduleAutoSave();
}

export function markClean() {
    dirty = false;
}

export function isAutoSaveEnabled() {
    return autoSaveEnabled;
}

export function init({ statusElement, onAutoSavePrepare }) {
    statusEl = statusElement;
    autoSavePrepare = onAutoSavePrepare || null;
    // Always start in 'idle'. 'saved' is reserved for actual save success
    // because the status setter dispatches roadmap:saved, which the builder
    // reads to fire the confetti animation.
    setStatus('idle');
    subscribeToDirectoryStore();
    initAutoSave();
}

// Attach the auto-save listeners exactly once. init() can run on every
// builder re-mount; the toggle/visibility listeners are window-scoped so
// re-attaching would silently duplicate work on each navigation.
let autoSaveListenersAttached = false;
function initAutoSave() {
    try {
        autoSaveEnabled = localStorage.getItem(AUTO_SAVE_KEY) === 'on';
    } catch {
        autoSaveEnabled = false;
    }
    if (autoSaveListenersAttached) return;
    autoSaveListenersAttached = true;

    // A custom event keeps the nav and builder views independent while the
    // setting remains available through localStorage after either view mounts.
    window.addEventListener('roadmap-autosave-changed', (e) => {
        autoSaveEnabled = !!(e && e.detail && e.detail.enabled);
        if (autoSaveEnabled && dirty) scheduleAutoSave();
        else if (!autoSaveEnabled && autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }
    });

    // Flush a pending debounce when the tab is hidden so a user who switches
    // tabs mid-edit doesn't lose work to a crash. beforeunload already prompts
    // via the dirty check in builder.js, so we don't double-handle it.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
            performAutoSave();
        }
    });
}

function scheduleAutoSave() {
    if (!autoSaveEnabled) return;
    if (!canSave()) return; // no destination yet - silent no-op
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(performAutoSave, AUTO_SAVE_DEBOUNCE_MS);
}

async function performAutoSave() {
    autoSaveTimer = null;
    if (saving) {
        // A manual save is in flight; retry after the debounce window so we
        // don't drop the auto-save.
        autoSaveTimer = setTimeout(performAutoSave, AUTO_SAVE_DEBOUNCE_MS);
        return;
    }
    if (!autoSaveEnabled || !dirty || !canSave()) return;

    let suggestedName = 'roadmap.json';
    try {
        if (typeof autoSavePrepare === 'function') {
            const name = autoSavePrepare();
            if (name) suggestedName = name;
        }
    } catch (err) {
        console.error('auto-save prepare failed:', err);
        return;
    }
    await save({ suggestedName, auto: true });
}

// Subscribe once so dirHandle and dirKind track the user's folder selection.
let directoryStoreSubscribed = false;
function subscribeToDirectoryStore() {
    if (directoryStoreSubscribed) return;
    directoryStoreSubscribed = true;
    directoryStore.subscribe((snap) => {
        const isUsable = snap && snap.handle && snap.permission !== 'denied';
        dirHandle = isUsable ? snap.handle : null;
        dirKind = isUsable ? snap.kind : null;
        // If the user picks a destination after typing edits with auto-save
        // on, the previous markDirty bailed out of scheduleAutoSave. Re-arm
        // it now that canSave() can return true.
        if (dirty && autoSaveEnabled) scheduleAutoSave();
    });
}

// True when at least one in-place save path is viable. Used by the
// "Save file" flow to decide whether to write directly or first prompt
// for a save destination.
//
// We always return true while a writable file handle is held because that
// has a backing folder (the user picked one to get the handle in the first
// place). For other cases, require a writable native directory handle.
export function canSave() {
    if (fileHandle && typeof fileHandle.createWritable === 'function') return true;
    if (dirHandle && dirKind === 'native' && typeof dirHandle.getFileHandle === 'function')
        return true;
    return false;
}

// True when this browser can save edits back to disk at all (= has the
// File System Access API). When false, "Save file" surfaces a popup
// instructing the user to use Chrome/Edge or to download instead.
export function canSaveInBrowser() {
    return directoryStore.canSaveInBrowser;
}

export function setFileHandle(handle) {
    fileHandle = handle;
    // Loading a file resets the dirty state - the form now matches the
    // bytes on disk.
    markClean();
    // 'idle', not 'saved': loading a file shouldn't fire roadmap:saved
    // (which would trigger the post-save confetti animation).
    setStatus('idle');
}

export function getFileHandle() {
    return fileHandle;
}

export function getLastError() {
    return lastErrorMessage;
}

/**
 * Save the current state.
 *
 * @param {{ suggestedName: string, auto?: boolean }} options
 *   suggestedName: filename (no path) used for path 2 (creating a file
 *                  inside the selected folder).
 *   auto: true when triggered by the auto-save scheduler. Suppresses the
 *         post-save confetti so an idle-debounce write doesn't spam the
 *         celebration animation on every keystroke pause.
 */
export async function save({ suggestedName, auto = false }) {
    if (saving) return;
    const state = getState();
    if (!state) return;

    if (!canSave()) {
        lastErrorMessage = canSaveInBrowser()
            ? 'pick a folder via "Load roadmaps" first'
            : 'this browser cannot save back to disk; use Chrome or Edge';
        setStatus('error');
        return;
    }

    saving = true;
    setStatus('saving');
    lastErrorMessage = '';
    try {
        const json = JSON.stringify(
            {
                version: '1.0',
                created: new Date().toISOString(),
                teamData: state,
            },
            null,
            2
        );

        // Path 1: existing writable file handle.
        if (fileHandle && typeof fileHandle.createWritable === 'function') {
            const writable = await fileHandle.createWritable();
            await writable.write(json);
            await writable.close();
            setStatus('saved', { auto });
            return;
        }
        // Stale handle: drop it.
        fileHandle = null;

        // Path 2: selected directory handle. Synthesise a writable file handle
        // for `suggestedName` inside the picked folder.
        if (dirHandle && dirKind === 'native' && typeof dirHandle.getFileHandle === 'function') {
            const fh = await dirHandle.getFileHandle(suggestedName, { create: true });
            const writable = await fh.createWritable();
            await writable.write(json);
            await writable.close();
            // Keep the handle around so subsequent saves take path 1 directly.
            fileHandle = fh;
            setStatus('saved', { auto });
            return;
        }

        throw new Error('no writable handle available');
    } catch (err) {
        if (err && err.name === 'AbortError') {
            setStatus(fileHandle ? 'saved' : 'idle');
            return;
        }
        console.error('save failed:', err);
        lastErrorMessage = err && err.message ? err.message : String(err);
        setStatus('error');
    } finally {
        saving = false;
    }
}

/**
 * Trigger a browser download of the current state as a JSON file. Works
 * in every browser; nothing is written to disk via the File System Access
 * API, so this also covers the Safari/Firefox path.
 *
 * @param {{ suggestedName: string }} options
 */
export function download({ suggestedName }) {
    const state = getState();
    if (!state) return;
    const json = JSON.stringify(
        {
            version: '1.0',
            created: new Date().toISOString(),
            teamData: state,
        },
        null,
        2
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName || 'roadmap.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus('saved');
}

function setStatus(kind, { auto = false } = {}) {
    if (kind === 'saved') {
        markClean();
    }
    if (statusEl) {
        // 'saved' is communicated by the button animation + confetti, not text.
        const messages = {
            idle: '',
            saving: 'Saving...',
            saved: '',
            error: lastErrorMessage ? `Save failed: ${lastErrorMessage}` : 'Save failed',
        };
        statusEl.dataset.status = kind;
        statusEl.textContent = messages[kind] ?? '';
        statusEl.title = kind === 'error' && lastErrorMessage ? lastErrorMessage : '';
    }
    if (kind === 'saved') {
        // Fire after the current call so listeners can read DOM positions
        // (button rect for confetti origin) without timing fragility.
        // detail.auto lets the builder skip confetti for debounced auto-saves.
        document.dispatchEvent(new CustomEvent('roadmap:saved', { detail: { auto } }));
    }
}
