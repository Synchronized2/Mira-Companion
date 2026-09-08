import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import type { Live2DModel as ModelType, Cubism4InternalModel, Cubism2InternalModel } from 'pixi-live2d-display';
import { getCharacter, type Character } from './characters';
import type { MotionState } from './types';
import { RotateCw } from 'lucide-react';

// PIXI caches textures across stage and preview. Release only after all pending
// loads finish, and only when no mounted character still uses the texture.
const activeModels = new Set<ModelType>();
const retiredTextures = new Set<PIXI.Texture>();
let pendingLoads = 0;
function releaseUnusedTextures() {
  if (pendingLoads) return;
  const used = new Set([...activeModels].flatMap(model => model.textures));
  for (const texture of retiredTextures) {
    if (!used.has(texture)) { texture.destroy(true); retiredTextures.delete(texture); }
  }
}
function disposeModel(model: ModelType) {
  model.textures.forEach(texture => retiredTextures.add(texture));
  activeModels.delete(model);
  model.destroy();
  releaseUnusedTextures();
}

export default function Avatar({ motion, portrait, character = getCharacter(), onReady }: { motion: MotionState; portrait: boolean; character?: Character; onReady?: (ready: boolean) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const portraitRef = useRef(portrait);
  portraitRef.current = portrait;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = container.current!;
    let disposed = false;
    let app: PIXI.Application | undefined;
    let model: ModelType | undefined;
    let observer: ResizeObserver | undefined;
    let lastPortrait = portraitRef.current;
    let mouth = 0;
    let gazeX = 0;
    let gazeY = 0;
    let lastGesture = 0;
    setLoaded(false); setError(''); readyRef.current?.(false);
    const resize = () => {
      if (!app || !model) return;
      const width = element.clientWidth, height = element.clientHeight;
      app.renderer.resize(width, height);
      const internal = model.internalModel;
      const scale = Math.min(width / (internal.originalWidth * (portraitRef.current ? 0.68 : 1.04)), height / (internal.originalHeight * (portraitRef.current ? 0.7 : 1.04)));
      // Legacy widget layouts can stretch X and Y independently. Cancel that
      // transform so the final drawable scale is uniform in both directions.
      model.scale.set(scale / internal.localTransform.a, scale / internal.localTransform.d);
      model.anchor.set(0.5, 0);
      // Source-widget layout offsets should not move a model outside Mira's
      // independently fitted frame (some legacy exports shift by 80% height).
      model.position.set(width / 2 - internal.localTransform.tx * model.scale.x, height * 0.015 - internal.localTransform.ty * model.scale.y);
    };
    const pointer = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      gazeX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      gazeY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    };
    const leave = () => { gazeX = 0; gazeY = 0; };
    const init = async () => {
      try {
        Object.assign(window, { PIXI });
        const { Live2DModel, config } = await import('pixi-live2d-display');
        config.sound = false;
        if (disposed) return;
        app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio, 2), preserveDrawingBuffer: true });
        element.appendChild(app.view as HTMLCanvasElement);
        pendingLoads++;
        let loadedModel: ModelType;
        try {
          loadedModel = await Live2DModel.from(character.url, { autoInteract: false, autoUpdate: true });
          activeModels.add(loadedModel);
        } finally { pendingLoads--; releaseUnusedTextures(); }
        if (disposed) { disposeModel(loadedModel); return; }
        model = loadedModel;
        app.stage.addChild(model);
        observer = new ResizeObserver(resize);
        observer.observe(element);
        resize();
        const modern = character.generation === 3 ? (model.internalModel as Cubism4InternalModel).coreModel : null;
        const legacy = character.generation === 2 ? (model.internalModel as Cubism2InternalModel).coreModel : null;
        const legacyId = (id: string) => id.replace(/Brow([LR])Y/, 'Brow_$1_Y').replace(/^Param/, 'PARAM_').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
        const core = {
          setParameterValueById(id: string, value: number) {
            if (modern) modern.setParameterValueById(id, value);
            else legacy!.setParamFloat(legacyId(id), value);
          },
          addParameterValueById(id: string, value: number) {
            if (modern) modern.addParameterValueById(id, value);
            else { const key = legacyId(id); legacy!.setParamFloat(key, legacy!.getParamFloat(key) + value); }
          },
        };
        const groups = Object.entries(model.internalModel.motionManager.definitions).filter(([, entries]) => entries?.length).map(([name]) => name);
        const gestureGroup = (surprise: boolean) => groups.find(name => surprise ? /flick|shake|pinch|touch_head/i.test(name) : /tap|touch|start/i.test(name)) || groups.find(name => !/idle/i.test(name));
        model.internalModel.on('beforeModelUpdate', () => {
          const time = performance.now() / 1000;
          const age = (performance.now() - motion.gestureAt) / 1000;
          const active = age >= 0 && age < 2.2;
          mouth += (motion.mouth - mouth) * 0.4;
          core.setParameterValueById('ParamMouthOpenY', mouth);
          const happiness = motion.emotion === 'happy' ? 0.8 : motion.emotion === 'gentle' ? 0.3 : 0.08;
          core.setParameterValueById('ParamMouthForm', happiness);
          core.setParameterValueById('ParamBrowLY', motion.emotion === 'surprised' ? 0.7 : motion.emotion === 'gentle' ? -0.25 : 0);
          core.setParameterValueById('ParamBrowRY', motion.emotion === 'surprised' ? 0.7 : motion.emotion === 'gentle' ? -0.25 : 0);
          core.addParameterValueById('ParamAngleX', (motion.gaze ? gazeX * 9 : 0) + Math.sin(time * 0.48) * 2);
          core.addParameterValueById('ParamAngleY', (motion.gaze ? -gazeY * 5 : 0) + (active && motion.gesture === 'nod' ? Math.sin(age * 8) * 9 * Math.sin(age / 2.2 * Math.PI) : 0));
          core.addParameterValueById('ParamEyeBallX', motion.gaze ? gazeX * 0.3 : 0);
          core.addParameterValueById('ParamEyeBallY', motion.gaze ? -gazeY * 0.2 : 0);
          if (motion.phase === 'listening') core.addParameterValueById('ParamAngleZ', 5);
          if (lastGesture !== motion.gestureAt) {
            lastGesture = motion.gestureAt;
            const group = gestureGroup(motion.gesture === 'surprise');
            if (group && (motion.gesture === 'greet' || motion.gesture === 'surprise')) void model!.motion(group, 0, 3).catch(() => {});
          }
          if (lastPortrait !== portraitRef.current) { lastPortrait = portraitRef.current; resize(); }
          element.dataset.mouth = mouth.toFixed(3);
          element.dataset.gaze = gazeX.toFixed(2);
        });
        element.addEventListener('pointermove', pointer);
        element.addEventListener('pointerleave', leave);
        setLoaded(true); readyRef.current?.(true);
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : '角色加载失败');
      }
    };
    void init();
    return () => {
      disposed = true;
      observer?.disconnect();
      element.removeEventListener('pointermove', pointer);
      element.removeEventListener('pointerleave', leave);
      if (model) disposeModel(model);
      app?.destroy(true, { children: false });
    };
  }, [attempt, motion, character.url, character.generation]);

  return <div className="avatar" ref={container} data-ready={loaded} data-character={character.id} aria-label={`${character.name} 动态人物`}>
    {!loaded && !error && <div className="avatar-loading"><span className="spinner" />正在载入 {character.name}</div>}
    {error && <div className="avatar-loading" role="alert"><p>角色加载失败</p><small>{error}</small><button className="command" onClick={() => setAttempt(value => value + 1)}><RotateCw size={16} />重试</button></div>}
  </div>;
}
