import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  createAppearanceFingerprint,
  createCharacterId,
  createSourceNamespaceId,
  discoverModelManifests,
  planIncrementalImport,
  resolveResourceReference,
} from '../scripts/characters/import-core.mjs';

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'mira-character-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function file(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function v2(root, { manifest = 'nested/arbitrary.data.json', core = 'core/model.moc', texture = 'textures/face.png', coreBytes = 'same-core', textureBytes = 'texture-a' } = {}) {
  await file(resolve(root, core), coreBytes);
  await file(resolve(root, texture), textureBytes);
  const manifestPath = resolve(root, manifest);
  const fromManifest = value => `../${value}`;
  await file(manifestPath, JSON.stringify({ model: fromManifest(core), textures: [fromManifest(texture)] }));
  return manifestPath;
}

async function v3(root) {
  await file(resolve(root, 'modern/core/avatar.moc3'), 'modern-core');
  await file(resolve(root, 'modern/images/0.png'), 'modern-texture');
  await file(resolve(root, 'deep/config/not-named-model.json'), JSON.stringify({
    Version: 3,
    FileReferences: { Moc: '../../modern/core/avatar.moc3', Textures: ['../../modern/images/0.png'] },
  }));
}

async function candidate(root, sourceIdentity, id) {
  const { manifests: [manifest] } = await discoverModelManifests(root);
  return {
    id,
    sourceNamespaceId: createSourceNamespaceId(sourceIdentity),
    relativePath: manifest.relativePath,
    ...await createAppearanceFingerprint(manifest),
  };
}

test('discovers v2 and v3 manifests recursively by JSON structure, not filename', async t => {
  const root = await fixture(t);
  await v2(root);
  await v3(root);
  await file(resolve(root, 'deep/ordinary.json'), JSON.stringify({ textures: ['not-a-model.png'] }));
  await file(resolve(root, 'deep/broken.json'), '{');

  const { manifests, rejected } = await discoverModelManifests(root);
  assert.deepEqual(manifests.map(item => item.generation).sort(), [2, 3]);
  assert.deepEqual(manifests.map(item => item.relativePath).sort(), [
    'deep/config/not-named-model.json',
    'nested/arbitrary.data.json',
  ]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].file, 'deep/broken.json');
});

test('stable source namespaces prevent equal relative paths from colliding', () => {
  const first = createSourceNamespaceId('https://github.com/example/first.git');
  const sameAgain = createSourceNamespaceId('https://github.com/example/first/');
  const second = createSourceNamespaceId('https://github.com/example/second');
  assert.equal(first, sameAgain);
  assert.notEqual(first, second);
  assert.notEqual(createCharacterId(first, 'model/avatar/config.json'), createCharacterId(second, 'model/avatar/config.json'));
});

test('exact appearances are skipped across sources', async t => {
  const firstRoot = await fixture(t);
  const secondRoot = await fixture(t);
  await v2(firstRoot);
  await v2(secondRoot);
  const first = await candidate(firstRoot, 'https://example.test/first', 'first-character');
  const duplicate = await candidate(secondRoot, 'https://example.test/second', 'second-character');

  const plan = planIncrementalImport([first], [duplicate]);
  assert.deepEqual(plan.imports, []);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.duplicates[0].duplicateOf, first.id);
});

test('same core with different or reordered textures is retained and marked sharedCore', async t => {
  const root = await fixture(t);
  await file(resolve(root, 'core/model.moc'), 'shared-core');
  await file(resolve(root, 'textures/a.png'), 'texture-a');
  await file(resolve(root, 'textures/b.png'), 'texture-b');
  await file(resolve(root, 'one.json'), JSON.stringify({ model: 'core/model.moc', textures: ['textures/a.png', 'textures/b.png'] }));
  await file(resolve(root, 'two.json'), JSON.stringify({ model: 'core/model.moc', textures: ['textures/b.png', 'textures/a.png'] }));
  const { manifests } = await discoverModelManifests(root);
  const entries = await Promise.all(manifests.map(async (manifest, index) => ({
    id: `character-${index + 1}`,
    ...await createAppearanceFingerprint(manifest),
  })));

  assert.equal(entries[0].coreFingerprint, entries[1].coreFingerprint);
  assert.notEqual(entries[0].appearanceFingerprint, entries[1].appearanceFingerprint);
  const plan = planIncrementalImport([], entries);
  assert.equal(plan.imports.length, 2);
  assert.equal(plan.imports[0].sharedCore, null);
  assert.equal(plan.imports[1].sharedCore, plan.imports[0].id);
  assert.deepEqual(plan.duplicates, []);
});

test('a changed appearance at the same stable ID is updated without self-referencing sharedCore', () => {
  const existing = [{ id: 'stable-id', appearanceFingerprint: 'old-appearance', coreFingerprint: 'same-core' }];
  const changed = [{ id: 'stable-id', appearanceFingerprint: 'new-appearance', coreFingerprint: 'same-core' }];
  const plan = planIncrementalImport(existing, changed);
  assert.equal(plan.imports.length, 1);
  assert.equal(plan.imports[0].id, 'stable-id');
  assert.equal(plan.imports[0].sharedCore, null);
  assert.deepEqual(plan.duplicates, []);
});

test('resource references reject protocols, absolute paths and source-root escapes', async t => {
  const root = await fixture(t);
  const manifest = resolve(root, 'nested/config.json');
  await file(manifest, '{}');
  assert.throws(() => resolveResourceReference(root, manifest, 'https://example.test/model.moc'));
  assert.throws(() => resolveResourceReference(root, manifest, '/absolute/model.moc'));
  assert.throws(() => resolveResourceReference(root, manifest, 'C:\\absolute\\model.moc'));
  assert.throws(() => resolveResourceReference(root, manifest, '../../outside.moc'));
  assert.equal(resolveResourceReference(root, manifest, '../inside.moc').sourcePath, 'inside.moc');

  await file(resolve(root, 'nested/escaping.json'), JSON.stringify({ model: '../../outside.moc', textures: ['../inside.png'] }));
  const discovered = await discoverModelManifests(root);
  assert.equal(discovered.manifests.length, 0);
  assert.match(discovered.rejected[0].reason, /leaves the source root/);
});
