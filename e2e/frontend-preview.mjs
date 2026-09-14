import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const origin = process.env.PREVIEW_TEST_ORIGIN || 'http://127.0.0.1:4185';
const server = process.env.PREVIEW_TEST_ORIGIN ? null : spawn('python3', ['main.py'], {
  cwd: resolve(root, '.private-deploy/vefaas-frontend-preview'), env: { ...process.env, PORT: '4185' }, stdio: 'ignore'
});
let browser;
const evidence = await mkdtemp(resolve(tmpdir(), 'expression-preview-'));
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* startup */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  assert.equal((await (await fetch(`${origin}/health`)).json()).mode, 'frontend-preview');
  assert.equal((await fetch(`${origin}/.env`)).status, 404);
  assert.equal((await fetch(`${origin}/api/training/records`)).status, 404);
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(); const errors = []; const apiRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /开始练习/ }).click();
  assert.match(page.url(), /concept-editorial/);
  await page.locator('#confirm-start').click();
  await page.locator('#start-timer').click();
  await page.locator('#finish-reading').click();
  await page.locator('#transcript').fill('随便乱说，完全没有任何内容。');
  await page.locator('#finish-retell').click();
  await page.locator('#next-round').waitFor();
  assert.match(await page.locator('.validity-failure').innerText(), /少于15秒/);
  assert.equal(await page.locator('#next-round').isDisabled(), true);
  await page.locator('#redo').click();
  const source = await page.locator('.reading-card > p').innerText();
  await page.locator('#start-timer').click();
  await page.locator('#finish-reading').click();
  await page.locator('#transcript').fill(`${source.slice(0, 80)}。这说明我们需要清楚理解事情的核心。`);
  // Real elapsed time; no forged timing or bypass of the product's validity gate.
  await new Promise((done) => setTimeout(done, 20000));
  await page.locator('#finish-retell').click();
  await page.locator('#next-round').click();
  await page.locator('#start-timer').click();
  await page.locator('#finish-reading').click();
  await page.locator('#transcript').fill('随便乱说，还是没有原文的内容。');
  await page.locator('#finish-retell').click();
  await page.locator('#view-growth').waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('frontend-preview:expression.progress.v1')));
  assert.equal(saved.records.length, 1); assert.equal(saved.records[0].score, 0);
  await page.locator('#view-growth').click();
  assert.match(await page.locator('.level-card').innerText(), /暂定/);
  await page.screenshot({ path: resolve(evidence, 'growth-desktop.png') });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#growth-nav').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('frontend-preview:expression.progress.v1')).records.length), 1);
  await page.goto(`${origin}/settings.html?theme=v0`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#api-key').isDisabled(), true);
  await page.locator('#data-settings-tab').click();
  assert.match(await page.locator('#data-settings').innerText(), /当前浏览器/);
  await page.goto(`${origin}/knowledge-studio.html`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '使用示例' }).click();
  await page.getByRole('button', { name: '生成两轮训练' }).click();
  await page.locator('#preview-step').waitFor({ state: 'visible' });
  assert.match(await page.locator('#generation-boundary').innerText(), /未调用 AI/);
  await page.getByRole('button', { name: '进入表达训练' }).click();
  await page.locator('#start-timer').waitFor();
  assert.match(page.url(), /source=knowledge/);
  const layouts = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const shape = await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth > innerWidth, vertical: document.documentElement.scrollHeight > innerHeight }));
    assert.equal(shape.horizontal, false); assert.equal(shape.vertical, false); layouts.push({ ...viewport, ...shape });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(evidence, 'reading-mobile.png') });
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
  console.log(JSON.stringify({ ok: true, origin, twoRounds: true, invalidZero: true, localPersistence: true, import: true, apiRequests: 0, layouts, evidence }));
} finally { await browser?.close(); server?.kill('SIGTERM'); }
