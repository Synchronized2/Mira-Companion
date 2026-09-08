import express from 'express';
import { setTimeout as defaultDelay } from 'node:timers/promises';
import { demoReply, inferEmotion, readCompletion, validateMessages, validateSettings } from './chat.mjs';
import { defaultEdgeVoice, edgeVoices, edgeSpeech, nativeSpeech, validateSpeech } from './tts.mjs';

export function createApiRouter({
  env = process.env,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  delay = defaultDelay,
  edgeSpeechImpl = edgeSpeech,
  nativeSpeechImpl = nativeSpeech,
} = {}) {
  const router = express.Router();
  let settings = validateSettings({ baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL });
  let apiKey = env.LLM_API_KEY || '';

  router.use(express.json({ limit: '1mb' }));
  router.get('/health', (_req, res) => res.json({
    ...settings,
    configured: Boolean(settings.model),
    hasApiKey: Boolean(apiKey),
    nativeSpeech: platform === 'win32',
  }));
  router.put('/settings', (req, res) => {
    try {
      const next = validateSettings(req.body);
      if (typeof req.body.apiKey === 'string') apiKey = req.body.apiKey.trim();
      settings = next;
      res.json({ ...settings, configured: Boolean(settings.model), hasApiKey: Boolean(apiKey) });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/connection', async (_req, res) => {
    try {
      const result = await fetchImpl(`${settings.baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) return res.status(502).json({ error: `模型服务返回 HTTP ${result.status}。` });
      const data = await result.json();
      res.json({ models: Array.isArray(data.data) ? data.data.map(model => String(model.id)).slice(0, 100) : [] });
    } catch { res.status(502).json({ error: '无法连接模型服务，请检查接口地址和服务状态。' }); }
  });

  router.post('/chat', async (req, res) => {
    let messages;
    try { messages = validateMessages(req.body.messages); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    if (!['demo', 'model'].includes(req.body.mode)) return res.status(400).json({ error: '不支持该对话模式。' });
    if (req.body.mode === 'model' && !settings.model) return res.status(400).json({ error: '请先在连接设置中填写模型名称。' });
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
        const result = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            model: settings.model,
            stream: true,
            max_tokens: 400,
            messages: [
              { role: 'system', content: '你是小弥，一个温和、自然、有好奇心的中文虚拟伙伴。用简短口语回复，通常2到4句话。不要输出Markdown、动作括号或表情符号，不要假装有真实身体或能操作用户电脑。不要编造事实。' },
              ...messages,
            ],
          }),
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

  router.get('/voices', async (req, res) => {
    if ((req.query.engine ?? 'edge') === 'edge') return res.json({ voices: edgeVoices, defaultVoice: defaultEdgeVoice });
    if (req.query.engine !== 'native') return res.status(400).json({ error: '不支持该语音引擎。' });
    if (platform !== 'win32') return res.json({ voices: [] });
    try {
      const voices = JSON.parse(await nativeSpeechImpl({ list: true }));
      res.json({ voices: Array.isArray(voices) ? voices : [voices] });
    } catch (error) { res.status(503).json({ error: error.message }); }
  });
  router.post('/speech', async (req, res) => {
    let payload;
    try { payload = validateSpeech(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    if (payload.engine === 'native' && platform !== 'win32')
      return res.status(503).json({ error: '当前系统不支持 Windows 语音，请切换 Edge-TTS。' });
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const audio = payload.engine === 'edge'
        ? await edgeSpeechImpl(payload, controller.signal)
        : Buffer.from(await nativeSpeechImpl(payload, controller.signal), 'base64');
      if (!res.destroyed) res.type(payload.engine === 'edge' ? 'audio/mpeg' : 'audio/wav').send(audio);
    } catch (error) { if (!res.destroyed) res.status(503).json({ error: error.message }); }
  });

  return router;
}
