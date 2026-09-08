import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUp, Check, CircleHelp, Hand, Headphones, Maximize2, MessageCircle, Mic, Minimize2, Plug, RefreshCw, Settings2, Smile, Square, Volume2, VolumeX, Waves, X } from 'lucide-react';
import Avatar from './Avatar';
import CharacterSettings from './CharacterSettings';
import { getCharacter } from './characters';
import { VoicePlayer } from './voice';
import VoiceSettings from './VoiceSettings';
import type { Connection, Emotion, Gesture, Message, MotionState, Phase, Preferences, Recognition } from './types';

const defaults: Preferences = { voiceOn: true, gaze: true, background: 'sage', speech: 'edge', rate: 0, volume: 0.8, voice: 'zh-CN-XiaoxiaoNeural', ttsVersion: 2, character: 'hiyori' };
const welcome: Message = { id: 'welcome', role: 'assistant', content: '你好，我是小弥。很高兴见到你，今天过得怎么样？', source: 'demo' };
const labels: Record<Phase, string> = { idle: '陪你待一会儿', thinking: '正在想怎么回答', preparing: '准备说话', speaking: '正在说话', listening: '在听你说' };
function loadPrefs(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('mira-preferences') || '{}');
    // Upgrade the old Windows default once, then preserve the user's engine choice.
    if (value.ttsVersion !== 2) { value.speech = 'edge'; value.voice = defaults.voice; value.ttsVersion = 2; }
    return { ...defaults, ...value, character: getCharacter(value.character).id, volume: Math.max(0, Math.min(1, Number(value.volume ?? defaults.volume))), rate: Math.max(-5, Math.min(5, Number(value.rate || 0))) };
  } catch { return defaults; }
}

