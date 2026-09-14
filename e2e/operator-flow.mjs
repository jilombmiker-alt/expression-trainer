import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const folder = await mkdtemp(resolve(tmpdir(), 'expression-operator-'));
const secret = randomBytes(32).toString('hex'); // Ephemeral test server only, never printed or saved.
const port = 4188;
const server = spawn('python3', ['services/p0_service.py', '--port', String(port), '--web-dir', 'web'], {
  cwd: root, env: { ...process.env, EXPRESSION_ENV: 'development', EXPRESSION_SECURE_COOKIE: 'false', EXPRESSION_DATA_DIR: folder, EXPRESSION_ADMIN_TOKEN: secret }, stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/speech/health`)).ok) break; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(`http://127.0.0.1:${port}/settings.html?section=operator&theme=v0`);
    await page.locator('#operator-login').waitFor({ state: 'visible' });
    await page.locator('#operator-code').fill('not-a-real-code'); await page.locator('#operator-submit').click();
    await page.getByText('无法进入后台：管理员访问码不正确。').waitFor();
    assert.equal(await page.locator('#operator-code').inputValue(), '');
    await page.locator('#operator-code').fill(secret); await page.locator('#operator-submit').click();
    await page.locator('#operator-details').waitFor({ state: 'visible' });
    assert.match(await page.locator('#operator-events').innerText(), /已知 Token 用量：未知/);
    assert.equal(await page.locator('.privacy-control').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(folder, `${width}-operator.png`) });
    const outsider = await browser.newContext(); const other = await outsider.newPage();
    await other.goto(`http://127.0.0.1:${port}/settings.html?section=operator`);
    await other.locator('#operator-login').waitFor({ state: 'visible' }); await outsider.close();
    await page.locator('#operator-logout').click(); await page.locator('#operator-login').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#operator-details').isVisible(), false);
    await page.locator('#data-scope').selectOption('personal');
    await page.getByText('还没有训练记录。开始并完成训练后，这里会显示真实结果。').waitFor();
    assert.equal(await page.locator('.privacy-control').isVisible(), true);
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, folder, checks: ['admin login', 'bad credentials', 'logout', 'session isolation', 'personal scope', '390 and 1280 fixed viewport'] }));
} finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
