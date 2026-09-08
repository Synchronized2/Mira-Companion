import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  createAppearanceFingerprint,
  createCharacterId,
  createSourceNamespaceId,
  discoverModelManifests,
  inspectModelManifest,
  planIncrementalImport,
  readModelManifest,
  resolveExistingResourceReference,
} from './import-core.mjs';

const IMUNCLE_SOURCE = {
  id: 'imuncle-live2d',
  identity: 'https://github.com/imuncle/live2d',
  reportFile: 'character-import-report.json',
  exclusionsFile: 'character-exclusions.json',
  readableNamesFile: 'live2d_3/js/charData.js',
  supportFiles: [
    ['js/live2d.js', 'public/vendor/live2d-legacy.js'],
    ['README.md', 'licenses/live2d-collection-README.md'],
  ],
};
const HIYORI = { id: 'hiyori', name: '日和 · Hiyori', family: '默认角色', sourceId: 'live2d-hiyori', generation: 3, url: '/assets/hiyori/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json', preview: '/assets/character-previews/hiyori.png' };
const toPosix = value => value.split(sep).join('/').replaceAll('\\', '/');
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }).catch(() => {}); }
}

async function atomicCopy(source, target) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try { await copyFile(source, temporary); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }).catch(() => {}); }
}

// Terisa and a few older exports use `/file` to mean `file` beside the manifest.
async function prepareImuncleData(data, { sourceRoot, manifestPath }) {
  const prepared = structuredClone(data);
  const descriptor = inspectModelManifest(prepared);
  if (!descriptor) return prepared;
  const refs = descriptor.generation === 3 ? prepared.FileReferences : prepared;
  async function normalize(owner, key) {
    const item = owner?.[key];
    if (typeof item !== 'string' || !item.startsWith('/')) return;
    const corrected = item.replace(/^\/+/, '');
    try { await resolveExistingResourceReference(sourceRoot, manifestPath, corrected); owner[key] = corrected; }
    catch { /* Strict manifest validation will reject unresolved paths. */ }
  }
  await normalize(refs, descriptor.generation === 3 ? 'Moc' : 'model');
  const texturesKey = descriptor.generation === 3 ? 'Textures' : 'textures';
  for (let index = 0; index < refs[texturesKey].length; index++) await normalize(refs[texturesKey], index);
  for (const key of descriptor.generation === 3 ? ['Physics', 'Pose', 'UserData', 'DisplayInfo'] : ['physics', 'pose']) await normalize(refs, key);
  const expressions = refs[descriptor.generation === 3 ? 'Expressions' : 'expressions'];
  for (const expression of Array.isArray(expressions) ? expressions : []) await normalize(expression, descriptor.generation === 3 ? 'File' : 'file');
  const motions = refs[descriptor.generation === 3 ? 'Motions' : 'motions'];
  for (const entries of Object.values(motions || {})) {
    for (const motion of Array.isArray(entries) ? entries : []) await normalize(motion, descriptor.generation === 3 ? 'File' : 'file');
  }
  return prepared;
}

