import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const folder = await mkdtemp(resolve(tmpdir(), 'expression-sponsored-'));
const port = 4189;
const origin = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString('hex');
const testKey = 'sk-test-only-never-call-upstream';
const server = spawn('python3', ['services/p0_service.py', '--port', String(port), '--web-dir', 'web'], {
  cwd: root, env: { ...process.env, EXPRESSION_ENV: 'development', EXPRESSION_SECURE_COOKIE: 'false', EXPRESSION_DATA_DIR: folder,
    EXPRESSION_MODEL_MODE: 'sponsored', EXPRESSION_BETA_PASSWORD: password, EXPRESSION_LLM_PROVIDER: 'deepseek',
    EXPRESSION_LLM_MODEL: 'deepseek-chat', EXPRESSION_LLM_API_KEY: testKey }, stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${origin}/api/semantic/health`)).status === 401) break; } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal((await fetch(`${origin}/concept-editorial.html`)).status, 401);
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, httpCredentials: { username: 'beta', password } });
    const page = await context.newPage();
    // Never call a real model in this routing test, even if an unexpected UI path submits.
    await page.route('**/api/training/assess', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'test_only', message: 'UI 测试不调用模型', retryable: true } }) }));
    await page.route('**/api/semantic/evaluate', (route) => route.abort());
    await page.goto(`${origin}/knowledge-studio.html`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '使用示例' }).click();
    await page.getByRole('button', { name: '生成两轮训练' }).click();
    await page.locator('#preview-step').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '进入表达训练' }).click();
    await page.locator('#start-timer').waitFor({ state: 'visible' });
    assert.match(page.url(), /concept-editorial/);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('expression.modelConnection.v1')), null);
    assert.equal((await page.content()).includes(testKey), false);
    await page.locator('#start-timer').click(); await page.locator('#finish-reading').click();
    await page.locator('#record').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
    await page.screenshot({ path: resolve(folder, `${width}-sponsored-retell.png`) });
    await page.goto(`${origin}/settings.html?theme=v0`);
    await page.getByText('内测模型已接入', { exact: true }).waitFor();
    assert.equal(await page.locator('#api-key').isVisible(), false);
    assert.equal(await page.locator('#connect').isVisible(), false);
    assert.equal((await page.content()).includes(testKey), false);
    await context.close();
  }
  console.log(JSON.stringify({ passed: true, folder, boundary: '真实内测门禁和路由；无真实模型调用、无麦克风验收' }));
} finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
