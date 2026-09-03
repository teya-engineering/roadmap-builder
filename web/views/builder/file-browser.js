// File browser side panel, drag-drop loading, and directory subscription.
//
// Responsibilities:
//   - Expand/collapse the .file-browser-panel side panel.
//   - List .json roadmap files from the selected folder, with team
//     name and size metadata.
//   - Open a file from the list (loadTeamData + refresh + preview).
//   - Accept a roadmap file via drag-drop onto the builder panel itself.
//
// State: selectedDirectoryHandle is owned by this module and synced from
// the shared directory store via the subscription set up in init().

import { directoryStore } from '../../app/directory-store.js';

/**
 * @param {object} deps
 * @param {(teamData: any) => void} deps.loadTeamData
 * @param {(name: string) => void} deps.updateFilenameDisplay
 * @param {() => void} deps.refreshAllDatePickers
 * @param {() => void} deps.generatePreview
 * @param {(syntheticEvent: any) => void} deps.handleFileLoad
 *        Called from the drag-drop path with a synthesized change event.
 * @param {(handle: FileSystemFileHandle | null) => void} [deps.setFileHandle]
 *        Optional. Called with the FileSystemFileHandle when a file is
 *        opened from the directory list, so the v2 Save button can write
 *        back to it without re-prompting.
 */
