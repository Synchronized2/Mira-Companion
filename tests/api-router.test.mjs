import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import express from 'express';
import { createApiRouter } from '../server/api.mjs';
import { createApp } from '../server/app.mjs';
import { resolve } from 'node:path';

async function startApi(t, options) {
  const app = express();
  app.use('/api', createApiRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api`;
}

async function startApp(t, options = {}) {
  const app = await createApp({ root: resolve(import.meta.dirname, '..'), mode: 'api-only', ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  return `http://127.0.0.1:${server.address().port}`;
}

function requestWithHeaders(url, headers) {
  return new Promise((resolveRequest, reject) => {
    const outgoing = request(url, { headers }, response => {
      response.resume();
      response.on('end', () => resolveRequest(response));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('application defaults and validates its public port and enforces local-only access', async t => {
  const url = await startApp(t);
  const allowed = await fetch(`${url}/api/health`, { headers: { Origin: 'http://localhost:5180' } });
  assert.equal(allowed.status, 200);

  const foreignOrigin = await fetch(`${url}/api/health`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(foreignOrigin.status, 403);

  const foreignHost = await requestWithHeaders(`${url}/api/health`, { Host: 'untrusted.example' });
  assert.equal(foreignHost.statusCode, 403);
  assert.equal((await fetch(`${url}/not-an-api-route`)).status, 404);

  const malformed = await fetch(`${url}/api/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: '请求无效。' });

  for (const port of [0, -1, 65536, 1.5, 'not-a-port']) {
    await assert.rejects(createApp({ root: resolve(import.meta.dirname, '..'), port, mode: 'api-only' }), /port must be an integer/);
  }
});

test('API router keeps settings isolated, updates atomically and never exposes the key', async t => {
  let upstreamRequest;
  const fetchImpl = async (url, options) => {
    upstreamRequest = { url, options };
    return Response.json({ data: Array.from({ length: 105 }, (_, index) => ({ id: `model-${index}` })) });
  };
  const first = await startApi(t, {
    env: { LLM_BASE_URL: 'http://127.0.0.1:11434/v1', LLM_MODEL: 'initial', LLM_API_KEY: 'private-key' },
    fetchImpl,
  });
  const second = await startApi(t, { env: {} });

  const initial = await (await fetch(`${first}/health`)).json();
  assert.equal(initial.model, 'initial');
  assert.equal(initial.hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(initial), /private-key/);
  assert.equal((await (await fetch(`${second}/health`)).json()).configured, false);

  const rejected = await fetch(`${first}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'file:///secret', model: 'invalid' }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await (await fetch(`${first}/health`)).json()).model, 'initial');

  const updated = await fetch(`${first}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'https://models.example/v1/', model: 'updated' }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).hasApiKey, true);

  const connection = await fetch(`${first}/connection`, { method: 'POST' });
  const models = (await connection.json()).models;
  assert.equal(models.length, 100);
  assert.equal(upstreamRequest.url, 'https://models.example/v1/models');
  assert.equal(upstreamRequest.options.headers.Authorization, 'Bearer private-key');
});

test('API router injects speech engines and respects platform capability', async t => {
  let edgePayload;
  const linux = await startApi(t, {
    env: {},
    platform: 'linux',
    edgeSpeechImpl: async payload => { edgePayload = payload; return Buffer.from('audio'); },
    nativeSpeechImpl: async () => { throw new Error('must not run'); },
  });

  const voices = await fetch(`${linux}/voices?engine=native`);
  assert.deepEqual(await voices.json(), { voices: [] });
  const native = await fetch(`${linux}/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '你好', engine: 'native', voice: '' }),
  });
  assert.equal(native.status, 503);

  const edge = await fetch(`${linux}/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '你好' }),
  });
  assert.equal(edge.status, 200);
  assert.match(edge.headers.get('content-type'), /^audio\/mpeg/);
  assert.equal(Buffer.from(await edge.arrayBuffer()).toString(), 'audio');
  assert.equal(edgePayload.text, '你好');
});

test('chat rejects unknown modes and streams demo events in protocol order', async t => {
  const url = await startApi(t, { env: {}, delay: async () => {} });
  const messages = [{ role: 'user', content: '你好' }];

  const invalid = await fetch(`${url}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'unexpected', messages }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /对话模式/);

  const demo = await fetch(`${url}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'demo', messages }),
  });
  assert.equal(demo.status, 200);
  assert.match(demo.headers.get('content-type'), /^text\/event-stream/);
  const events = (await demo.text()).split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
  assert.deepEqual(events.map(event => event.type), [
    'meta', ...Array(events.length - 2).fill('token'), 'done',
  ]);
  assert.equal(events[0].source, 'demo');
  assert.ok(events.slice(1, -1).map(event => event.text).join('').length > 0);
});
