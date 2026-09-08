import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createSourceNamespaceId } from '../scripts/characters/import-core.mjs';

const execute = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '..');

async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('CLI imports incrementally with source isolation, cross-source dedupe and repeatable output', async t => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'mira-import-cli-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = resolve(temporary, 'source');
  const project = resolve(temporary, 'project');

  await put(resolve(project, 'shared/character-exclusions.json'), '{}');
  await put(resolve(project, 'shared/characters.json'), JSON.stringify([{
    id: 'other-character', name: 'Other', family: 'Other source', sourceId: 'other-source', generation: 2,
    url: '/assets/other/model.json', preview: '/assets/character-previews/other.png',
  }]));
  await put(resolve(project, 'public/assets/other/model.json'), JSON.stringify({ model: 'model.moc', textures: ['texture.png'] }));
  await put(resolve(project, 'public/assets/other/model.moc'), 'shared-core');
  await put(resolve(project, 'public/assets/other/texture.png'), 'same-texture');
  await put(resolve(source, 'js/live2d.js'), 'legacy-runtime');
  await put(resolve(source, 'README.md'), 'fixture license');

  for (const folder of ['alpha', 'duplicate']) {
    await put(resolve(source, `model/${folder}/model.moc`), 'shared-core');
    await put(resolve(source, `model/${folder}/texture.png`), 'same-texture');
    await put(resolve(source, `model/${folder}/anything.json`), JSON.stringify({ model: 'model.moc', textures: ['texture.png'] }));
  }
  await put(resolve(source, 'model/variant/model.moc'), 'shared-core');
  await put(resolve(source, 'model/variant/texture.png'), 'different-texture');
  await put(resolve(source, 'model/variant/idle.mtn'), 'idle-motion');
  await put(resolve(source, 'model/variant/line.mp3'), 'bundled-speech');
  await put(resolve(source, 'model/variant/config.data.json'), JSON.stringify({
    model: 'model.moc', textures: ['texture.png'], physics: 'missing.json',
    motions: { '': [{ file: 'idle.mtn', sound: 'line.mp3' }] },
  }));
  await put(resolve(source, 'model/bad/texture.png'), 'bad-texture');
  await put(resolve(source, 'model/bad/escaping.json'), JSON.stringify({ model: '../../../outside.moc', textures: ['texture.png'] }));

  const command = [resolve(repositoryRoot, 'scripts/import-characters.mjs'), source, '--project-root', project];
  await execute(process.execPath, command, { cwd: repositoryRoot });

  const catalogPath = resolve(project, 'shared/characters.json');
  const indexPath = resolve(project, 'shared/character-import-index.json');
  const reportPath = resolve(project, 'shared/character-import-report.json');
  const firstCatalogText = await readFile(catalogPath, 'utf8');
  const firstIndexText = await readFile(indexPath, 'utf8');
  const catalog = JSON.parse(firstCatalogText);
  const report = await readJson(reportPath);
  const index = await readJson(indexPath);
  const namespace = createSourceNamespaceId('https://github.com/imuncle/live2d');

  assert.equal(catalog.length, 2);
  assert.ok(catalog.some(character => character.id === 'other-character'), 'another source must be retained');
  const imported = catalog.find(character => character.sourceId === 'imuncle-live2d');
  assert.ok(imported.url.startsWith(`/assets/characters/${namespace}/`));
  assert.equal(report.imported, 1);
  assert.equal(report.duplicates.length, 2);
  assert.ok(report.duplicates.every(item => item.duplicateOf === 'other-character'));
  assert.ok(report.rejected.some(item => item.file === 'model/bad/escaping.json'));
  assert.ok(report.warnings.some(item => item.file?.includes?.('missing.json') || String(item).includes('missing.json')));
  assert.equal(index.entries.find(entry => entry.id === imported.id).sharedCore, 'other-character');

  const outputManifest = resolve(project, 'public', decodeURIComponent(imported.url.slice(1)));
  const written = await readJson(outputManifest);
  assert.ok(written.motions.Actions?.length);
  assert.ok(written.motions.idle?.length);
  assert.equal(written.motions.Actions[0].sound, undefined);
  assert.equal(written.physics, undefined);
  await assert.rejects(stat(resolve(dirname(outputManifest), 'line.mp3')), { code: 'ENOENT' });

  await execute(process.execPath, command, { cwd: repositoryRoot });
  assert.equal(await readFile(catalogPath, 'utf8'), firstCatalogText);
  assert.equal(await readFile(indexPath, 'utf8'), firstIndexText);
  assert.equal((await readJson(reportPath)).imported, 0);
});

test('CLI selects the hacxy adapter, normalizes root paths and preserves its terms', async t => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'mira-hacxy-import-cli-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = resolve(temporary, 'source');
  const project = resolve(temporary, 'project');

  await put(resolve(project, 'shared/characters.json'), '[]');
  await put(resolve(project, 'shared/character-import-index.json'), JSON.stringify({ version: 1, entries: [] }));
  await put(resolve(source, 'README.md'), 'personal learning only');
  await put(resolve(source, 'models/avatar/model.moc'), 'hacxy-core');
  await put(resolve(source, 'models/avatar/texture.png'), 'hacxy-texture');
  await put(resolve(source, 'models/avatar/model.json'), JSON.stringify({
    model: '/model.moc', textures: ['/texture.png'],
  }));

  await execute(process.execPath, [
    resolve(repositoryRoot, 'scripts/import-characters.mjs'), source,
    '--source', 'hacxy', '--project-root', project,
  ], { cwd: repositoryRoot });

  const catalog = await readJson(resolve(project, 'shared/characters.json'));
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].sourceId, 'hacxy-l2d-models');
  assert.ok(catalog[0].url.startsWith(`/assets/characters/${createSourceNamespaceId('https://github.com/hacxy/l2d-models')}/`));
  const manifest = await readJson(resolve(project, 'public', decodeURIComponent(catalog[0].url.slice(1))));
  assert.equal(manifest.model, 'model.moc');
  assert.equal(manifest.textures[0], 'texture.png');
  assert.equal((await readJson(resolve(project, 'shared/hacxy-l2d-models-import-report.json'))).imported, 1);
  assert.equal(await readFile(resolve(project, 'licenses/hacxy-l2d-models-README.md'), 'utf8'), 'personal learning only');
});