export function createFileBrowser({
    loadTeamData,
    updateFilenameDisplay,
    refreshAllDatePickers,
    generatePreview,
    handleFileLoad,
    setFileHandle,
}) {
    let selectedDirectoryHandle = null;

    function toggleFileBrowser() {
        const panel = document.getElementById('fileBrowserPanel');
        const toggle = document.getElementById('fileBrowserToggle');
        const expandBtn = document.getElementById('expandFileBrowserBtn');
        if (!panel || !toggle || !expandBtn) return;

        if (panel.classList.contains('collapsed')) {
            panel.classList.remove('collapsed');
            toggle.textContent = '×';
            expandBtn.classList.remove('visible');
        } else {
            panel.classList.add('collapsed');
            toggle.textContent = '×';
            expandBtn.classList.add('visible');
        }
    }

    function updateFileBrowserButtonVisibility() {
        const panel = document.getElementById('fileBrowserPanel');
        const expandBtn = document.getElementById('expandFileBrowserBtn');
        if (!panel || !expandBtn) return;
        if (panel.classList.contains('collapsed')) expandBtn.classList.add('visible');
        else expandBtn.classList.remove('visible');
    }

    // Folder picker is owned by the top nav; this is a back-compat shim
    // for any legacy caller that still invokes selectDirectory() directly.
    async function selectDirectory() {
        await directoryStore.select();
    }

    async function loadDirectoryFiles() {
        const fileList = document.getElementById('fileList');
        if (!fileList) return;
        fileList.innerHTML = '';

        const reminder = document.querySelector('.directory-reminder');
        if (reminder) reminder.remove();

        if (!selectedDirectoryHandle) {
            fileList.innerHTML =
                '<div class="no-directory-message">Pick a folder from the top bar to browse your roadmap files</div>';
            return;
        }

        try {
            const roadmapFiles = [];
            for await (const [name, handle] of selectedDirectoryHandle.entries()) {
                if (handle.kind !== 'file') continue;
                if (!name.toLowerCase().endsWith('.json')) continue;
                try {
                    const file = await handle.getFile();
                    let teamName = 'Unknown Team';
                    const content = await file.text().catch(() => null);
                    if (content) {
                        try {
                            teamName = JSON.parse(content).teamData?.teamName || 'Unknown Team';
                        } catch {
                            teamName = 'Invalid JSON';
                        }
                    }
                    roadmapFiles.push({
                        name,
                        handle,
                        teamName,
                        size: file.size,
                        lastModified: file.lastModified,
                        fileType: 'json',
                    });
                } catch (error) {
                    console.warn(`Could not read roadmap file ${name}:`, error);
                }
            }

            roadmapFiles.sort((a, b) => a.name.localeCompare(b.name));

            if (roadmapFiles.length === 0) {
                fileList.innerHTML =
                    '<div class="no-directory-message">No roadmap (.json) files found in this folder</div>';
                return;
            }

            for (const fileInfo of roadmapFiles) {
                const item = document.createElement('div');
                item.className = 'file-item';
                item.onclick = () => openRoadmapFile(fileInfo.handle, fileInfo.fileType);
                const modified = new Date(fileInfo.lastModified).toLocaleDateString('en-GB');
                item.title = `${fileInfo.name}\nType: JSON\nTeam: ${fileInfo.teamName}\nSize: ${(fileInfo.size / 1024).toFixed(1)} KB\nModified: ${modified}`;
                item.innerHTML = `
                    <div class="file-item-icon">📋</div>
                    <div class="file-item-info">
                        <div class="file-item-name">${fileInfo.name}</div>
                    </div>
                `;
                fileList.appendChild(item);
            }
        } catch (error) {
            console.error('Error loading directory files:', error);
            fileList.innerHTML =
                '<div class="no-directory-message">Error loading files: ' +
                error.message +
                '</div>';
        }
    }

    async function openRoadmapFile(fileHandle, fileType) {
        try {
            // Accept either a FileSystemFileHandle or a raw File (polyfill case).
            const isHandle = fileHandle && typeof fileHandle.getFile === 'function';
            const file = isHandle ? await fileHandle.getFile() : fileHandle;

            if (fileType !== 'json') return;

            const roadmapData = JSON.parse(await file.text());
            // Files saved post-format-bump have a .teamData wrapper; older ones
            // have the team data at the root.
            const teamData = roadmapData.teamData || roadmapData;

            loadTeamData(teamData);
            updateFilenameDisplay(file.name);

            // Hand the writable handle to the save module so the Save button
            // can write back to this exact file without re-prompting. The
            // polyfill (no native showDirectoryPicker) hands us a fake handle
            // that has getFile but no createWritable - we only forward real
            // ones so Save's first click prompts via showSaveFilePicker
            // instead of failing.
            const isWritable = isHandle && typeof fileHandle.createWritable === 'function';
            if (setFileHandle) setFileHandle(isWritable ? fileHandle : null);

            // The form load is largely synchronous but date pickers and preview
            // depend on DOM that just got swapped, so wait a tick before refreshing.
            setTimeout(() => {
                refreshAllDatePickers();
                generatePreview();
            }, 500);
        } catch (error) {
            console.error('Error opening roadmap file:', error);
            alert('Error opening roadmap file: ' + error.message);
        }
    }

    function handleFileDrop(e) {
        const files = e.dataTransfer.files;
        if (files.length === 0) return;

        const file = files[0];
        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.json')) {
            alert('Unsupported file type. Please drop a .json file.');
            return;
        }

        // handleFileLoad expects a change event shape; we synthesize one so we
        // can reuse the same load pipeline as the file picker.
        try {
            handleFileLoad({ target: { files: [file], value: '' } });
        } catch (error) {
            console.error('Error handling dropped JSON file:', error);
            alert('Error loading JSON file: ' + error.message);
        }
    }

    function initializeDragAndDrop() {
        const builderPanel = document.querySelector('.builder-panel');
        if (!builderPanel) {
            console.warn('Builder panel not found');
            return;
        }

        builderPanel.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                builderPanel.classList.add('drag-over');
            }
        });

        builderPanel.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        builderPanel.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Only drop the highlight if we left the panel entirely (children
            // generate dragleave events too).
            if (!builderPanel.contains(e.relatedTarget)) {
                builderPanel.classList.remove('drag-over');
            }
        });

        builderPanel.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            builderPanel.classList.remove('drag-over');
            handleFileDrop(e);
        });
    }

    /**
     * Subscribe to the shared directory store. The router uses the returned
     * function to unsubscribe when this view is replaced.
     */
    function subscribeToDirectoryStore() {
        let lastHandle = null;
        return directoryStore.subscribe(async (snap) => {
            const fileList = document.getElementById('fileList');
            if (!fileList) return; // builder view is not mounted

            if (!snap.handle) {
                selectedDirectoryHandle = null;
                lastHandle = null;
                fileList.innerHTML =
                    '<div class="no-directory-message">Pick a folder or file from the top bar to get started</div>';
                return;
            }
            if (snap.permission !== 'granted') {
                selectedDirectoryHandle = null;
                fileList.innerHTML = `<div class="no-directory-message">🔒 Folder <strong>${snap.name}</strong> is locked. Click <strong>Unlock</strong> in the top bar to grant access.</div>`;
                return;
            }
            // Single-file mode: nothing to list. The file is already loaded
            // into the editor by the nav-level pick handler. Show a small
            // notice so the user understands why the panel is empty.
            if (snap.type === 'file') {
                selectedDirectoryHandle = null;
                lastHandle = null;
                fileList.innerHTML = `<div class="no-directory-message">📄 Editing single file: <strong>${snap.name}</strong></div>`;
                return;
            }
            selectedDirectoryHandle = snap.handle;
            await loadDirectoryFiles();

            if (snap.handle !== lastHandle) {
                lastHandle = snap.handle;
            }
        });
    }

    return {
        toggleFileBrowser,
        updateFileBrowserButtonVisibility,
        selectDirectory,
        loadDirectoryFiles,
        openRoadmapFile,
        handleFileDrop,
        initializeDragAndDrop,
        subscribeToDirectoryStore,
    };
}
