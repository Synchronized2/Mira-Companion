import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const catalog = JSON.parse(await readFile('shared/characters.json', 'utf8'));
const character = catalog.find(item => item.name === 'nepgear_extra');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(30000);
  await page.addInitScript(id => localStorage.setItem('mira-preferences', JSON.stringify({ character: id, ttsVersion: 2, speech: 'edge', voice: 'zh-CN-XiaoxiaoNeural' })), character.id);
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5180');
  const stage = page.locator('.stage .avatar');
  await stage.locator('xpath=self::*[@data-ready="true"]').waitFor();
  await page.getByRole('button', { name: '全身视角', exact: true }).click();
  await page.waitForTimeout(500);
  const full = await bounds(stage);
  assert.ok(full.top < 0.2 && full.bottom < 0.99 && full.coverage > 0.3, JSON.stringify(full));
  assert.ok(full.aspect > 0.3 && full.aspect < 0.65, `Distorted full-body silhouette: ${JSON.stringify(full)}`);
  await page.screenshot({ path: 'artifacts/nepgear-stage-fixed.png' });
  await page.getByRole('button', { name: '半身视角', exact: true }).click();
  await page.waitForTimeout(250);
  assert.ok((await bounds(stage)).top < 0.25, 'Portrait must keep the head in the upper part of the stage');
  await page.getByRole('button', { name: '连接与偏好设置', exact: true }).click();
  const preview = page.frameLocator('.character-live-preview iframe').locator('.avatar');
  await preview.locator('xpath=self::*[@data-ready="true"]').waitFor();
  await page.waitForTimeout(300);
  const small = await bounds(preview);
  assert.ok(small.top < 0.2 && small.bottom < 0.99 && small.coverage > 0.3, JSON.stringify(small));
  assert.ok(Math.abs(small.aspect / full.aspect - 1) < 0.2, `Preview/stage proportions differ: ${JSON.stringify({ small, full })}`);
  await page.screenshot({ path: 'artifacts/nepgear-preview-fixed.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  const mobile = await bounds(preview);
  assert.ok(mobile.top < 0.2 && mobile.bottom < 0.99, JSON.stringify(mobile));
  assert.ok(Math.abs(mobile.aspect / full.aspect - 1) < 0.2, 'Mobile preview changed the character proportions');
  await page.screenshot({ path: 'artifacts/nepgear-mobile-fixed.png', fullPage: true });
  console.log('Framing passed: nepgear_extra proportions and placement in full-body, portrait, preview and mobile.', { full, small, mobile });
} finally { await browser.close(); }
async function bounds(avatar) {
  return avatar.locator('canvas').evaluate(canvas => {
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    let left = copy.width, top = copy.height, right = 0, bottom = 0;
    for (let y = 0; y < copy.height; y += 2) for (let x = 0; x < copy.width; x += 2) {
      if (data[(y * copy.width + x) * 4 + 3] < 80) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    return { top: top / copy.height, bottom: bottom / copy.height, aspect: (right - left) / (bottom - top), coverage: (bottom - top) / copy.height };
  });
}
