import { RoadmapGenerator } from '../../roadmap-generator.js';

// PDF/JPG/HTML export from the Builder.
//   - exportJPG / exportPDF capture the live preview iframe via html-to-image
//     + jsPDF (both loaded from CDN as window globals in index.html).
//   - exportHTML runs the RoadmapGenerator against the current form data to
//     produce a self-contained .html file.
// All three fall back to an automatic browser download when the File System
// Access API isn't available.
//
// exportHTML needs the live form data, so it's factoried via createExportHTML.
// JPG/PDF are pure DOM/iframe captures and remain plain exports.

const HIDE_EDIT_ICONS_CSS = `
    .edit-icon,
    .monthly-edit-icon {
        display: none !important;
    }
`;

/**
 * Snapshot the in-page roadmap mount into an offscreen clone sized for capture.
 * Caller is responsible for removing the returned container from the DOM.
 *
 * @returns {Promise<{ container: HTMLDivElement, dataUrl: string, width: number, height: number } | null>}
 *          null if the mount isn't ready.
 */
async function snapshotPreview() {
    const mount = document.getElementById('roadmap-mount');
    if (!mount || !mount.firstElementChild) {
        alert('Preview not available.');
        return null;
    }

    const width = Math.max(mount.scrollWidth, mount.offsetWidth, mount.clientWidth, 1200);
    // Pad height so the bottom isn't clipped by the capture canvas.
    const height = Math.max(mount.scrollHeight, mount.offsetHeight, mount.clientHeight, 800) + 32;

    const clone = mount.cloneNode(true);
    clone.style.background = '#fff';
    clone.style.overflow = 'visible';
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.background = '#fff';
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.appendChild(clone);
    document.body.appendChild(container);

    const hideStyle = document.createElement('style');
    hideStyle.textContent = HIDE_EDIT_ICONS_CSS;
    clone.appendChild(hideStyle);

    // Best-effort wait for images and webfonts to load before capture.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const dataUrl = await window.htmlToImage.toJpeg(clone, {
        quality: 0.95,
        backgroundColor: '#fff',
        width,
        height,
    });

    return { container, dataUrl, width, height };
}

function buildFilename(extension) {
    const teamName = document.getElementById('teamName').value.trim() || 'MyTeam';
    const roadmapYear = document.getElementById('roadmapYear').value || '2025';
    return `${teamName}.Teya-Roadmap.${roadmapYear}.${extension}`;
}

async function trySaveWithPicker(suggestedName, accept, write) {
    if (!('showSaveFilePicker' in window)) return false;
    try {
        const fileHandle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: suggestedName, accept }],
        });
        const writable = await fileHandle.createWritable();
        await write(writable);
        await writable.close();
        return true;
    } catch (err) {
        if (err.name === 'AbortError') return true; // user cancelled - stop, don't fall back
        return false; // any other error - caller falls back to direct download
    }
}

export async function exportJPG() {
    const snap = await snapshotPreview();
    if (!snap) return;
    const { container, dataUrl } = snap;

    try {
        const filename = buildFilename('jpg');
        const saved = await trySaveWithPicker(filename, { 'image/jpeg': ['.jpg', '.jpeg'] }, async (writable) => {
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            await writable.write(blob);
        });
        if (saved) return;

        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        alert('Failed to export JPG: ' + err);
    } finally {
        document.body.removeChild(container);
    }
}

/**
 * Factory for the HTML exporter. Takes a `collectFormData` callback so the
 * generator runs against the live form rather than stale state.
 *
 * @param {{ collectFormData: () => any }} deps
 */
export function createExportHTML({ collectFormData }) {
    return async function exportHTML() {
        const teamData = collectFormData();
        const generator = new RoadmapGenerator(teamData.roadmapYear);
        // generateRoadmap(teamData, embedded=false, enableEditing=false): standalone export with edit affordances stripped.
        const html = generator.generateRoadmap(teamData, false, false);
        const blob = new Blob([html], { type: 'text/html' });
        const filename = `${teamData.teamName || 'MyTeam'}.Teya-Roadmap.${teamData.roadmapYear || 2025}.html`;

        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'HTML Roadmap files', accept: { 'text/html': ['.html'] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                // Other errors - fall through to direct download below.
            }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
}

export async function exportPDF() {
    const snap = await snapshotPreview();
    if (!snap) return;
    const { container, dataUrl, width, height } = snap;

    try {
        const { jsPDF } = window.jspdf;
        // Cap PDF width at A3 landscape (420mm) to keep file sizes reasonable.
        const pdfWidth = Math.min(width / 4, 420);
        const pdfHeight = (height / width) * pdfWidth;
        const pdf = new jsPDF({
            orientation: pdfWidth > pdfHeight ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [pdfWidth, pdfHeight],
        });
        pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight);

        const filename = buildFilename('pdf');
        const saved = await trySaveWithPicker(filename, { 'application/pdf': ['.pdf'] }, async (writable) => {
            await writable.write(pdf.output('blob'));
        });
        if (saved) return;

        pdf.save(filename);
    } catch (err) {
        alert('Failed to export PDF: ' + err);
    } finally {
        document.body.removeChild(container);
    }
}
