import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { requestHandler } from './server.mjs';

let app;
let appUrl;
let mock;
let mockUrl;
let received;

before(async () => {
    // Mock Slack incoming webhook. Records every received body; the response
    // status can be forced via a ?status= query param on the webhook URL.
    received = [];
    mock = createServer((req, res) => {
        const status = Number(
            new URL(req.url, 'http://localhost').searchParams.get('status') || 200
        );
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            received.push(Buffer.concat(chunks).toString('utf8'));
            res.writeHead(status);
            res.end('ok');
        });
    });
    mock.listen(0, '127.0.0.1');
    await once(mock, 'listening');
    mockUrl = `http://127.0.0.1:${mock.address().port}/`;

    // App server driven by the real exported handler.
    app = createServer(requestHandler);
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    appUrl = `http://127.0.0.1:${app.address().port}`;
});

after(() => {
    app.close();
    mock.close();
});

beforeEach(() => {
    received.length = 0;
    delete process.env.SLACK_WEBHOOK_URL;
});

function notify(body, { headers } = {}) {
    return fetch(`${appUrl}/api/roadmap-saved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

test('webhook unset -> 204 no-op, nothing forwarded', async () => {
    const res = await notify({ text: 'hello' });
    assert.equal(res.status, 204);
    assert.equal(received.length, 0);
});

test('webhook set -> 204 and forwards { text } verbatim', async () => {
    process.env.SLACK_WEBHOOK_URL = mockUrl;
    const text =
        '*Roadmap Update — Cloud Engineering*\n:calendar:  X\nEnd date moved  15 May  →  30 May';
    const res = await notify({ text });
    assert.equal(res.status, 204);
    assert.equal(received.length, 1);
    assert.deepEqual(JSON.parse(received[0]), { text });
});

test('missing text -> 400, nothing forwarded', async () => {
    process.env.SLACK_WEBHOOK_URL = mockUrl;
    const res = await notify({});
    assert.equal(res.status, 400);
    assert.equal(received.length, 0);
});

test('whitespace-only text -> 400', async () => {
    const res = await notify({ text: '   ' });
    assert.equal(res.status, 400);
});

test('invalid JSON -> 400', async () => {
    const res = await notify('not json');
    assert.equal(res.status, 400);
});

test('non-POST -> 405 with Allow: POST', async () => {
    const res = await fetch(`${appUrl}/api/roadmap-saved`, { method: 'GET' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
});

test('oversized body -> 413', async () => {
    const res = await notify(JSON.stringify({ text: 'x'.repeat(70 * 1024) }));
    assert.equal(res.status, 413);
});

test('Slack non-2xx response -> 502', async () => {
    process.env.SLACK_WEBHOOK_URL = `${mockUrl}?status=500`;
    const res = await notify({ text: 'boom' });
    assert.equal(res.status, 502);
});

test('static file serving is unaffected', async () => {
    const res = await fetch(`${appUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
});
