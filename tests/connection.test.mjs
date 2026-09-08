import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

test('local proxy connects to a compatible model, streams real provider data and exposes no API key', { timeout: 25000 }, async t => {
  let requestBody;
  let authHeader;
  let fail = false;
  const upstream = createServer(async (req, res) => {
    authHeader = req.headers.authorization;
    if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture-chat' }] })); return; }
    if (fail) { res.writeHead(401); res.end('Unauthorized'); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    requestBody = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"真实接口路径"}}]}\n\n');
    await delay(20);
    res.end('data: {"choices":[{"delta":{"content":"已通过测试。"}}]}\n\ndata: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => upstream.close());
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const app = spawn(process.execPath, ['server/index.mjs', '--api-only'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), LLM_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, LLM_MODEL: 'fixture-chat', LLM_API_KEY: 'test-secret-not-a-real-key' } });
  app.stdout.resume(); app.stderr.resume();
  t.after(async () => { const closed = once(app, 'close'); app.kill(); await closed; });
  const url = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(`${url}/api/health`); health = await response.json(); break; } catch { await delay(100); }
  }
  assert.ok(health?.configured);
  assert.equal(health.hasApiKey, true);
  assert.ok(!JSON.stringify(health).includes('test-secret'));
  const connection = await fetch(`${url}/api/connection`, { method: 'POST' });
  assert.deepEqual((await connection.json()).models, ['fixture-chat']);
  const chat = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'model', messages: [{ role: 'user', content: '你好' }] }) });
  const events = (await chat.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.equal(events.filter(event => event.type === 'token').map(event => event.text).join(''), '真实接口路径已通过测试。');
  assert.equal(events.at(-1).type, 'done');
  assert.equal(authHeader, 'Bearer test-secret-not-a-real-key');
  assert.equal(requestBody.messages[0].role, 'system');
  assert.equal(requestBody.model, 'fixture-chat');
  assert.equal(requestBody.stream, true);
  fail = true;
  const failed = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'model', messages: [{ role: 'user', content: '你好' }] }) });
  const failure = await failed.text();
  assert.match(failure, /HTTP 401/);
  assert.doesNotMatch(failure, /预设台词|test-secret-not-a-real-key/);
  const foreignOrigin = await fetch(`${url}/api/settings`, { method: 'PUT', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreignOrigin.status, 403);
});
