export type Emotion = 'neutral' | 'happy' | 'gentle' | 'surprised';
export type Phase = 'idle' | 'thinking' | 'preparing' | 'speaking' | 'listening';
export type Gesture = 'greet' | 'nod' | 'smile' | 'surprise';
export type MotionState = { emotion: Emotion; phase: Phase; mouth: number; gesture: Gesture | null; gestureAt: number; gaze: boolean; energy: number };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; source?: 'demo' | 'model'; interrupted?: boolean };
export type Preferences = { voiceOn: boolean; gaze: boolean; background: 'sage' | 'rose' | 'night'; speech: 'edge' | 'native' | 'browser'; rate: number; volume: number; voice: string; ttsVersion: 2; character: string };
export type Connection = { baseUrl: string; model: string; configured: boolean; hasApiKey: boolean; nativeSpeech: boolean };
export type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  }
}
