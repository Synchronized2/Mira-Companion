import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const edgeVoices = JSON.parse(readFileSync(resolve(root, 'shared/voices.json'), 'utf8'));
export const defaultEdgeVoice = 'zh-CN-XiaoxiaoNeural';

export function validateSpeech(input) {
  if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 2500)
    throw new Error('语音文本为空或超过 2500 字。');
  const engine = input.engine ?? 'edge';
  if (!['edge', 'native'].includes(engine)) throw new Error('不支持该语音引擎。');
  const rate = Number(input.rate ?? 0);
  if (!Number.isInteger(rate) || rate < -5 || rate > 5) throw new Error('语速应为 -5 到 5 的整数。');
  const voice = input.voice || (engine === 'edge' ? defaultEdgeVoice : '');
  if (typeof voice !== 'string' || voice.length > 200) throw new Error('音色无效。');
  if (engine === 'edge' && !edgeVoices.some(item => item.name === voice)) throw new Error('请选择列表中的 Edge-TTS 音色。');
  return { text: input.text, engine, voice, rate };
}

// One request owns one helper process. Completion, cancellation and timeout all
// remove listeners and terminate the helper before its output can be reused.
function runSpeech(command, args, payload, signal, failureMessage) {
  return new Promise((resolveSpeech, reject) => {
    if (signal?.aborted) { reject(new Error('语音生成已取消。')); return; }
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let size = 0;
    const parts = [];
    const finish = (error, audio) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      if (error) { child.kill(); reject(error); }
      else resolveSpeech(audio);
    };
    const cancel = () => finish(new Error('语音生成已取消。'));
    const timeout = setTimeout(() => finish(new Error('语音生成超时，请检查网络后重试。')), 60000);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 16000000) finish(new Error('语音数据超过大小限制。'));
      else if (!settled) parts.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error(failureMessage)));
    child.on('close', code => {
      if (code !== 0 || !size) finish(new Error(failureMessage));
      else finish(null, Buffer.concat(parts));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function edgeSpeech(payload, signal) {
  const python = process.env.EDGE_TTS_PYTHON || resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return runSpeech(python, [resolve(root, 'server/edge_speech.py')], payload, signal,
    'Edge-TTS 暂时不可用，请检查网络和语音依赖（npm run setup:tts），或在设置中切换 Windows 语音。');
}

export async function nativeSpeech(payload, signal) {
  const bytes = await runSpeech('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve(root, 'server/speech.ps1')], payload, signal,
    'Windows 语音不可用，请检查系统语音包，或切换其他引擎。');
  return bytes.toString('utf8').trim();
}
