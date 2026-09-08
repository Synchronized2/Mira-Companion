import 'dotenv/config';
import express from 'express';
import { defaultEdgeVoice, edgeVoices, edgeSpeech, nativeSpeech, validateSpeech } from './tts.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { demoReply, inferEmotion, readCompletion, validateMessages, validateSettings } from './chat.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const host = '127.0.0.1';
const port = Number(process.env.PORT || 5180);
let settings = validateSettings({ baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL });
let apiKey = process.env.LLM_API_KEY || '';

app.use((req, res, next) => {
  // This local proxy may hold an API key. Reject requests from foreign web origins.
  const origin = req.headers.origin;
  if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin))
    return res.status(403).json({ error: '仅允许本机应用访问。' });
  if (!['127.0.0.1', 'localhost'].includes(req.hostname)) return res.sendStatus(403);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (_req, res) => res.json({ ...settings, configured: Boolean(settings.model), hasApiKey: Boolean(apiKey), nativeSpeech: process.platform === 'win32' }));
app.put('/api/settings', (req, res) => {
  try {
    const next = validateSettings(req.body);
    if (typeof req.body.apiKey === 'string') apiKey = req.body.apiKey.trim();
    settings = next;
    res.json({ ...settings, configured: Boolean(settings.model), hasApiKey: Boolean(apiKey) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/connection', async (_req, res) => {
  try {
    const result = await fetch(`${settings.baseUrl}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(10000) });
    if (!result.ok) return res.status(502).json({ error: `模型服务返回 HTTP ${result.status}。` });
    const data = await result.json();
    res.json({ models: Array.isArray(data.data) ? data.data.map(model => String(model.id)).slice(0, 100) : [] });
  } catch { res.status(502).json({ error: '无法连接模型服务，请检查接口地址和服务状态。' }); }
});

app.post('/api/chat', async (req, res) => {
  let messages;
  try { messages = validateMessages(req.body.messages); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (req.body.mode !== 'demo' && !settings.model) return res.status(400).json({ error: '请先在连接设置中填写模型名称。' });
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), 90000);
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = value => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
  try {
    if (req.body.mode === 'demo') {
      const reply = demoReply(messages.at(-1).content);
      send({ type: 'meta', source: 'demo', emotion: reply.emotion, gesture: reply.gesture });
      for (const token of reply.text) {
        await delay(22, undefined, { signal: controller.signal });
        send({ type: 'token', text: token });
      }
    } else {
      send({ type: 'meta', source: 'model' });
      const result = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model: settings.model, stream: true, max_tokens: 400,
          messages: [{ role: 'system', content: '你是小弥，一个温和、自然、有好奇心的中文虚拟伙伴。用简短口语回复，通常2到4句话。不要输出Markdown、动作括号或表情符号，不要假装有真实身体或能操作用户电脑。不要编造事实。' }, ...messages] }),
      });
      if (!result.ok) throw new Error(`模型服务返回 HTTP ${result.status}，请检查模型名称、密钥或额度。`);
      if (!result.body) throw new Error('模型服务没有返回内容。');
      let reply = '';
      for await (const token of readCompletion(result.body)) {
        reply += token;
        if (reply.length > 12000) throw new Error('模型回复超过长度限制。');
        send({ type: 'token', text: token });
      }
      if (!reply.trim()) throw new Error('模型返回了空回复。');
      send({ type: 'meta', source: 'model', emotion: inferEmotion(reply), gesture: 'nod' });
    }
    send({ type: 'done' });
  } catch (error) {
    if (!res.destroyed) send({ type: 'error', error: controller.signal.aborted ? '回复超时，请稍后重试。' : error.message });
  } finally { clearTimeout(timeout); res.end(); }
});

app.get('/api/voices', async (req, res) => {
  if ((req.query.engine ?? 'edge') === 'edge') return res.json({ voices: edgeVoices, defaultVoice: defaultEdgeVoice });
  if (req.query.engine !== 'native') return res.status(400).json({ error: '不支持该语音引擎。' });
  if (process.platform !== 'win32') return res.json({ voices: [] });
  try {
    const voices = JSON.parse(await nativeSpeech({ list: true }));
    res.json({ voices: Array.isArray(voices) ? voices : [voices] });
  } catch (error) { res.status(503).json({ error: error.message }); }
});
app.post('/api/speech', async (req, res) => {
  let payload;
  try { payload = validateSpeech(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (payload.engine === 'native' && process.platform !== 'win32')
    return res.status(503).json({ error: '当前系统不支持 Windows 语音，请切换 Edge-TTS。' });
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const audio = payload.engine === 'edge'
      ? await edgeSpeech(payload, controller.signal)
      : Buffer.from(await nativeSpeech(payload, controller.signal), 'base64');
    if (!res.destroyed) res.type(payload.engine === 'edge' ? 'audio/mpeg' : 'audio/wav').send(audio);
  } catch (error) { if (!res.destroyed) res.status(503).json({ error: error.message }); }
});
if (process.argv.includes('--api-only')) {
  app.use((_req, res) => res.sendStatus(404));
} else if (process.argv.includes('--production')) {
  app.use(express.static(resolve(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error, _req, res, _next) => res.status(400).json({ error: error.type === 'entity.too.large' ? '请求过大。' : '请求无效。' }));
app.listen(port, host, () => console.log(`Mira Companion: http://${host}:${port}`)).on('error', error => { console.error(error.message); process.exit(1); });
