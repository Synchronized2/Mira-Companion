import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { edgeVoices } from '../server/tts.mjs';
const url = process.env.TEST_URL || 'http://127.0.0.1:5180';
await mkdir('artifacts/edge-voices', { recursive: true });
for (const voice of edgeVoices) {
  const start = performance.now();
  const response = await fetch(`${url}/api/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你好，我是小弥。很高兴见到你，今天有什么想跟我分享的吗？', engine: 'edge', voice: voice.name, rate: 0 }), signal: AbortSignal.timeout(65000) });
  assert.equal(response.status, 200, await (response.ok ? Promise.resolve('') : response.text()));
  assert.match(response.headers.get('content-type'), /audio\/mpeg/);
  const audio = Buffer.from(await response.arrayBuffer());
  assert.ok(audio.length > 3000);
  await writeFile(`artifacts/edge-voices/${voice.name}.mp3`, audio);
  console.log(JSON.stringify({ voice: voice.name, bytes: audio.length, milliseconds: Math.round(performance.now() - start) }));
}
