import { useEffect, useRef, useState } from 'react';
import { Check, Search, UserRound } from 'lucide-react';
import { characters, getCharacter } from './characters';

export default function CharacterSettings({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const [candidate, setCandidate] = useState(selected);
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('全部');
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'mira-character-ready' && event.data.id === candidate) setReady(event.data.ready === true);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [candidate]);
  const character = getCharacter(candidate);
  const filtered = characters.filter(item => (family === '全部' || item.family === family) && `${item.name} ${item.family}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="settings-section character-settings" aria-label="形象选择">
    <h3><UserRound size={17} />形象 <span className="character-count">{characters.length} 款</span></h3>
    <p className="character-hint">先选一款看看，再应用到舞台。形象和音色可以自由搭配。</p>
    <div className="character-preview-row">
      <div className="character-live-preview"><iframe key={candidate} ref={frame} title="动态形象预览" src={`/?character-preview=${encodeURIComponent(candidate)}`} /><span className="preview-badge">动态预览</span></div>
      <div className="character-preview-info"><strong>{character.name}</strong><span>{character.family}</span><small>移入预览可看目光跟随；动作和口型效果取决于模型本身。</small>
        <button className="command" disabled={!ready} onClick={() => frame.current?.contentWindow?.postMessage({ type: 'mira-character-greet', id: candidate }, location.origin)}>试试动作</button>
        <button className="command primary" disabled={!ready || selected === candidate} onClick={() => onSelect(candidate)}>{selected === candidate ? <><Check size={15} />正在使用</> : '使用此形象'}</button>
      </div>
    </div>
    <div className="character-search"><Search size={16} /><input aria-label="搜索形象" placeholder="搜索角色或服装名称…" value={search} onChange={event => setSearch(event.target.value)} /><select aria-label="形象分类" value={family} onChange={event => setFamily(event.target.value)}>{['全部', ...new Set(characters.map(item => item.family))].map(value => <option key={value}>{value}</option>)}</select></div>
    <div className="character-gallery" aria-label="形象库">
      {filtered.map(item => <button type="button" key={item.id} data-character-option={item.id} className={`character-card ${candidate === item.id ? 'is-previewed' : ''}`} aria-label={`预览 ${item.name}`} aria-pressed={candidate === item.id} onClick={() => { if (candidate !== item.id) { setReady(false); setCandidate(item.id); } }}>
        <img src={item.preview} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /><span className="character-card-name">{item.name}</span>{selected === item.id && <span className="character-selected"><Check size={12} />使用中</span>}
      </button>)}
      {!filtered.length && <p className="character-empty">没有找到匹配的形象，试试其他关键词。</p>}
    </div>
    <p className="character-hint" role="status">显示 {filtered.length} 款 · 选择会自动保存在此浏览器</p>
  </section>;
}
