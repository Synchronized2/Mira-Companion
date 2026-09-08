import { importImuncleCollection } from './characters/import-imuncle.mjs';

const args = process.argv.slice(2);
let sourcePath;
let projectRoot;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--project-root') {
    projectRoot = args[++index];
    if (!projectRoot) throw new Error('--project-root requires a path.');
  } else if (!sourcePath) sourcePath = args[index];
  else throw new Error(`Unexpected argument: ${args[index]}`);
}

await importImuncleCollection({ sourcePath, projectRoot });
