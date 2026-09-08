import { importLive2dCollection } from './import-imuncle.mjs';

const HACXY_SOURCE = {
  id: 'hacxy-l2d-models',
  identity: 'https://github.com/hacxy/l2d-models',
  reportFile: 'hacxy-l2d-models-import-report.json',
  exclusionsFile: 'hacxy-character-exclusions.json',
  supportFiles: [
    ['README.md', 'licenses/hacxy-l2d-models-README.md'],
  ],
};

export function importHacxyCollection(value) {
  return importLive2dCollection(value, HACXY_SOURCE);
}
