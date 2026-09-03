// Owns the selected roadmap folder so the Builder and Cross-team Search views
// read from the same state.
//
// Two backends:
//   - Real FileSystemDirectoryHandle / FileSystemFileHandle (Chromium, Edge).
//     Persisted via IndexedDB across reloads; permission must be re-granted
//     each session via a user gesture. Supports read AND in-place save.
//   - Read-only fallback (Safari, Firefox) via <input type=file>. Files are
//     loaded into memory; the app cannot save back to disk in this mode.
const DB_NAME = 'roadmap-builder';
const DB_VERSION = 1;
const STORE = 'kv';
const HANDLE_KEY = 'dirHandle';

const listeners = new Set();
let state = {
    handle: null, // FileSystemDirectoryHandle | FileSystemFileHandle | read-only synthesized handle | null
    name: null, // folder/file name (string)
    permission: 'prompt', // 'granted' | 'prompt' | 'denied'
    kind: null, // 'native' | 'fallback'
    type: null, // 'folder' | 'file'
};

const browserWindow = /** @type {Window & {
    showDirectoryPicker?: () => Promise<any>,
    showOpenFilePicker?: (options?: any) => Promise<any[]>,
    showSaveFilePicker?: (options?: any) => Promise<any>
}} */ (typeof window === 'undefined' ? {} : window);

const showDirectoryPicker = browserWindow.showDirectoryPicker?.bind(browserWindow);
const showOpenFilePicker = browserWindow.showOpenFilePicker?.bind(browserWindow);
const showSaveFilePicker = browserWindow.showSaveFilePicker?.bind(browserWindow);
const hasNativePicker = Boolean(showDirectoryPicker);
// True when this browser can save edits back to disk. Used by the UI
// to surface a "browser doesn't support saving" hint instead of the
// generic "pick a folder first" tooltip.
const canSaveInBrowser = Boolean(showSaveFilePicker);

// ---- IndexedDB helpers (small, promise-wrapped) ----------------------

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
}

async function idbPut(key, value) {
    const db = await openDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

async function idbDelete(key) {
    const db = await openDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

// ---- State + notifications ------------------------------------------

function snapshot() {
    return {
        handle: state.handle,
        name: state.name,
        permission: state.permission,
        kind: state.kind,
        type: state.type,
    };
}

function setState(patch) {
    state = { ...state, ...patch };
    const snap = snapshot();
    for (const cb of listeners) {
        try {
            cb(snap);
        } catch (error) {
            console.error('Directory store subscriber failed', error);
        }
    }
}

// ---- Permission helpers ---------------------------------------------

async function queryPermission(handle) {
    if (!handle || typeof handle.queryPermission !== 'function') return 'granted';
    try {
        return await handle.queryPermission({ mode: 'read' });
    } catch {
        return 'prompt';
    }
}

async function requestPermission(handle) {
    if (!handle || typeof handle.requestPermission !== 'function') return 'granted';
    try {
        return await handle.requestPermission({ mode: 'read' });
    } catch {
        return 'denied';
    }
}

// ---- Read-only fallback (browsers without File System Access API) ---
//
// Safari and Firefox don't expose showDirectoryPicker / showOpenFilePicker,
// so the user can load roadmaps via <input type=file> but the app cannot
// write back in place. We synthesise a directory/file handle that mimics
// the parts of the Chromium API the rest of the code uses (entries(),
// getFile()) but never returns a writable.

// Open a hidden <input type=file webkitdirectory> and resolve with the
// selected files (or null on cancel). webkitdirectory works in Safari
// and Firefox despite the prefix.
function pickFolderViaInput() {
    return new Promise((resolveFiles) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        input.style.display = 'none';
        const cleanup = () => input.remove();
        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            cleanup();
            resolveFiles(files.length ? files : null);
        });
        input.addEventListener('cancel', () => {
            cleanup();
            resolveFiles(null);
        });
        document.body.appendChild(input);
        input.click();
    });
}

function pickFileViaInput() {
    return new Promise((resolveFile) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        const cleanup = () => input.remove();
        input.addEventListener('change', () => {
            const file = input.files && input.files[0] ? input.files[0] : null;
            cleanup();
            resolveFile(file);
        });
        input.addEventListener('cancel', () => {
            cleanup();
            resolveFile(null);
        });
        document.body.appendChild(input);
        input.click();
    });
}

// Build a directory-handle-like object backed by an in-memory list of
// File objects. Only entries directly inside the picked folder are
// exposed; nested subfolders are filtered out to match the Chromium
// showDirectoryPicker behaviour the file-browser side panel expects.
function makeReadOnlyFolderHandle(files, name) {
    const topLevel = files.filter((f) => {
        const segs = (f.webkitRelativePath || f.name).split('/');
        return segs.length === 2; // <folder>/<filename>
    });
    return {
        kind: 'directory',
        name,
        __readOnly: true,
        entries: async function* () {
            for (const file of topLevel) {
                yield [
                    file.name,
                    {
                        kind: 'file',
                        name: file.name,
                        getFile: async () => file,
                    },
                ];
            }
        },
    };
}

