import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(resolve(root, 'shared/characters.json'), 'utf8'));
const sources = JSON.parse(await readFile(resolve(root, 'shared/character-sources.json'), 'utf8'));
test('Every selectable character has local model, texture, animation and preview resources', async () => {
  assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
  assert.equal(new Set(sources.map(item => item.id)).size, sources.length);
  const sourceIds = new Set(sources.map(item => item.id));
  for (const character of catalog) {
    assert.ok(sourceIds.has(character.sourceId), `${character.name}: unknown source ${character.sourceId}`);
    const manifest = resolve(root, 'public', decodeURIComponent(character.url.slice(1)));
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    const refs = character.generation === 3 ? data.FileReferences : data;
    const required = character.generation === 3 ? [refs.Moc, ...refs.Textures] : [refs.model, ...refs.textures];
    const motions = character.generation === 3 ? refs.Motions : refs.motions;
    for (const motion of Object.values(motions || {}).flat()) {
      required.push(motion.File || motion.file);
      if (character.id !== 'hiyori') assert.ok(!motion.Sound && !motion.sound, `${character.name} contains bundled speech`);
    }
    for (const asset of required) {
      const path = resolve(dirname(manifest), asset);
      assert.ok(path.startsWith(resolve(root, 'public') + sep));
      assert.ok((await stat(path)).size > 0, `${character.name}: ${asset}`);
    }
    assert.ok((await stat(resolve(root, 'public', character.preview.slice(1)))).size > 0, `${character.name}: preview missing`);
  }
});
