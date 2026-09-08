import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bootstrap = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
for (const [command, args] of [
  [bootstrap, ['-m', 'venv', resolve(root, '.venv')]],
  [resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ['-m', 'pip', 'install', '-r', resolve(root, 'requirements.txt')]],
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error('TTS setup failed. Install Python 3.10+ and check your network.');
    process.exit(result.status || 1);
  }
}
