import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 5180);
const mode = process.argv.includes('--api-only')
  ? 'api-only'
  : process.argv.includes('--production') ? 'production' : 'development';
const app = await createApp({ root, port, mode });

app.listen(port, host, () => console.log(`Mira Companion: http://${host}:${port}`))
  .on('error', error => { console.error(error.message); process.exit(1); });
