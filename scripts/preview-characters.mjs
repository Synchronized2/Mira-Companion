import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(resolve(root, 'shared/characters.json'), 'utf8'));
const args = process.argv.slice(2);
let sourceId;
let query;
let layoutsOnly = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--source') {
    sourceId = args[++index];
    if (!sourceId) throw new Error('--source requires a source ID.');
  } else if (args[index] === '--layouts') layoutsOnly = true;
  else if (!query) query = args[index];
  else throw new Error(`Unexpected argument: ${args[index]}`);
}
const destination = resolve(root, 'public/assets/character-previews');
await mkdir(destination, { recursive: true });
await mkdir(resolve(root, 'artifacts'), { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const targeted = Boolean(sourceId || query || layoutsOnly);
const reportPath = resolve(root, 'artifacts', targeted ? 'character-render-recheck.json' : 'character-render-report.json');
const page = await browser.newPage({ viewport: { width: 320, height: 400 }, deviceScaleFactor: 1 });
let errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  for (const [index, character] of catalog.entries()) {
    if (sourceId && character.sourceId !== sourceId) continue;
    if (layoutsOnly) {
      const manifest = JSON.parse(await readFile(resolve(root, 'public', decodeURIComponent(character.url.slice(1))), 'utf8'));
      if (!manifest.layout && !manifest.Layout) continue;
    } else if (query && !character.name.toLowerCase().includes(query.toLowerCase())) continue;
    errors = [];
    try {
      await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5180'}/?character-preview=${character.id}`);
      await page.waitForFunction(() => document.querySelector('.avatar[data-ready="true"]') || document.querySelector('.avatar [role="alert"]'), null, { timeout: 30000 });
      const failure = await page.locator('.avatar [role="alert"]').allTextContents();
      if (failure.length) throw new Error(failure.join(' '));
      await page.waitForTimeout(450);
      const rendered = await page.locator('.avatar canvas').evaluate(canvas => {
        const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
        const context = copy.getContext('2d'); context.drawImage(canvas, 0, 0);
        const { data } = context.getImageData(0, 0, copy.width, copy.height);
        let opaque = 0; const colors = new Set();
        for (let i = 0; i < data.length; i += 16) if (data[i + 3] > 60) { opaque++; colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`); }
        return { opaque, colors: colors.size };
      });
      if (rendered.opaque < 100 || rendered.colors < 15) throw new Error(`Blank rendering: ${JSON.stringify(rendered)}`);
      if (errors.length) throw new Error(errors.join('; '));
      await page.locator('.avatar canvas').screenshot({ path: resolve(destination, `${character.id}.png`), omitBackground: true });
      results.push({ id: character.id, name: character.name, ok: true, ...rendered });
    } catch (error) { results.push({ id: character.id, name: character.name, ok: false, error: error.message, errors }); }
    console.log(`${index + 1}/${catalog.length} ${character.name}: ${results.at(-1).ok ? 'OK' : results.at(-1).error}`);
    await writeFile(reportPath, JSON.stringify(results, null, 2));
  }
} finally { await browser.close(); }
console.log(`Rendered ${results.filter(result => result.ok).length}/${results.length}`);
if (targeted) {
  const fullReport = resolve(root, 'artifacts/character-render-report.json');
  let previous = [];
  try { previous = JSON.parse(await readFile(fullReport, 'utf8')); } catch { /* First run may be a targeted check. */ }
  const merged = new Map(previous.map(result => [result.id, result]));
  for (const result of results) merged.set(result.id, result);
  await writeFile(fullReport, JSON.stringify(catalog.map(character => merged.get(character.id)).filter(Boolean), null, 2));
}
if (results.some(result => !result.ok)) process.exitCode = 1;
