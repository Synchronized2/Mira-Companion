import { importImuncleCollection } from './characters/import-imuncle.mjs';
import { importHacxyCollection } from './characters/import-hacxy.mjs';

const args = process.argv.slice(2);
let sourcePath;
let projectRoot;
let sourceId = 'imuncle';
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--project-root') {
    projectRoot = args[++index];
    if (!projectRoot) throw new Error('--project-root requires a path.');
  } else if (args[index] === '--source') {
    sourceId = args[++index];
    if (!sourceId) throw new Error('--source requires a source name.');
  } else if (!sourcePath) sourcePath = args[index];
  else throw new Error(`Unexpected argument: ${args[index]}`);
}

const importers = { imuncle: importImuncleCollection, hacxy: importHacxyCollection };
const importer = importers[sourceId];
if (!importer) throw new Error(`Unknown source: ${sourceId}. Expected one of: ${Object.keys(importers).join(', ')}`);
await importer({ sourcePath, projectRoot });
