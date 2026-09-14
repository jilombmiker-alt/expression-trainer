import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const projectRoot = resolve(import.meta.dirname, '..');
const port = 4176;
const origin = `http://127.0.0.1:${port}`;
const chromePath = process.env.EXPRESSION_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const testData = await mkdtemp(resolve(tmpdir(), 'expression-e2e-'));
const server = spawn('python3', ['services/p0_service.py', '--port', String(port), '--web-dir', 'web'], {
  cwd: projectRoot,
  env: { ...process.env, PYTHONPYCACHEPREFIX: '/tmp/expression-e2e-pyc', EXPRESSION_DATA_DIR: testData },
  stdio: ['ignore', 'pipe', 'pipe']
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/speech/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('P0 test server did not start.');
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(`${origin}/knowledge-studio.html`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '使用示例' }).click();
  await page.getByRole('button', { name: '生成两轮训练' }).click();
  await page.locator('#preview-step').waitFor({ state: 'visible' });
  assert.match(await page.locator('#generation-boundary').innerText(), /来源|服务|生成/);
  await page.getByRole('button', { name: '进入表达训练' }).click();
  await page.waitForURL(/settings\.html.*required=1/);
  assert.equal(await page.getByRole('heading', { name: '模型接入' }).isVisible(), true);
  assert.match(await page.locator('#settings-reason').innerText(), /开始训练前/);
  await page.evaluate(() => sessionStorage.setItem('expression.modelConnection.v1', 'e2e-opaque-connection'));
  await page.goto(`${origin}/concept-editorial.html?source=knowledge&theme=v0&autostart=1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /开始计时阅读/ }).waitFor();

  const desktopLayout = await page.evaluate(() => ({
    overflow: getComputedStyle(document.body).overflow,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    pageOverflow: document.documentElement.scrollHeight > window.innerHeight
  }));
  assert.equal(desktopLayout.overflow, 'hidden');
  assert.equal(desktopLayout.horizontalOverflow, false);
  assert.equal(desktopLayout.pageOverflow, false);
  assert.deepEqual(consoleErrors, []);

  // Browser error-path acceptance, explicitly mocked: never send the fake BYOK token upstream.
  await page.route('**/api/training/assess', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'model_timeout', message: '测试模型暂时不可用', retryable: true } }) }));
  await page.getByRole('button', { name: /开始计时阅读/ }).click();
  await page.locator('#finish-reading').click();
  await page.locator('#transcript').fill('有效表达的核心是清楚说明观点，因为听众需要理解事实，所以要给出具体依据，最后需要明确下一步行动。');
  const draftText = await page.locator('#transcript').inputValue();
  await page.locator('#finish-retell').click();
  await page.getByText(/本次未记分；再次点击/).waitFor();
  assert.equal(await page.locator('#transcript').inputValue(), draftText);
  assert.equal(await page.locator('#finish-retell').isEnabled(), true);
  const frozen = await page.evaluate(() => JSON.parse(localStorage.getItem('expression.trainingDraft.v1')).submittedRequest);
  await page.locator('#finish-retell').click();
  await page.getByText(/本次未记分；再次点击/).waitFor();
  await page.waitForFunction(() => !document.getElementById('finish-retell').disabled);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('expression.trainingDraft.v1')).submittedRequest), frozen);
  const screenshot = resolve(testData, 'retell-retry.png');
  await page.screenshot({ path: screenshot });

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${origin}/knowledge-studio.html`, { waitUntil: 'networkidle' });
  const mobileLayout = await mobile.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    pageOverflow: document.documentElement.scrollHeight > window.innerHeight,
    generateVisible: Boolean(document.querySelector('#generate')?.getBoundingClientRect().height)
  }));
  assert.equal(mobileLayout.horizontalOverflow, false);
  assert.equal(mobileLayout.pageOverflow, false);
  assert.equal(mobileLayout.generateVisible, true);
  await context.close();
  console.log(JSON.stringify({ ok: true, desktopLayout, mobileLayout, retryPreservesAnswer: true, screenshot, modelMode: 'mocked-error-only' }));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
