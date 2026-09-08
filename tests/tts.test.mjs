import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEdgeVoice, edgeSpeech, validateSpeech } from '../server/tts.mjs';

test('speech requests default to Xiaoxiao and keep explicit Windows requests separate', () => {
  assert.deepEqual(validateSpeech({ text: '你好' }), { text: '你好', engine: 'edge', voice: defaultEdgeVoice, rate: 0 });
  assert.equal(validateSpeech({ text: '你好', engine: 'native', voice: 'Microsoft Huihui Desktop' }).voice, 'Microsoft Huihui Desktop');
  assert.equal(validateSpeech({ text: '你好', voice: 'zh-CN-XiaoyiNeural', rate: 3 }).rate, 3);
});
test('speech rejects bad engines, unlisted voices and invalid speed before synthesis', () => {
  for (const input of [null, { text: '' }, { text: 'a'.repeat(2501) }, { text: '你好', voice: 'wrong' }, { text: '你好', engine: 'browser' }, { text: '你好', rate: 'NaN' }, { text: '你好', rate: 1.5 }, { text: '你好', rate: 10 }])
    assert.throws(() => validateSpeech(input));
});
test('a cancelled request does not start Edge-TTS', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(edgeSpeech({ text: '你好', voice: defaultEdgeVoice, rate: 0 }, controller.signal), /已取消/);
});
test('missing Python fails with an actionable error', async () => {
  const previous = process.env.EDGE_TTS_PYTHON;
  process.env.EDGE_TTS_PYTHON = 'mira-nonexistent-python-test';
  try { await assert.rejects(edgeSpeech({ text: '你好', voice: defaultEdgeVoice, rate: 0 }), /setup:tts/); }
  finally { if (previous === undefined) delete process.env.EDGE_TTS_PYTHON; else process.env.EDGE_TTS_PYTHON = previous; }
});