// ---- Public API -----------------------------------------------------

async function select() {
    if (showDirectoryPicker) {
        try {
            const handle = await showDirectoryPicker();
            await idbPut(HANDLE_KEY, handle).catch(() => {
                /* persistence best-effort */
            });
            setState({
                handle,
                name: handle.name,
                permission: 'granted',
                kind: 'native',
                type: 'folder',
            });
            return snapshot();
        } catch (err) {
            if (err && err.name === 'AbortError') return snapshot();
            console.warn('showDirectoryPicker failed, falling back', err);
        }
    }
    const files = await pickFolderViaInput();
    if (!files || !files.length) return snapshot();
    const folderName = (files[0].webkitRelativePath || '').split('/')[0] || 'folder';
    const handle = makeReadOnlyFolderHandle(files, folderName);
    setState({
        handle,
        name: folderName,
        permission: 'granted',
        kind: 'fallback',
        type: 'folder',
    });
    return snapshot();
}

// Pick a single .json file. On Chromium uses showOpenFilePicker which
// returns a writable file handle; on other browsers falls back to a
// hidden <input type=file> which can read the contents but cannot
// write back. Returns { content, name, fileHandle? } so the caller can
// populate the editor without an extra read.
async function selectFile() {
    if (showOpenFilePicker) {
        try {
            const [fh] = await showOpenFilePicker({
                multiple: false,
                types: [{ description: 'Roadmap JSON', accept: { 'application/json': ['.json'] } }],
            });
            const file = await fh.getFile();
            const content = await file.text();
            setState({
                handle: fh,
                name: file.name,
                permission: 'granted',
                kind: 'native',
                type: 'file',
            });
            idbDelete(HANDLE_KEY).catch(() => {});
            return { content, name: file.name, fileHandle: fh };
        } catch (err) {
            if (err && err.name === 'AbortError') return null;
            console.warn('showOpenFilePicker failed, falling back', err);
        }
    }
    const file = await pickFileViaInput();
    if (!file) return null;
    const content = await file.text();
    const handle = {
        kind: 'file',
        name: file.name,
        __readOnly: true,
        getFile: async () => file,
    };
    setState({
        handle,
        name: file.name,
        permission: 'granted',
        kind: 'fallback',
        type: 'file',
    });
    return { content, name: file.name, fileHandle: null };
}

// Pick a save destination for a brand-new roadmap (i.e. a "Save As"
// dialog). Only available in Chromium browsers - in Safari/Firefox we
// cannot create a writable handle, so this resolves to null and the
// caller is expected to handle the read-only state via canSaveInBrowser.
async function selectSaveLocation(suggestedName) {
    if (!showSaveFilePicker) return null;
    try {
        const fh = await showSaveFilePicker({
            suggestedName: suggestedName || 'roadmap.json',
            types: [{ description: 'Roadmap JSON', accept: { 'application/json': ['.json'] } }],
        });
        const name = fh.name || suggestedName || 'roadmap.json';
        setState({
            handle: fh,
            name,
            permission: 'granted',
            kind: 'native',
            type: 'file',
        });
        idbDelete(HANDLE_KEY).catch(() => {});
        return { fileHandle: fh, name };
    } catch (err) {
        if (err && err.name === 'AbortError') return null;
        console.warn('showSaveFilePicker failed', err);
        return null;
    }
}

// Request read permission on the current handle (must be called from a user gesture).
async function requestAccess() {
    if (!state.handle || state.kind !== 'native') return snapshot();
    const perm = await requestPermission(state.handle);
    setState({ permission: perm });
    return snapshot();
}

async function clear() {
    await idbDelete(HANDLE_KEY).catch(() => {});
    setState({ handle: null, name: null, permission: 'prompt', kind: null, type: null });
}

function get() {
    return snapshot();
}

function subscribe(cb) {
    listeners.add(cb);
    try {
        cb(snapshot());
    } catch (e) {
        console.error(e);
    }
    return () => listeners.delete(cb);
}

// ---- Boot: restore from IndexedDB without triggering a prompt --------

async function init() {
    if (!hasNativePicker) return; // fallback-only: nothing to restore
    let handle = null;
    try {
        handle = await idbGet(HANDLE_KEY);
    } catch {
        /* ignore */
    }
    if (!handle) return;
    const perm = await queryPermission(handle);
    setState({ handle, name: handle.name, permission: perm, kind: 'native', type: 'folder' });
}

export const directoryStore = Object.freeze({
    select,
    selectFile,
    selectSaveLocation,
    requestAccess,
    clear,
    get,
    subscribe,
    hasNativePicker,
    canSaveInBrowser,
});

void init();
