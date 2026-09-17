import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { requestHandler } from './server.mjs';

let app;
let appUrl;

before(async () => {
    // App server driven by the real exported handler.
    app = createServer(requestHandler);
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    appUrl = `http://127.0.0.1:${app.address().port}`;
});

after(() => {
    app.close();
});

test('serves the SPA shell at the root', async () => {
    const res = await fetch(`${appUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
});

test('static routes support HEAD without a response body', async () => {
    const res = await fetch(`${appUrl}/builder`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.equal(await res.text(), '');
});

test('static routes reject unsupported methods', async () => {
    const res = await fetch(`${appUrl}/`, { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
});

test('legacy routes preserve the query string when redirecting', async () => {
    const res = await fetch(`${appUrl}/roadmap-builder.html?year=2028`, {
        redirect: 'manual',
    });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/builder?year=2028');
});

test('missing static files return 404', async () => {
    const res = await fetch(`${appUrl}/missing.js`);
    assert.equal(res.status, 404);
});
