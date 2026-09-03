import { directoryStore } from './directory-store.js';

(function () {
    const LINKS = [
        { path: '/builder', label: 'Builder' },
        { path: '/imo-search', label: 'Cross-team Search' },
    ];

    const nav = document.getElementById('appNav');
    if (!nav) return;

    // Auto-save relies on the File System Access API; only render the toggle
    // when the browser actually supports in-place writes (Chrome/Edge/Brave/
    // Arc). Safari and Firefox would silently no-op, which is worse than not
    // showing the control at all.
    const autoSaveSupported = directoryStore.canSaveInBrowser;

    const autoSaveBtn = autoSaveSupported
        ? `<button type="button" id="appNavAutoSave" class="app-nav__theme app-nav__beta app-nav__autosave" title="Toggle auto-save" aria-pressed="false">
                <span class="app-nav__status-dot" aria-hidden="true"></span>
                <span class="app-nav__beta-label" id="appNavAutoSaveLabel">Auto-save</span>
            </button>`
        : '';

    nav.innerHTML = `
        <div class="app-nav__row">
            <a href="/builder" class="app-nav__brand" data-spa-link>
                <span class="app-nav__brand-mark" aria-hidden="true">R</span>
                <span>Roadmap</span>
            </a>
            <div class="app-nav__links">
                ${LINKS.map((l) => `<a href="${l.path}" class="app-nav__link" data-spa-link>${l.label}</a>`).join('')}
            </div>
            <div class="app-nav__actions">
                <button type="button" id="appNavTheme" class="app-nav__theme" title="Toggle dark mode" aria-pressed="false"></button>
                ${autoSaveBtn}
                <button type="button" id="appNavStatusStyle" class="app-nav__theme app-nav__beta" title="Toggle experimental features" aria-pressed="false">
                    <span class="app-nav__status-dot" aria-hidden="true"></span>
                    <span class="app-nav__beta-label" id="appNavStatusStyleLabel">Beta</span>
                </button>
                <div class="app-nav__folder-wrap" style="position: relative;">
                    <button type="button" id="appNavFolder" class="app-nav__folder" title="Open a roadmap file or folder"></button>
                    <div id="appNavFolderMenu" class="app-nav__folder-menu">
                        <button type="button" data-pick="file" class="app-nav__folder-menu-item">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>
                            Open a single file...
                        </button>
                        <button type="button" data-pick="folder" class="app-nav__folder-menu-item">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"></path></svg>
                            Open a folder...
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const folderBtn = nav.querySelector('#appNavFolder');
    const menuEl = nav.querySelector('#appNavFolderMenu');
    const themeBtn = nav.querySelector('#appNavTheme');
    const statusStyleBtn = nav.querySelector('#appNavStatusStyle');

    function renderTheme() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        themeBtn.innerHTML = isDark
            ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>'
            : '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';
        themeBtn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    }

    themeBtn.addEventListener('click', () => {
        const next =
            document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try {
            localStorage.setItem('roadmap-theme', next);
        } catch {
            /* ignore */
        }
        renderTheme();
    });

    renderTheme();

    const statusStyleLabel = nav.querySelector('#appNavStatusStyleLabel');

    function renderStatusStyle() {
        const isExperimental =
            document.documentElement.getAttribute('data-status-style') !== 'side';
        if (statusStyleLabel) statusStyleLabel.textContent = 'Beta';
        statusStyleBtn.title = isExperimental
            ? 'Beta features enabled (click to disable)'
            : 'Beta features disabled (click to enable)';
        statusStyleBtn.setAttribute('aria-pressed', isExperimental ? 'true' : 'false');
    }

    statusStyleBtn.addEventListener('click', () => {
        const next =
            document.documentElement.getAttribute('data-status-style') === 'side'
                ? 'hover'
                : 'side';
        document.documentElement.setAttribute('data-status-style', next);
        try {
            localStorage.setItem('roadmap-status-style', next);
        } catch {
            /* ignore */
        }
        renderStatusStyle();
        document.dispatchEvent(
            new CustomEvent('roadmap-status-style-changed', { detail: { style: next } })
        );
    });

    renderStatusStyle();

    // Auto-save toggle - only present in Chromium-based browsers (see
    // autoSaveSupported above). Persists to localStorage and notifies the
    // builder's save module via a custom event.
    const autoSaveBtnEl = nav.querySelector('#appNavAutoSave');
    const autoSaveLabel = nav.querySelector('#appNavAutoSaveLabel');
    if (autoSaveBtnEl) {
        const readAutoSave = () => {
            try {
                return localStorage.getItem('roadmap-autosave') === 'on';
            } catch {
                return false;
            }
        };
        const renderAutoSave = () => {
            const on = readAutoSave();
            if (autoSaveLabel) autoSaveLabel.textContent = 'Auto-save';
            autoSaveBtnEl.title = on
                ? 'Auto-save enabled (saves shortly after each change)'
                : 'Auto-save disabled (use Save button to write changes)';
            autoSaveBtnEl.setAttribute('aria-pressed', on ? 'true' : 'false');
        };
        autoSaveBtnEl.addEventListener('click', () => {
            const next = !readAutoSave();
            try {
                localStorage.setItem('roadmap-autosave', next ? 'on' : 'off');
            } catch {
                /* ignore */
            }
            renderAutoSave();
            window.dispatchEvent(
                new CustomEvent('roadmap-autosave-changed', { detail: { enabled: next } })
            );
        });
        renderAutoSave();
    }

    function updateActive(path) {
        nav.querySelectorAll('.app-nav__link').forEach((a) => {
            if (a.getAttribute('href') === path) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
    }

    function renderFolder(snap) {
        const folderIcon =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"></path></svg>';
        const fileIcon =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>';
        const chevron =
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>';
        const safeName = String(snap?.name || '').replace(
            /[&<>"']/g,
            (character) =>
                ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;',
                })[character]
        );
        if (!snap || !snap.handle) {
            folderBtn.innerHTML = `${folderIcon}<span>roadmaps</span>${chevron}`;
            folderBtn.dataset.state = 'empty';
        } else if (snap.permission === 'granted') {
            folderBtn.innerHTML = `${snap.type === 'file' ? fileIcon : folderIcon}<span>${safeName}</span>${chevron}`;
            folderBtn.dataset.state = 'granted';
        } else {
            folderBtn.innerHTML = `${folderIcon}<span>Unlock ${safeName}</span>${chevron}`;
            folderBtn.dataset.state = 'prompt';
        }
    }

    function openMenu() {
        menuEl.classList.add('is-open');
        // Dismiss on outside click. Defer the listener so the click that
        // opened the menu doesn't immediately close it.
        setTimeout(() => {
            document.addEventListener('click', onOutside, { once: true });
        }, 0);
    }
    function closeMenu() {
        menuEl.classList.remove('is-open');
    }
    function isMenuOpen() {
        return menuEl.classList.contains('is-open');
    }
    function onOutside(e) {
        if (menuEl.contains(e.target) || folderBtn.contains(e.target)) {
            // Re-arm the outside listener since this click was inside.
            setTimeout(() => {
                document.addEventListener('click', onOutside, { once: true });
            }, 0);
            return;
        }
        closeMenu();
    }

    folderBtn.addEventListener('click', async () => {
        const snap = directoryStore.get();
        // If we already have a granted native folder handle that's just
        // pending re-permission, skip the menu and re-request access.
        if (snap.handle && snap.permission !== 'granted' && snap.kind === 'native') {
            const after = await directoryStore.requestAccess();
            if (after.permission === 'granted') return;
            // Permission denied/dismissed - fall through to the menu.
        }
        if (isMenuOpen()) closeMenu();
        else openMenu();
    });

    menuEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-pick]');
        if (!btn) return;
        closeMenu();
        const choice = btn.dataset.pick;
        if (choice === 'folder') {
            await directoryStore.select();
        } else if (choice === 'file') {
            const result = await directoryStore.selectFile();
            if (result && typeof window.onRoadmapFilePicked === 'function') {
                window.onRoadmapFilePicked(result);
            }
        }
    });

    directoryStore.subscribe(renderFolder);
    window.__updateNav = updateActive;
})();
