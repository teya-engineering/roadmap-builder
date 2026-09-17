import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8080;
// Bind to all interfaces by default so the readiness probe in the
// container can reach the server. Local dev sets HOST=127.0.0.1 if it
// wants to keep the server off the LAN.
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIR = resolve(join(__dirname, 'web'));

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const ROUTES = {
    '/': 'index.html',
};

// Client-side routes served by the SPA shell. Any GET that matches one of
// these (or /) falls back to index.html so deep links and reloads work.
const SPA_ROUTES = new Set(['/', '/builder', '/imo-search', '/example']);

// Permanent redirects for legacy URLs (the pre-SPA static pages people
// have bookmarked). Path-only - any query string is preserved.
const REDIRECTS = {
    '/roadmap-builder.html': '/builder',
    '/imo-search.html': '/imo-search',
};

function resolveFilePath(pathname) {
    if (SPA_ROUTES.has(pathname)) return resolve(join(WEB_DIR, 'index.html'));
    const relative = ROUTES[pathname] ?? pathname.replace(/^\/+/, '');
    return resolve(join(WEB_DIR, relative));
}

function isInsideWebDir(filePath) {
    return filePath === WEB_DIR || filePath.startsWith(WEB_DIR + sep);
}

async function serveFile(res, filePath, headOnly = false) {
    try {
        const content = await readFile(filePath);
        const contentType =
            MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(headOnly ? undefined : content);
    } catch (error) {
        const missing = error?.code === 'ENOENT' || error?.code === 'EISDIR';
        sendText(res, missing ? 404 : 500, missing ? 'File not found' : 'Internal server error');
    }
}

function sendText(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
    res.end(body);
}

function logRequest(req) {
    const clientIP = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${clientIP}`);
}

// Exported so tests can drive it via their own http.createServer without
// binding the production port or spawning a subprocess.
export async function requestHandler(req, res) {
    logRequest(req);

    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
        return;
    }

    if (REDIRECTS[pathname]) {
        const target = REDIRECTS[pathname] + url.search + url.hash;
        res.writeHead(301, { Location: target });
        res.end();
        return;
    }

    const filePath = resolveFilePath(pathname);

    if (!isInsideWebDir(filePath)) {
        sendText(res, 403, 'Access denied');
        return;
    }

    await serveFile(res, filePath, req.method === 'HEAD');
}

// Only listen when run directly (node server.mjs), not when imported by tests.
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMainModule) {
    createServer(requestHandler).listen(PORT, HOST, () => {
        console.log(`Server running at http://${HOST}:${PORT}`);
        console.log(`Serving static files from: ${WEB_DIR}`);
        console.log('SPA routes (served by index.html):');
        for (const route of SPA_ROUTES) {
            console.log(`  GET    ${route}`);
        }
    });
}
