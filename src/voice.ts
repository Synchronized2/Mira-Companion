import type { MotionState, Preferences } from './types';
import { createLive2DLipSync, type Live2DLipSync } from './vendor/airi-lipsync';
import profile from './vendor/lipsync-profile.json';
import type { Profile } from 'wlipsync';

export class VoicePlayer {
  context?: AudioContext;
  private lip?: Live2DLipSync;
  private initializing?: Promise<void>;
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private analyser?: AnalyserNode;
  private samples = new Float32Array(256);
  private animation = 0;
  private generation = 0;
  private cancelWait?: () => void;
  private fallbackLip = false;

  constructor(private motion: MotionState) {}

  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
    if (!this.initializing) {
      this.initializing = createLive2DLipSync(this.context, profile as Profile)
        .then(lip => { this.lip = lip; })
        .catch(() => { this.fallbackLip = true; });
    }
  }

  stop() {
    this.generation++;
    this.cancelWait?.();
    this.cancelWait = undefined;
    cancelAnimationFrame(this.animation);
    if (this.source) { this.source.onended = null; try { this.source.stop(); } catch { /* Already ended. */ } this.source.disconnect(); }
    this.source = undefined;
    this.gain?.disconnect();
    this.analyser?.disconnect();
    window.speechSynthesis?.cancel();
    this.motion.mouth = 0;
    this.motion.energy = 0;
  }

  async speak(text: string, prefs: Preferences, signal: AbortSignal, onStarted: () => void) {
    this.stop();
    const generation = this.generation;
    await this.unlock();
    const valid = () => !signal.aborted && generation === this.generation;
    if (!valid()) return;
    if (prefs.speech === 'browser') {
      if (!window.speechSynthesis) throw new Error('当前浏览器不支持语音播放。');
      return new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1 + prefs.rate * 0.06;
        utterance.volume = prefs.volume;
        const voices = speechSynthesis.getVoices();
        utterance.voice = voices.find(voice => voice.name === prefs.voice) || voices.find(voice => voice.lang.startsWith('zh')) || null;
        let started = 0;
        const finish = () => { cancelAnimationFrame(this.animation); this.motion.mouth = 0; this.motion.energy = 0; this.cancelWait = undefined; resolve(); };
        this.cancelWait = finish;
        utterance.onstart = () => {
          if (!valid()) return;
          onStarted(); started = performance.now();
          // Browser speech does not expose PCM. This mode uses an explicitly documented rhythmic approximation.
          const animate = () => {
            if (!valid()) return finish();
            const time = (performance.now() - started) / 1000;
            this.motion.mouth = Math.max(0, Math.sin(time * 16)) * 0.65;
            this.motion.energy = this.motion.mouth;
            this.animation = requestAnimationFrame(animate);
          };
          animate();
        };
        utterance.onend = finish;
        utterance.onerror = event => {
          if (!['canceled', 'interrupted'].includes(event.error)) reject(new Error('浏览器语音播放失败。'));
          finish();
        };
        speechSynthesis.speak(utterance);
      });
    }
    const result = await fetch('/api/speech', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 2500), engine: prefs.speech, rate: prefs.rate, voice: prefs.voice }) });
    if (!result.ok) throw new Error((await result.json()).error || '语音生成失败。');
    const audio = await this.context!.decodeAudioData(await result.arrayBuffer());
    await this.initializing;
    if (!valid()) return;
    const source = this.context!.createBufferSource();
    const gain = this.context!.createGain();
    const analyser = this.context!.createAnalyser();
    analyser.fftSize = 256;
    gain.gain.value = prefs.volume;
    source.buffer = audio;
    source.connect(analyser);
    source.connect(gain).connect(this.context!.destination);
    this.lip?.connectSource(source);
    this.source = source; this.gain = gain; this.analyser = analyser;
    await new Promise<void>(resolve => {
      const finish = () => { cancelAnimationFrame(this.animation); this.motion.mouth = 0; this.motion.energy = 0; source.disconnect(); gain.disconnect(); analyser.disconnect(); this.cancelWait = undefined; resolve(); };
      source.onended = finish;
      this.cancelWait = finish;
      source.start(); onStarted();
      const tick = () => {
        if (!valid()) return finish();
        analyser.getFloatTimeDomainData(this.samples);
        const rms = Math.sqrt(this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length);
        this.motion.energy = Math.min(1, rms * 8);
        this.motion.mouth = this.fallbackLip ? Math.min(0.8, rms * 5) : this.lip!.getMouthOpen();
        this.animation = requestAnimationFrame(tick);
      };
      tick();
    });
  }
}
