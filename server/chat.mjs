export function validateSettings(input = {}) {
  const url = new URL(input.baseUrl || 'http://127.0.0.1:11434/v1');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('接口地址必须是 HTTP(S) 地址，不能带账号、查询参数或片段。');
  return { baseUrl: url.href.replace(/\/$/, ''), model: String(input.model || '').trim().slice(0, 200) };
}

export function validateMessages(input) {
  if (!Array.isArray(input) || !input.length || input.length > 60) throw new Error('对话记录无效。');
  return input.map(message => {
    if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 12000)
      throw new Error('消息格式无效或消息过长。');
    return { role: message.role, content: message.content };
  });
}

export async function* readCompletion(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let doneMarker = false;
  const parseLine = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') { doneMarker = true; return; }
    if (!data) return;
    const payload = JSON.parse(data);
    if (payload.error) throw new Error('模型服务在输出过程中返回错误。');
    return payload.choices?.[0]?.delta?.content;
  };
  try {
    while (!doneMarker) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        const token = parseLine(line);
        if (typeof token === 'string') yield token;
        if (doneMarker) break;
      }
      if (done) {
        if (pending.trim()) {
          const token = parseLine(pending.trim());
          if (typeof token === 'string') yield token;
        }
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function demoReply(text) {
  if (/笑|开心|快乐|高兴/.test(text)) return { text: '听到开心的事情，我也忍不住笑起来了。可以跟我分享一下吗？', emotion: 'happy', gesture: 'smile' };
  if (/累|难过|伤心|压力|烦/.test(text)) return { text: '辛苦啦，先让自己缓一缓。你愿意聊聊今天最让你疲惫的那件事吗？我在听。', emotion: 'gentle', gesture: 'nod' };
  if (/介绍|你好|嗨|名字/.test(text)) return { text: '你好，我是小弥。很高兴见到你！今天过得怎么样？', emotion: 'happy', gesture: 'greet' };
  if (/动作|点头|招手|挥手/.test(text)) return { text: '收到，我看到你啦。很高兴能在这里陪你聊一会儿。', emotion: 'happy', gesture: /点头/.test(text) ? 'nod' : 'greet' };
  return { text: '我听到啦。现在是离线演示，这条回复来自预设台词。连接对话模型后，我们就可以围绕你说的内容继续聊下去。', emotion: 'neutral', gesture: 'nod' };
}

export function inferEmotion(text) {
  if (/抱歉|难过|辛苦|疲惫|伤心|理解你的/.test(text)) return 'gentle';
  if (/开心|高兴|太好了|哈哈|很棒|你好/.test(text)) return 'happy';
  if (/惊讶|没想到|居然/.test(text)) return 'surprised';
  return 'neutral';
}
