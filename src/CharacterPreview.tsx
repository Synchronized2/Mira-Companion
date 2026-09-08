import { useEffect, useRef } from 'react';
import Avatar from './Avatar';
import { getCharacter } from './characters';
import type { MotionState } from './types';

// A lightweight standalone preview also used to capture real model thumbnails.
export default function CharacterPreview({ id }: { id: string }) {
  const motion = useRef<MotionState>({ emotion: 'neutral', phase: 'idle', mouth: 0, gesture: null, gestureAt: 0, gaze: true, energy: 0 });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== parent || event.data?.id !== id || event.data?.type !== 'mira-character-greet') return;
      motion.current.gesture = 'greet'; motion.current.gestureAt = performance.now(); motion.current.emotion = 'happy';
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [id]);
  return <div className="standalone-character"><Avatar character={getCharacter(id)} motion={motion.current} portrait={false} onReady={ready => { if (parent !== window) parent.postMessage({ type: 'mira-character-ready', id, ready }, location.origin); }} /></div>;
}
