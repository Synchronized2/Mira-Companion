import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve, relative, dirname, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Import data only. Never execute scripts or change files in the source collection.
const source = resolve(process.argv[2] || 'D:/github/live2d');
const root = resolve(import.meta.dirname, '..');
const exclusions = JSON.parse(await readFile(resolve(root, 'shared/character-exclusions.json'), 'utf8'));
const destination = resolve(root, 'public/assets/characters');
const catalog = [{ id: 'hiyori', name: '日和 · Hiyori', family: '默认角色', generation: 3, url: '/assets/hiyori/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json', preview: '/assets/character-previews/hiyori.png' }];
const report = { imported: 0, duplicates: [], rejected: [], warnings: [] };
const copied = new Set(), signatures = new Set();
const url = path => '/assets/characters/' + path.split(sep).map(encodeURIComponent).join('/');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(path);
  }
  return result.sort();
}
const readableNames = {};
const names = await readFile(resolve(source, 'live2d_3/js/charData.js'), 'utf8');
for (const match of names.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) readableNames[basename(match[2])] = match[1];
for (const file of [...await files(resolve(source, 'model')), ...await files(resolve(source, 'live2d_3/model'))]) {
  let data;
  try { data = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); } catch { continue; }
  const generation = data.FileReferences?.Moc ? 3 : typeof data.model === 'string' && Array.isArray(data.textures) ? 2 : 0;
  if (!generation) continue;
  const local = relative(source, file), directory = dirname(file);
  if (exclusions[local.split(sep).join('/')]) { report.rejected.push({ file: local, reason: exclusions[local.split(sep).join('/')] }); continue; }
  async function normalizePaths(value) {
    for (const [key, item] of Object.entries(value)) {
      if (item && typeof item === 'object') await normalizePaths(item);
      else if (typeof item === 'string' && item.startsWith('/')) {
        const corrected = item.replace(/^\/+/, '');
        try { if ((await stat(resolve(directory, corrected))).isFile()) value[key] = corrected; } catch { /* Keep invalid references for the validation report. */ }
      }
    }
  }
  await normalizePaths(data);
  const refs = generation === 3 ? data.FileReferences : data;
  const critical = generation === 3 ? [refs.Moc, ...refs.Textures || []] : [refs.model, ...refs.textures];
  async function resource(ref, copy = false) {
    if (typeof ref !== 'string' || !ref || /^(?:[a-z]+:|\/|\\)/i.test(ref)) return false;
    const path = resolve(directory, ref), pathLocal = relative(source, path);
    if (pathLocal.startsWith('..') || pathLocal.includes(':')) return false;
    try { if (!(await stat(path)).isFile()) return false; } catch { return false; }
    if (copy && !copied.has(path)) {
      const target = resolve(destination, pathLocal);
      await mkdir(dirname(target), { recursive: true }); await copyFile(path, target); copied.add(path);
    }
    return true;
  }
  const missing = [];
  for (const ref of critical) if (!await resource(ref)) missing.push(ref);
  if (missing.length || critical.length < 2) { report.rejected.push({ file: local, missing }); continue; }
  // Identical relative JSON in different folders can point to different outfits.
  const signature = createHash('sha256').update(directory + JSON.stringify(data)).digest('hex');
  if (signatures.has(signature)) { report.duplicates.push(local); continue; }
  signatures.add(signature);
  for (const ref of critical) await resource(ref, true);
  for (const key of generation === 3 ? ['Physics', 'Pose', 'UserData', 'DisplayInfo'] : ['physics', 'pose']) {
    if (refs[key] && !await resource(refs[key], true)) { report.warnings.push(`${local}: missing ${refs[key]}`); delete refs[key]; }
  }
  const expressionsKey = generation === 3 ? 'Expressions' : 'expressions';
  if (refs[expressionsKey]) {
    const valid = [];
    for (const expression of refs[expressionsKey]) if (await resource(expression[generation === 3 ? 'File' : 'file'], true)) valid.push(expression);
    refs[expressionsKey] = valid;
  }
  const motions = refs[generation === 3 ? 'Motions' : 'motions'];
  for (const [group, entries] of Object.entries(motions || {})) {
    const valid = [];
    for (const motion of entries) {
      // Model voice lines must not overlap Mira's selected TTS voice.
      delete motion.Sound; delete motion.sound;
      if (await resource(motion[generation === 3 ? 'File' : 'file'], true)) valid.push(motion);
      else report.warnings.push(`${local}: missing motion in ${group}`);
    }
    motions[group] = valid;
  }
  // Ungrouped exports may need an idle motion to make their default pose visible.
  const idleGroup = generation === 3 ? 'Idle' : 'idle';
  if (motions && !motions[idleGroup]?.length) {
    const idle = Object.values(motions).flat().filter(motion => /(?:^|[\\/])idle[^\\/]*\.(?:motion3\.json|mtn)$/i.test(motion[generation === 3 ? 'File' : 'file']));
    if (idle.length) motions[idleGroup] = idle;
  }
  if (motions?.['']) { motions.Actions = motions['']; delete motions['']; }
  const target = resolve(destination, local);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(data, null, 2) + '\n');
  const id = 'local-' + createHash('sha256').update(local.split(sep).join('/')).digest('hex').slice(0, 12);
  const folder = basename(directory), stem = basename(file, '.json').replace(/\.model3?$/, '');
  const displayFolder = ['normal', 'destroy'].includes(folder) ? basename(dirname(directory)) + ' · ' + (folder === 'normal' ? '常服' : '战损') : folder;
  const name = readableNames[folder] ? readableNames[folder] + (/^[a-f0-9]{32}$/.test(stem) ? ' · 备用配置' : '') : `${displayFolder}${stem === folder || stem === 'model' || stem === 'index' ? '' : ' · ' + stem.replace(/^model\./, '')}`;
  const family = generation === 3 ? '碧蓝航线' : local.includes('dollsfrontline') ? '少女前线' : local.includes('HyperdimensionNeptunia') ? '超次元游戏' : '收藏角色';
  catalog.push({ id, name, family, generation, url: url(local), preview: `/assets/character-previews/${id}.png` });
  report.imported++;
}
await mkdir(resolve(root, 'shared'), { recursive: true });
const featured = ['日和 · Hiyori', 'miku', 'rem', 'shizuku', 'sagiri', 'haru · haru_01', 'Epsilon2.1', 'Zara', 'Atago (Midsummer March)', '22 · default', '33 · default', 'wanko'];
const rank = character => featured.includes(character.name) ? featured.indexOf(character.name) : featured.length;
catalog.sort((a, b) => rank(a) - rank(b));
await writeFile(resolve(root, 'shared/characters.json'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(resolve(root, 'shared/character-import-report.json'), JSON.stringify(report, null, 2) + '\n');
await copyFile(resolve(source, 'js/live2d.js'), resolve(root, 'public/vendor/live2d-legacy.js'));
await copyFile(resolve(source, 'README.md'), resolve(root, 'licenses/live2d-collection-README.md'));
console.log(JSON.stringify({ ...report, warnings: report.warnings.length, catalog: catalog.length, copiedFiles: copied.size }, null, 2));
