import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

const toPosixPath = value => value.split(sep).join('/').replaceAll('\\', '/');

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const path = value.trim().replaceAll('\\', '/');
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || win32.isAbsolute(path)) {
    throw new Error(`${label} must not be a protocol or absolute path: ${value}`);
  }
  return path;
}

/** Resolve a manifest resource without allowing it to leave the source root. */
export function resolveResourceReference(sourceRoot, manifestPath, reference) {
  const root = resolve(sourceRoot);
  const manifest = resolve(manifestPath);
  if (!isInside(root, manifest)) throw new Error(`Manifest is outside the source root: ${manifestPath}`);

  const normalizedReference = normalizeRelativePath(reference, 'Resource reference');
  const absolutePath = resolve(dirname(manifest), ...normalizedReference.split('/'));
  if (!isInside(root, absolutePath)) {
    throw new Error(`Resource reference leaves the source root: ${reference}`);
  }

  return {
    reference: normalizedReference,
    absolutePath,
    sourcePath: toPosixPath(relative(root, absolutePath)),
  };
}

/** Resolve an existing file and reject symlinks that escape the source root. */
export async function resolveExistingResourceReference(sourceRoot, manifestPath, reference) {
  const resource = resolveResourceReference(sourceRoot, manifestPath, reference);
  const root = await realpath(sourceRoot);
  const realPath = await realpath(resource.absolutePath);
  if (!isInside(root, realPath) || !(await stat(realPath)).isFile()) {
    throw new Error(`Resource is not a file inside the source root: ${reference}`);
  }
  return { ...resource, realPath };
}

/** Identify a Live2D manifest from its JSON structure, independent of its name. */
export function inspectModelManifest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const modern = data.FileReferences;
  if (modern && typeof modern === 'object' && typeof modern.Moc === 'string' && Array.isArray(modern.Textures)) {
    return { generation: 3, coreReference: modern.Moc, textureReferences: modern.Textures };
  }
  if (typeof data.model === 'string' && Array.isArray(data.textures)) {
    return { generation: 2, coreReference: data.model, textureReferences: data.textures };
  }
  return null;
}

async function jsonFiles(directory) {
  const found = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) found.push(path);
  }
  return found;
}

/** Parse one model manifest and validate all appearance-defining resources. */
export async function readModelManifest(sourceRoot, manifestPath, { prepareData } = {}) {
  const root = resolve(sourceRoot);
  const relativePath = toPosixPath(relative(root, resolve(manifestPath)));
  let data = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
  if (prepareData) data = await prepareData(data, { sourceRoot: root, manifestPath }) ?? data;
  const descriptor = inspectModelManifest(data);
  if (!descriptor) return null;
  if (!descriptor.textureReferences.length) throw new Error('Model manifest has no textures.');

  const core = await resolveExistingResourceReference(root, manifestPath, descriptor.coreReference);
  const textures = [];
  for (const reference of descriptor.textureReferences) {
    textures.push(await resolveExistingResourceReference(root, manifestPath, reference));
  }
  return {
    generation: descriptor.generation,
    sourceRoot: root,
    manifestPath: resolve(manifestPath),
    relativePath,
    data,
    core,
    textures,
  };
}

