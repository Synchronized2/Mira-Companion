import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const characters = JSON.parse(await readFile('shared/characters.json', 'utf8'));
const legacy = characters.find(item => item.name === 'miku');
const modern = characters.find(item => item.name === 'Zara');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const failures = [];
page.setDefaultTimeout(15000);
page.on('pageerror', error => failures.push(error.message));
const url = process.env.TEST_URL || 'http://127.0.0.1:5180';
const stage = page.locator('.stage .avatar');
const dialog = page.locator('dialog[open]');
const preview = dialog.frameLocator('.character-live-preview iframe').locator('.avatar');
async function ready(locator, id) {
  await locator.locator(`xpath=self::*[@data-ready="true" and @data-character="${id}"]`).waitFor({ timeout: 30000 });
}
async function visibleCanvas(locator) {
  const pixels = await locator.locator('canvas').evaluate(canvas => {
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 64) if (data[i] > 80) count++;
    return count;
  });
  assert.ok(pixels > 100, `Canvas is blank: ${pixels}`);
}
async function choose(character) {
  console.log('Preview', character.name);
  await dialog.getByLabel('搜索形象').fill(character.name);
  await dialog.locator(`[data-character-option="${character.id}"]`).click();
  await ready(preview, character.id);
}
try {
  await mkdir('artifacts', { recursive: true });
  await page.goto(url);
  await ready(stage, 'hiyori');
  console.log('Stage ready');
  await page.getByRole('button', { name: '连接与偏好设置', exact: true }).click();
  await ready(preview, 'hiyori');
  console.log('Settings preview ready');
  assert.equal(await dialog.locator('.character-card').count(), characters.length);
  await choose(legacy);
  assert.equal(await stage.getAttribute('data-character'), 'hiyori', 'Preview must not apply prematurely');
  await dialog.getByRole('button', { name: '使用此形象' }).click();
  await ready(stage, legacy.id);
  await dialog.getByRole('button', { name: '试试动作' }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForTimeout(200);
  await visibleCanvas(stage); // Closing the shared-texture preview must not destroy the stage.
  await page.reload();
  await ready(stage, legacy.id);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mira-preferences')));
  assert.equal(saved.character, legacy.id);
  assert.equal(saved.voice, 'zh-CN-XiaoxiaoNeural');
  assert.equal(saved.speech, 'edge');
  await page.getByRole('button', { name: '连接与偏好设置', exact: true }).click();
  await choose(modern);
  await dialog.getByRole('button', { name: '使用此形象' }).click();
  await ready(stage, modern.id);
  await dialog.getByLabel('搜索形象').fill('no-such-character-xyz');
  assert.equal(await dialog.locator('.character-card').count(), 0);
  await dialog.getByLabel('搜索形象').fill('');
  await dialog.getByLabel('形象分类').selectOption('碧蓝航线');
  assert.equal(await dialog.locator('.character-card').count(), characters.filter(item => item.family === '碧蓝航线').length);
  await dialog.getByLabel('形象分类').selectOption('全部');
  // Exercise overlapping asynchronous loads and shared textures across outfits.
  for (const item of characters.slice(1, 9)) await dialog.locator(`[data-character-option="${item.id}"]`).click();
  await ready(preview, characters[8].id);
  await page.waitForTimeout(500);
  await visibleCanvas(stage);
  await visibleCanvas(preview);
  // A load failure must be visible and recoverable without changing the applied character.
  await page.route(`**${legacy.url}`, route => route.abort());
  await chooseFailure();
  await page.unroute(`**${legacy.url}`);
  await preview.getByRole('button', { name: '重试' }).click();
  await ready(preview, legacy.id);
  assert.equal(await stage.getAttribute('data-character'), modern.id);
  await dialog.getByLabel('搜索形象').fill('');
  await dialog.locator('[data-character-option="hiyori"]').click();
  await ready(preview, 'hiyori');
  await dialog.getByRole('button', { name: '使用此形象' }).click();
  await ready(stage, 'hiyori');
  await dialog.locator('.dialog-body').evaluate(element => { element.scrollTop = 0; });
  await page.waitForTimeout(500);
  await visibleCanvas(preview);
  await visibleCanvas(stage);
  await page.screenshot({ path: 'artifacts/character-settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/character-settings-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.character-live-preview iframe').count(), 0);
  await visibleCanvas(stage);
  await page.evaluate(() => localStorage.setItem('mira-preferences', JSON.stringify({ ...JSON.parse(localStorage.getItem('mira-preferences')), character: 'deleted-id' })));
  await page.reload(); await ready(stage, 'hiyori');
  assert.deepEqual(failures, []);
  console.log('Character UI passed: legacy/modern, preview/apply, persistence, TTS preservation, rapid switching, retry, mobile, unknown ID fallback.');
} finally { await browser.close(); }
async function chooseFailure() {
  await dialog.getByLabel('搜索形象').fill(legacy.name);
  await dialog.locator(`[data-character-option="${legacy.id}"]`).click();
  await preview.getByRole('alert').waitFor({ timeout: 30000 });
  assert.equal(await dialog.getByRole('button', { name: '使用此形象' }).isDisabled(), true);
}
