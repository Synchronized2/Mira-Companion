import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Headphones, Square, Volume2 } from 'lucide-react';
import edgeVoices from '../shared/voices.json';
import type { Preferences } from './types';

type Voice = { name: string; language: string; label?: string; description?: string };
export default function VoiceSettings({ prefs, setPrefs, nativeSpeech, busy, playbackError, onPreview, onStop }: {
  prefs: Preferences; setPrefs: Dispatch<SetStateAction<Preferences>>;
  nativeSpeech: boolean; busy: boolean; playbackError: string; onPreview: () => void; onStop: () => void;
}) {
  const [otherVoices, setOtherVoices] = useState<Voice[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    setError(''); setOtherVoices([]);
    if (prefs.speech === 'edge') return;
    if (prefs.speech === 'browser') {
      const update = () => setOtherVoices((window.speechSynthesis?.getVoices() || []).map(voice => ({ name: voice.name, language: voice.lang })));
      update(); window.speechSynthesis?.addEventListener('voiceschanged', update);
      return () => window.speechSynthesis?.removeEventListener('voiceschanged', update);
    }
    const controller = new AbortController();
    fetch('/api/voices?engine=native', { signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      if (!controller.signal.aborted) setOtherVoices(value.voices);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '声音列表加载失败。'); });
    return () => controller.abort();
  }, [prefs.speech]);
  const voices: Voice[] = prefs.speech === 'edge' ? edgeVoices : otherVoices;
  const selected = voices.find(voice => voice.name === prefs.voice);
  return <div className="settings-section">
    <h3><Headphones size={17} />声音</h3>
    <label>语音引擎<select aria-label="语音引擎" value={prefs.speech} onChange={event => {
      onStop(); const speech = event.target.value as Preferences['speech'];
      setPrefs(previous => ({ ...previous, speech, voice: speech === 'edge' ? 'zh-CN-XiaoxiaoNeural' : '' }));
    }}><option value="edge">Edge-TTS · 在线自然语音（推荐）</option><option value="native" disabled={!nativeSpeech}>Windows 语音 · 离线</option><option value="browser">浏览器语音 · 近似口型</option></select></label>
    <label>声音<select aria-label="声音" value={prefs.voice} onChange={event => { onStop(); setPrefs(previous => ({ ...previous, voice: event.target.value })); }}>
      {prefs.speech !== 'edge' && <option value="">自动选择中文声音</option>}
      {voices.map(voice => <option key={voice.name} value={voice.name}>{voice.label || voice.name}</option>)}
    </select></label>
    {selected?.description && <p className="voice-description">{selected.description}</p>}
    {prefs.speech === 'edge' && <p className="voice-note">在线合成，无需密钥。音色特点仅供试听参考，支持语速调节，不提供独立情绪模式。</p>}
    {error && <p className="settings-status" role="alert">{error}</p>}
    {playbackError && <p className="settings-status" role="alert">{playbackError}</p>}
    <label className="range-label">语速 <span>{prefs.rate > 0 ? '+' : ''}{prefs.speech === 'native' ? prefs.rate : `${prefs.rate * 6}%`}</span><input type="range" min="-5" max="5" step="1" value={prefs.rate} onChange={event => setPrefs(previous => ({ ...previous, rate: Number(event.target.value) }))} /></label>
    <label className="range-label">音量 <span>{Math.round(prefs.volume * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={prefs.volume} onChange={event => setPrefs(previous => ({ ...previous, volume: Number(event.target.value) }))} /></label>
    <div className="voice-preview-actions"><button className="command" onClick={onPreview}><Volume2 size={15} />{busy ? '重新试听' : '试听声音'}</button>{busy && <button className="command" onClick={onStop}><Square size={13} />停止试听</button>}<span className="voice-note">选择后自动保存</span></div>
  </div>;
}