function IconButton({ label, children, active = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return <button {...props} className={`icon-button ${active ? 'active' : ''} ${props.className || ''}`} title={label} aria-label={label}>{children}</button>;
}

export default function App() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const character = getCharacter(prefs.character);
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<'demo' | 'model'>('demo');
  const [connection, setConnection] = useState<Connection>({ baseUrl: 'http://127.0.0.1:11434/v1', model: '', configured: false, hasApiKey: false, nativeSpeech: true });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [portrait, setPortrait] = useState(true);
  const [error, setError] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [endpoint, setEndpoint] = useState(connection.baseUrl);
  const [modelName, setModelName] = useState('');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [energy, setEnergy] = useState(0);
  const motion = useRef<MotionState>({ phase: 'idle', emotion: 'neutral', mouth: 0, gesture: null, gestureAt: 0, gaze: true, energy: 0 });
  const player = useRef<VoicePlayer | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const liveMessages = useRef(messages);
  const bottom = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const settingsRef = useRef<HTMLDialogElement>(null);
  liveMessages.current = messages;
  motion.current.phase = phase; motion.current.emotion = emotion; motion.current.gaze = prefs.gaze;
  const busy = phase !== 'idle' && phase !== 'listening';
  const speechSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    player.current = new VoicePlayer(motion.current);
    fetch('/api/health').then(response => response.json()).then((value: Connection) => { setConnection(value); setEndpoint(value.baseUrl); setModelName(value.model); if (value.configured) setMode('model'); if (!value.nativeSpeech) setPrefs(previous => previous.speech === 'native' ? { ...previous, speech: 'edge', voice: defaults.voice } : previous); }).catch(() => setError('本地服务连接失败。'));
    const interval = setInterval(() => setEnergy(motion.current.energy), 65);
    return () => { clearInterval(interval); request.current?.abort(); recognition.current?.abort(); player.current?.stop(); };
  }, []);
  useEffect(() => { try { localStorage.setItem('mira-preferences', JSON.stringify(prefs)); } catch { /* Storage can be disabled. */ } }, [prefs]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);
  useEffect(() => {
    if (settingsOpen) settingsRef.current?.showModal();
    else settingsRef.current?.close();
  }, [settingsOpen]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAboutOpen(false); setClearOpen(false); }
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, []);

  function gesture(value: Gesture) {
    motion.current.gesture = value; motion.current.gestureAt = performance.now();
    setEmotion(value === 'surprise' ? 'surprised' : 'happy');
  }
  function stop() {
    generation.current++;
    request.current?.abort(); request.current = null;
    if (recognition.current) { recognition.current.onend = null; recognition.current.abort(); recognition.current = null; }
    player.current?.stop();
    setPhase('idle');
  }
  async function send(text: string) {
    text = text.trim();
    if (!text) return;
    stop();
    setError(''); setInput('');
    void player.current?.unlock().catch(() => {});
    const current = generation.current;
    const controller = new AbortController(); request.current = controller;
    const history = [...liveMessages.current.filter(item => item.id !== 'welcome' && item.content && !item.interrupted), { id: crypto.randomUUID(), role: 'user' as const, content: text }].slice(-40);
    const replyId = crypto.randomUUID();
    setMessages([...history, { id: replyId, role: 'assistant', content: '', source: mode }]);
    setPhase('thinking');
    let reply = '';
    let completed = false;
    try {
      const result = await fetch('/api/chat', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, messages: history.map(({ role, content }) => ({ role, content })) }) });
      if (!result.ok) throw new Error((await result.json()).error || '消息发送失败。');
      const reader = result.body!.getReader();
      const decoder = new TextDecoder(); let pending = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          const lines = pending.split('\n'); pending = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === 'error') throw new Error(event.error);
            if (current !== generation.current) return;
            if (event.type === 'token') { reply += event.text; setMessages(items => items.map(item => item.id === replyId ? { ...item, content: reply } : item)); }
            if (event.type === 'meta') {
              if (event.emotion) setEmotion(event.emotion);
              if (event.gesture) { motion.current.gesture = event.gesture; motion.current.gestureAt = performance.now(); }
            }
            if (event.type === 'done') completed = true;
          }
          if (done) break;
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!completed) throw new Error('连接中断，回复未完成。');
      if (prefs.voiceOn && reply && current === generation.current) {
        setPhase('preparing');
        await player.current!.speak(reply, prefs, controller.signal, () => { if (current === generation.current) setPhase('speaking'); });
      }
    } catch (failure) {
      if (!controller.signal.aborted && current === generation.current) setError(failure instanceof Error ? failure.message : '对话失败。');
    } finally {
      if (!completed) setMessages(items => items.map(item => item.id === replyId ? { ...item, interrupted: true } : item));
      if (current === generation.current) { setPhase('idle'); request.current = null; }
    }
  }
  async function replay(message: Message) {
    stop(); setError('');
    const current = generation.current;
    const controller = new AbortController(); request.current = controller;
    setPhase('preparing');
    try { await player.current!.speak(message.content, prefs, controller.signal, () => { if (current === generation.current) setPhase('speaking'); }); }
    catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '播放失败。'); }
    finally { if (current === generation.current) setPhase('idle'); }
  }
  function microphone() {
    if (phase === 'listening') { recognition.current?.stop(); return; }
    stop(); setError('');
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) { setError('当前浏览器没有语音识别接口，请使用 Chrome 或 Edge，或直接输入文字。'); return; }
    const instance = new Constructor(); recognition.current = instance;
    instance.lang = 'zh-CN'; instance.continuous = false; instance.interimResults = true;
    let transcript = '';
    instance.onresult = event => {
      transcript = Array.from(event.results).map(result => result[0].transcript).join('');
      setInput(transcript);
    };
    instance.onerror = event => {
      transcript = '';
      setError(event.error === 'not-allowed' ? '麦克风权限未开启。' : event.error === 'network' ? '浏览器语音识别服务无法连接，文字输入仍可使用。' : `语音识别未完成：${event.error}`);
    };
    instance.onend = () => { recognition.current = null; setPhase('idle'); if (transcript.trim()) void send(transcript); };
    try { instance.start(); setPhase('listening'); } catch { setError('无法启动麦克风。'); }
  }
  function exportChat() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), messages }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `mira-chat-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveConnection(test = false) {
    setSaving(true); setSettingsStatus('');
    try {
      const result = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: endpoint, model: modelName, ...(key ? { apiKey: key } : {}) }) });
      const value = await result.json(); if (!result.ok) throw new Error(value.error);
      setConnection(previous => ({ ...previous, ...value })); setKey('');
      if (test) {
        const check = await fetch('/api/connection', { method: 'POST' }); const data = await check.json();
        if (!check.ok) throw new Error(data.error);
        setModelOptions(data.models); setSettingsStatus(`已连接，发现 ${data.models.length} 个模型。`);
      } else { setSettingsStatus('已保存到本次服务会话。'); if (value.configured) setMode('model'); }
    } catch (failure) { setSettingsStatus(failure instanceof Error ? failure.message : '保存失败。'); }
    finally { setSaving(false); }
  }

  return <main className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="Mira 首页"><span className="brand-symbol"><Waves size={25} strokeWidth={1.7} /></span><span>Mira<span className="brand-divider">/</span><small>小弥</small></span></a>
      <div className="header-right"><span className="build-tag">PREVIEW 0.1</span><IconButton label="素材与版本" onClick={() => setAboutOpen(true)}><CircleHelp size={19} /></IconButton><IconButton label="连接与偏好设置" onClick={() => { setSettingsStatus(''); setSettingsOpen(true); }}><Settings2 size={19} /></IconButton></div>
    </header>
    <div className="workspace">
      <section className={`stage ${prefs.background}`} ref={stage} aria-label="人物舞台">
        <div className="stage-top"><div className="character-name"><span className="status-dot" />小弥 <span>{character.name}</span></div><span className="live-tag"><Activity size={13} />LIVE</span></div>
        <Avatar motion={motion.current} portrait={portrait} character={character} />
        <div className="stage-side"><IconButton label={portrait ? '全身视角' : '半身视角'} onClick={() => setPortrait(!portrait)}>{portrait ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</IconButton></div>
        <div className="stage-bottom"><div className="character-status"><span className={`status-dot ${phase !== 'idle' ? 'pulse' : ''}`} />{labels[phase]}</div><div className="audio-meter" aria-label="语音音量">{Array.from({ length: 19 }, (_, index) => <span key={index} style={{ height: `${3 + energy * (8 + Math.sin(index * 1.5 + Date.now() / 160) * 7)}px` }} />)}</div></div>
      </section>
      <section className="conversation" aria-label="对话">
        <div className="conversation-header"><div><MessageCircle size={18} /><h1>聊一会儿</h1></div><div><IconButton label="导出聊天记录" onClick={exportChat}><ArrowDownToLine size={17} /></IconButton><IconButton label="新对话" onClick={() => setClearOpen(true)}><RefreshCw size={17} /></IconButton></div></div>
        <div className="mode-strip"><div className="segmented" aria-label="对话模式"><button aria-pressed={mode === 'demo'} onClick={() => { stop(); setMessages([welcome]); setMode('demo'); }}>离线演示</button><button aria-pressed={mode === 'model'} onClick={() => { if (!connection.configured) { setSettingsOpen(true); return; } stop(); setMessages([welcome]); setMode('model'); }}>模型对话</button></div><span className="connection-indicator" title={mode === 'demo' ? '预设台词' : connection.model}><span className="status-dot" />{mode === 'demo' ? '预设台词' : connection.model}</span></div>
        <div className="messages" role="log" aria-live="polite"><div className="date-label">今天</div>{messages.map(message => <article className={`message ${message.role}`} key={message.id}><div className="message-byline">{message.role === 'user' ? '你' : '小弥'}{message.source === 'demo' && <span>演示</span>}</div><div className="message-content">{message.content || (message.interrupted ? '回复已停止' : <span className="typing"><i /><i /><i /></span>)}</div>{message.interrupted && message.content && <small className="interrupted">回复未完成</small>}{message.role === 'assistant' && message.content && <button className="message-replay" aria-label="朗读回复" title="朗读回复" onClick={() => void replay(message)}><Volume2 size={14} /></button>}</article>)}<div ref={bottom} /></div>
        {error && <div className="error-notice" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={() => setError('')}><X size={14} /></IconButton></div>}
        <div className="composer-area"><form onSubmit={event => { event.preventDefault(); void send(input); }}><textarea ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder={phase === 'listening' ? '正在听…' : '今天想聊些什么？'} rows={2} maxLength={4000} aria-label="聊天消息" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); } }} /><div className="composer-actions"><div><IconButton label={phase === 'listening' ? '结束聆听' : speechSupported ? '开始语音输入' : '语音输入不可用'} active={phase === 'listening'} onClick={microphone} type="button"><Mic size={19} /></IconButton><IconButton label={prefs.voiceOn ? '关闭语音回复' : '开启语音回复'} onClick={() => { if (prefs.voiceOn) { stop(); } setPrefs(previous => ({ ...previous, voiceOn: !previous.voiceOn })); }} type="button">{prefs.voiceOn ? <Volume2 size={19} /> : <VolumeX size={19} />}</IconButton></div>{busy ? <IconButton label="停止回复" className="send-button" type="button" onClick={stop}><Square size={16} fill="currentColor" /></IconButton> : <IconButton label="发送消息" className="send-button" type="submit" disabled={!input.trim()}><ArrowUp size={20} /></IconButton>}</div></form><div className="composer-footer"><span className="status-dot" /><span>{phase === 'listening' ? '麦克风已开启' : prefs.voiceOn ? '语音回复已开启' : '语音回复已关闭'}</span><span className="footer-local">本地预览</span></div></div>
      </section>
    </div>
    <footer className="control-bar"><div className="expression-controls"><span className="control-label">小小互动</span><IconButton label="打个招呼" onClick={() => gesture('greet')}><Hand size={21} /></IconButton><IconButton label="微笑" active={emotion === 'happy'} onClick={() => gesture('smile')}><Smile size={21} /></IconButton><IconButton label="点头回应" onClick={() => gesture('nod')}><Check size={21} /></IconButton><IconButton label="惊讶" active={emotion === 'surprised'} onClick={() => gesture('surprise')}><CircleHelp size={21} /></IconButton><IconButton label="恢复自然表情" onClick={() => setEmotion('neutral')}><RefreshCw size={18} /></IconButton></div><div className="background-controls"><span className="control-label">氛围</span>{(['sage', 'rose', 'night'] as const).map(color => <button className={`swatch ${color}`} key={color} title={{ sage: '薄荷', rose: '淡粉', night: '夜色' }[color]} aria-label={{ sage: '薄荷背景', rose: '淡粉背景', night: '夜色背景' }[color]} aria-pressed={prefs.background === color} onClick={() => setPrefs(previous => ({ ...previous, background: color }))}>{prefs.background === color && <Check size={13} />}</button>)}<span className="control-separator" /><label className="toggle-label">目光跟随<input type="checkbox" checked={prefs.gaze} onChange={event => setPrefs(previous => ({ ...previous, gaze: event.target.checked }))} /><span className="toggle" /></label></div></footer>

    <dialog ref={settingsRef} className="settings-dialog" onCancel={() => setSettingsOpen(false)} onClick={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><div className="dialog-header"><h2>连接与偏好</h2><IconButton label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={20} /></IconButton></div><div className="dialog-body">{settingsOpen && <CharacterSettings selected={prefs.character} onSelect={id => setPrefs(previous => ({ ...previous, character: id }))} />}<div className="settings-section"><h3><Plug size={17} />对话模型</h3><label>兼容接口地址<input type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:11434/v1" /></label><label>模型名称<input list="models" value={modelName} onChange={event => setModelName(event.target.value)} placeholder="填写服务中的模型 ID" /><datalist id="models">{modelOptions.map(model => <option key={model} value={model} />)}</datalist></label><label>API 密钥 <span className="field-optional">{connection.hasApiKey ? '已配置，留空保留' : '本地服务可留空'}</span><input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="仅保存在本次服务内存中" /></label><div className="settings-actions"><button className="command" disabled={saving} onClick={() => void saveConnection(true)}><Plug size={15} />测试连接</button><button className="command primary" disabled={saving} onClick={() => void saveConnection(false)}><Check size={15} />保存连接</button></div>{settingsStatus && <p className="settings-status" role="status">{settingsStatus}</p>}</div><VoiceSettings playbackError={error} prefs={prefs} setPrefs={setPrefs} nativeSpeech={connection.nativeSpeech} busy={phase === 'preparing' || phase === 'speaking'} onStop={stop} onPreview={() => void replay({ ...welcome, content: '你好，我是小弥。今天过得怎么样？不管是开心的事，还是有点烦恼的事，都可以慢慢说给我听。' })} /></div></dialog>
    {aboutOpen && <div className="modal-backdrop" onClick={() => setAboutOpen(false)}><section className="small-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={event => event.stopPropagation()}><div className="dialog-header"><h2 id="about-title">Mira / 小弥</h2><IconButton label="关闭版本信息" onClick={() => setAboutOpen(false)}><X size={20} /></IconButton></div><div className="dialog-body"><p>本地交互原型 · 0.1.0</p><p>当前形象：{character.name}<br />形象来源：{character.id === 'hiyori' ? 'AIRI / Live2D 日和示例' : '用户导入的 imuncle/live2d 素材合集'}</p><p>复用 AIRI 的 Live2D 口型模块与角色来源。AIRI 代码采用 MIT 许可；人物素材及 Cubism Core 适用各自授权。</p><a href="https://github.com/moeru-ai/airi" target="_blank" rel="noreferrer">Project AIRI</a><a href="https://www.live2d.com/zh-CHS/download/sample-data/" target="_blank" rel="noreferrer">角色素材许可</a><p className="fine-print">当前形象用于本地原型验证。商业发布需核对素材与 SDK 条款。</p></div></section></div>}
    {clearOpen && <div className="modal-backdrop"><section className="small-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-title"><div className="dialog-header"><h2 id="clear-title">开始新的对话？</h2><IconButton label="取消新对话" onClick={() => setClearOpen(false)}><X size={19} /></IconButton></div><div className="dialog-body"><p>当前记录会从此窗口清除。</p><div className="settings-actions"><button className="command" onClick={() => { exportChat(); }}>先导出记录</button><button className="command primary" onClick={() => { stop(); setMessages([welcome]); setClearOpen(false); setError(''); }}>新对话</button></div></div></section></div>}
  </main>;
}