function publicManifestPath(publicRoot, url) {
  if (typeof url !== 'string' || !url.startsWith('/') || /[?#]/.test(url)) throw new Error('Invalid catalog URL.');
  const decoded = decodeURIComponent(url.slice(1)).replaceAll('\\', '/');
  const path = resolve(publicRoot, ...decoded.split('/'));
  const local = relative(publicRoot, path);
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error('Catalog URL leaves public root.');
  return path;
}

function sourceRelativePath(character, sourceNamespaceId, sourceId) {
  if (character.sourceId !== sourceId || typeof character.url !== 'string') return undefined;
  const legacyPrefix = '/assets/characters/';
  const namespacedPrefix = `${legacyPrefix}${sourceNamespaceId}/`;
  const encoded = character.url.startsWith(namespacedPrefix)
    ? character.url.slice(namespacedPrefix.length)
    : character.url.startsWith(legacyPrefix) ? character.url.slice(legacyPrefix.length) : '';
  return encoded ? decodeURIComponent(encoded).replaceAll('\\', '/') : undefined;
}

async function existingFingerprints(catalog, storedIndex, publicRoot, report, hashOptions, sourceNamespaceId, sourceId) {
  const stored = new Map((storedIndex?.entries || storedIndex || []).map(entry => [entry.id, entry]));
  const entries = [];
  for (const character of catalog) {
    const saved = stored.get(character.id);
    if (saved?.appearanceFingerprint && saved?.coreFingerprint) { entries.push(saved); continue; }
    try {
      const manifest = await readModelManifest(publicRoot, publicManifestPath(publicRoot, character.url));
      if (!manifest) throw new Error('Catalog URL is not a model manifest.');
      entries.push({ id: character.id, sourceId: character.sourceId, sourceRelativePath: sourceRelativePath(character, sourceNamespaceId, sourceId), ...await createAppearanceFingerprint(manifest, hashOptions) });
    } catch (error) {
      report.warnings.push(`catalog ${character.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return entries;
}

function characterDetails(manifest, readableNames, sourceNamespaceId, sourceId, existingByPath) {
  const directory = dirname(manifest.manifestPath);
  const folder = basename(directory);
  const stem = basename(manifest.manifestPath, '.json').replace(/\.model3?$/, '');
  const displayFolder = ['normal', 'destroy'].includes(folder) ? `${basename(dirname(directory))} · ${folder === 'normal' ? '常服' : '战损'}` : folder;
  const name = readableNames[folder]
    ? readableNames[folder] + (/^[a-f0-9]{32}$/.test(stem) ? ' · 备用配置' : '')
    : `${displayFolder}${stem === folder || stem === 'model' || stem === 'index' ? '' : ` · ${stem.replace(/^model\./, '')}`}`;
  const previous = existingByPath.get(manifest.relativePath);
  const id = previous?.id || createCharacterId(sourceNamespaceId, manifest.relativePath);
  const family = manifest.generation === 3 ? '碧蓝航线' : /(?:^|\/)dollsfrontline(?:\/|$)/i.test(manifest.relativePath) ? '少女前线' : /(?:^|\/)HyperdimensionNeptunia(?:\/|$)/i.test(manifest.relativePath) ? '超次元游戏' : '收藏角色';
  return {
    id,
    legacyOutput: Boolean(previous && !previous.url.includes(`/${sourceNamespaceId}/`)),
    catalog: previous ? { ...previous, name, family, sourceId, generation: manifest.generation } : {
      id, name, family, sourceId, generation: manifest.generation,
      url: `/assets/characters/${sourceNamespaceId}/${encodePath(manifest.relativePath)}`,
      preview: `/assets/character-previews/${id}.png`,
    },
  };
}

async function materialize(candidate, destination, report) {
  const { manifest } = candidate;
  const data = structuredClone(manifest.data);
  const refs = manifest.generation === 3 ? data.FileReferences : data;
  const outputRoot = candidate.legacyOutput ? destination : resolve(destination, candidate.sourceNamespaceId);
  const copied = new Set();
  async function copyResource(reference) {
    const resource = await resolveExistingResourceReference(manifest.sourceRoot, manifest.manifestPath, reference);
    if (!copied.has(resource.sourcePath)) {
      await atomicCopy(resource.realPath, resolve(outputRoot, ...resource.sourcePath.split('/')));
      copied.add(resource.sourcePath);
    }
  }
  async function optional(reference, label) {
    try { await copyResource(reference); return true; }
    catch { report.warnings.push(`${manifest.relativePath}: missing ${label || reference || 'resource'}`); return false; }
  }

  await copyResource(manifest.generation === 3 ? refs.Moc : refs.model);
  for (const reference of manifest.generation === 3 ? refs.Textures : refs.textures) await copyResource(reference);
  for (const key of manifest.generation === 3 ? ['Physics', 'Pose', 'UserData', 'DisplayInfo'] : ['physics', 'pose']) {
    if (refs[key] && !await optional(refs[key])) delete refs[key];
  }
  const expressionsKey = manifest.generation === 3 ? 'Expressions' : 'expressions';
  if (Array.isArray(refs[expressionsKey])) {
    const valid = [];
    for (const expression of refs[expressionsKey]) {
      const reference = expression?.[manifest.generation === 3 ? 'File' : 'file'];
      if (await optional(reference, `expression ${reference || ''}`)) valid.push(expression);
    }
    refs[expressionsKey] = valid;
  }
  const motions = refs[manifest.generation === 3 ? 'Motions' : 'motions'];
  for (const [group, items] of Object.entries(motions || {})) {
    const valid = [];
    for (const motion of Array.isArray(items) ? items : []) {
      delete motion.Sound; delete motion.sound;
      const reference = motion[manifest.generation === 3 ? 'File' : 'file'];
      if (await optional(reference, `motion in ${group}`)) valid.push(motion);
    }
    motions[group] = valid;
  }
  const idleGroup = manifest.generation === 3 ? 'Idle' : 'idle';
  if (motions && !motions[idleGroup]?.length) {
    const idle = Object.values(motions).flat().filter(motion => /(?:^|[\\/])idle[^\\/]*\.(?:motion3\.json|mtn)$/i.test(motion?.[manifest.generation === 3 ? 'File' : 'file'] || ''));
    if (idle.length) motions[idleGroup] = idle;
  }
  if (motions?.['']) { motions.Actions = motions['']; delete motions['']; }
  await atomicWrite(resolve(outputRoot, ...manifest.relativePath.split('/')), `${JSON.stringify(data, null, 2)}\n`);
  return copied.size + 1;
}

function optionsFrom(value) {
  return typeof value === 'string' || value === undefined ? { sourcePath: value || 'D:/github/live2d' } : value;
}

// Import data only. Never execute scripts or change files in the source collection.
export async function importLive2dCollection(value, sourceOptions = IMUNCLE_SOURCE) {
  const options = optionsFrom(value);
  const source = resolve(options.sourcePath || 'D:/github/live2d');
  const root = options.projectRoot ? resolve(options.projectRoot) : resolve(import.meta.dirname, '../..');
  const publicRoot = resolve(root, 'public');
  const destination = resolve(publicRoot, 'assets/characters');
  const shared = resolve(root, 'shared');
  const catalogPath = resolve(shared, 'characters.json');
  const reportPath = resolve(shared, sourceOptions.reportFile);
  const indexPath = resolve(shared, 'character-import-index.json');
  const exclusions = sourceOptions.exclusionsFile
    ? await readJson(resolve(shared, sourceOptions.exclusionsFile), {})
    : {};
  const storedIndex = await readJson(indexPath, { version: 1, entries: [] });
  const storedEntries = storedIndex?.entries || storedIndex || [];
  const excludedIds = new Set(storedEntries
    .filter(entry => entry.sourceId === sourceOptions.id && exclusions[entry.sourceRelativePath])
    .map(entry => entry.id));
  const catalog = (await readJson(catalogPath, [HIYORI])).filter(character => !excludedIds.has(character.id));
  const report = { sourceId: sourceOptions.id, imported: 0, retained: catalog.length, duplicates: [], rejected: [], warnings: [] };
  const sourceNamespaceId = createSourceNamespaceId(sourceOptions.identity);
  const hashOptions = { fileHashCache: new Map() };

  const existing = await existingFingerprints(catalog, storedIndex, publicRoot, report, hashOptions, sourceNamespaceId, sourceOptions.id);
  const catalogById = new Map(catalog.map(character => [character.id, character]));
  const existingByPath = new Map(existing.filter(entry => entry.sourceId === sourceOptions.id && entry.sourceRelativePath).map(entry => [entry.sourceRelativePath, catalogById.get(entry.id)]));
  const readableNames = {};
  if (sourceOptions.readableNamesFile) {
    try {
      const names = await readFile(resolve(source, sourceOptions.readableNamesFile), 'utf8');
      for (const match of names.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) readableNames[basename(match[2])] = match[1];
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }

  const discovered = await discoverModelManifests(source, { prepareData: prepareImuncleData });
  report.rejected.push(...discovered.rejected.filter(item => !exclusions[item.file]));
  for (const [file, reason] of Object.entries(exclusions)) report.rejected.push({ file, reason });
  const candidates = [];
  for (const manifest of discovered.manifests) {
    if (exclusions[manifest.relativePath]) continue;
    const details = characterDetails(manifest, readableNames, sourceNamespaceId, sourceOptions.id, existingByPath);
    candidates.push({ ...details, sourceId: sourceOptions.id, sourceNamespaceId, sourceRelativePath: manifest.relativePath, relativePath: manifest.relativePath, manifest, ...await createAppearanceFingerprint(manifest, hashOptions) });
  }

  const plan = planIncrementalImport(existing, candidates);
  report.duplicates = plan.duplicates
    .filter(item => item.duplicateOf !== item.id)
    .map(item => ({ file: item.relativePath, duplicateOf: item.duplicateOf }));
  const indexById = new Map(existing.map(entry => [entry.id, entry]));
  let copiedFiles = 0;
  for (const item of plan.imports) {
    copiedFiles += await materialize(item, destination, report);
    catalogById.set(item.id, item.catalog);
    indexById.set(item.id, {
      id: item.id, sourceId: item.sourceId, sourceNamespaceId: item.sourceNamespaceId,
      sourceRelativePath: item.sourceRelativePath, appearanceFingerprint: item.appearanceFingerprint,
      coreFingerprint: item.coreFingerprint, textureFingerprints: item.textureFingerprints, sharedCore: item.sharedCore,
    });
    report.imported++;
  }
  const nextCatalog = [...catalogById.values()];
  const nextIndex = [...indexById.values()].filter(entry => catalogById.has(entry.id)).sort((left, right) => left.id.localeCompare(right.id, 'en'));

  if (options.copySupportFiles !== false) {
    for (const [sourceFile, targetFile] of sourceOptions.supportFiles || []) {
      await atomicCopy(resolve(source, sourceFile), resolve(root, targetFile));
    }
  }
  await atomicWrite(indexPath, `${JSON.stringify({ version: 1, entries: nextIndex }, null, 2)}\n`);
  await atomicWrite(catalogPath, `${JSON.stringify(nextCatalog, null, 2)}\n`);
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const summary = { ...report, warnings: report.warnings.length, catalog: nextCatalog.length, copiedFiles };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

export function importImuncleCollection(value) {
  return importLive2dCollection(value, IMUNCLE_SOURCE);
}
