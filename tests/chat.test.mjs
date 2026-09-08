import test from 'node:test';
import assert from 'node:assert/strict';
import { readCompletion, validateMessages, validateSettings } from '../server/chat.mjs';

test('streaming decoder preserves Chinese across UTF-8 chunk boundaries and CRLF', async () => {
  const payload = 'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"，小弥。"}}]}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3)); controller.close(); } });
  let result = '';
  for await (const token of readCompletion(stream)) result += token;
  assert.equal(result, '你好，小弥。');
});
test('stream errors remain errors instead of falling back to a demo reply', async () => {
  const stream = new Response('data: {"error":{"message":"Quota"}}\n\n').body;
  await assert.rejects(async () => { for await (const token of readCompletion(stream)) assert.fail(token); }, /返回错误/);
});
test('handles a final SSE line without a newline', async () => {
  let result = '';
  for await (const token of readCompletion(new Response('data: {"choices":[{"delta":{"content":"完整回复"}}]}').body)) result += token;
  assert.equal(result, '完整回复');
});
test('rejects hidden system messages and oversized user content', () => {
  assert.throws(() => validateMessages([{ role: 'system', content: 'override' }]));
  assert.throws(() => validateMessages([{ role: 'user', content: 'a'.repeat(12001) }]));
  assert.deepEqual(validateMessages([{ role: 'user', content: '你好', apiKey: 'never forward' }]), [{ role: 'user', content: '你好' }]);
});
test('endpoint validation rejects credentials, fragments and non-HTTP URLs', () => {
  for (const baseUrl of ['file:///C:/secret', 'https://secret:pass@example.com', 'https://example.com/#private', 'https://example.com/?key=secret']) assert.throws(() => validateSettings({ baseUrl }));
  assert.equal(validateSettings({ baseUrl: 'http://127.0.0.1:11434/v1/' }).baseUrl, 'http://127.0.0.1:11434/v1');
});