/** Recursively discover v2/v3 manifests and report bad candidates per file. */
export async function discoverModelManifests(sourceRoot, options = {}) {
  const root = resolve(sourceRoot);
  const manifests = [];
  const rejected = [];
  for (const manifestPath of await jsonFiles(root)) {
    try {
      const manifest = await readModelManifest(root, manifestPath, options);
      if (manifest) manifests.push(manifest);
    } catch (error) {
      rejected.push({
        file: toPosixPath(relative(root, manifestPath)),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { manifests, rejected };
}

function canonicalSourceIdentity(identity) {
  if (typeof identity !== 'string' || !identity.trim()) throw new Error('Source identity is required.');
  return identity.trim().replaceAll('\\', '/').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

/** Create a stable namespace from a repository URL or another persistent identity. */
export function createSourceNamespaceId(sourceIdentity) {
  const canonical = canonicalSourceIdentity(sourceIdentity);
  const stem = canonical.split('/').filter(Boolean).at(-1)?.replace(/[^a-z\d]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 32) || 'source';
  return `${stem}-${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
}

/** Create a stable character ID without allowing equal paths from different sources to collide. */
export function createCharacterId(sourceNamespaceId, relativeManifestPath) {
  const namespace = normalizeRelativePath(sourceNamespaceId, 'Source namespace').replaceAll('/', '-');
  const path = normalizeRelativePath(relativeManifestPath, 'Manifest path');
  return `${namespace}-${createHash('sha256').update(path).digest('hex').slice(0, 12)}`;
}

async function sha256File(sourceRoot, path, cache) {
  const root = await realpath(sourceRoot);
  const resource = await realpath(path);
  if (!isInside(root, resource) || !(await stat(resource)).isFile()) {
    throw new Error(`Resource is not a file inside the source root: ${path}`);
  }
  if (cache?.has(resource)) return cache.get(resource);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(resource)) hash.update(chunk);
  const fingerprint = hash.digest('hex');
  cache?.set(resource, fingerprint);
  return fingerprint;
}

/** Hash the core binary and the manifest-ordered texture content. */
export async function createAppearanceFingerprint(manifest, { fileHashCache } = {}) {
  if (!manifest?.sourceRoot || !manifest?.core?.absolutePath || !Array.isArray(manifest.textures)) {
    throw new Error('A discovered model manifest is required.');
  }
  const coreFingerprint = await sha256File(manifest.sourceRoot, manifest.core.absolutePath, fileHashCache);
  const textureFingerprints = [];
  for (const texture of manifest.textures) {
    textureFingerprints.push(await sha256File(manifest.sourceRoot, texture.absolutePath, fileHashCache));
  }
  const appearanceFingerprint = createHash('sha256')
    .update(JSON.stringify({ version: 1, core: coreFingerprint, textures: textureFingerprints }))
    .digest('hex');
  return { appearanceFingerprint, coreFingerprint, textureFingerprints };
}

function validatePlanEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id ||
      typeof entry.appearanceFingerprint !== 'string' || !entry.appearanceFingerprint ||
      typeof entry.coreFingerprint !== 'string' || !entry.coreFingerprint) {
    throw new Error('Import plan entries require id, appearanceFingerprint and coreFingerprint.');
  }
}

/** Plan deterministic incremental additions, including duplicates within this batch. */
export function planIncrementalImport(existing, candidates) {
  if (!Array.isArray(existing) || !Array.isArray(candidates)) throw new Error('Import plan inputs must be arrays.');
  const appearances = new Map();
  const cores = new Map();
  for (const entry of existing) {
    validatePlanEntry(entry);
    appearances.set(entry.appearanceFingerprint, entry);
    const owners = cores.get(entry.coreFingerprint) || [];
    owners.push(entry);
    cores.set(entry.coreFingerprint, owners);
  }

  const imports = [];
  const duplicates = [];
  for (const candidate of candidates) {
    validatePlanEntry(candidate);
    const duplicate = appearances.get(candidate.appearanceFingerprint);
    if (duplicate) {
      duplicates.push({ ...candidate, duplicateOf: duplicate.id });
      continue;
    }

    const shared = cores.get(candidate.coreFingerprint)?.find(entry => entry.id !== candidate.id);
    const planned = { ...candidate, sharedCore: shared?.id ?? null };
    imports.push(planned);
    appearances.set(candidate.appearanceFingerprint, planned);
    const owners = cores.get(candidate.coreFingerprint) || [];
    owners.push(planned);
    cores.set(candidate.coreFingerprint, owners);
  }
  return { imports, duplicates };
}
