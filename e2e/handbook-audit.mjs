import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const folder = await mkdtemp(resolve(tmpdir(), 'expression-handbook-'));
const port = 4187;
const server = spawn('python3', ['services/p0_service.py', '--port', String(port), '--web-dir', 'web'], { cwd: root, env: { ...process.env, EXPRESSION_DATA_DIR: folder, PYTHONPYCACHEPREFIX: '/tmp/expression-pyc' }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/speech/health`)).ok) break; } catch { /* wait for local server */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const reports = [];
  for (const width of [390, 768, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const capture = async (view) => {
      const metrics = await page.evaluate(() => {
        const visible = (el) => el.getBoundingClientRect().width && el.getBoundingClientRect().height && getComputedStyle(el).visibility !== 'hidden';
        const controls = [...document.querySelectorAll('button,input,select,a')].filter(visible);
        return { pageOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          smallControls: controls.filter((el) => el.getBoundingClientRect().height < 43.9 && !el.classList.contains('skip-link')).map((el) => el.id || el.className),
          smallestText: Math.min(...[...document.querySelectorAll('p,button,label,small')].filter(visible).map((el) => parseFloat(getComputedStyle(el).fontSize))) };
      });
      const screenshot = resolve(folder, `${width}-${view}.png`);
      await page.screenshot({ path: screenshot }); reports.push({ width, view, ...metrics, screenshot });
      assert.equal(metrics.pageOverflow, false, `${width} ${view}: page overflow`);
      assert.deepEqual(metrics.smallControls, [], `${width} ${view}: undersized controls`);
    };
    for (const view of ['selection', 'reading', 'retell', 'plans', 'growth', 'settings', 'data']) {
      await page.goto(`http://127.0.0.1:${port}/${view === 'settings' ? 'settings.html' : 'concept-editorial.html'}?theme=v0`, { waitUntil: 'networkidle' });
      if (view === 'retell' || view === 'reading') {
        await page.evaluate(() => sessionStorage.setItem('expression.modelConnection.v1', 'audit-no-model-call'));
        await page.goto(`http://127.0.0.1:${port}/concept-editorial.html?theme=v0&autostart=1`);
        await page.locator('#start-timer').click();
        if (view === 'retell') await page.locator('#finish-reading').click();
      }
      if (view === 'plans') await page.locator('#plans-nav').click();
      if (view === 'growth') await page.locator('#growth-nav').click();
      if (view === 'data') {
        await page.goto(`http://127.0.0.1:${port}/settings.html?section=data&theme=v0`, { waitUntil: 'networkidle' });
        await page.getByText(/已同步服务端记录|还没有训练记录/).waitFor();
        assert.equal(await page.locator('#analytics-consent').isChecked(), false);
        await page.locator('#analytics-consent').check();
        await page.getByText('已开启，返回训练后生效。').waitFor();
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('#analytics-consent').isChecked(), true);
        await page.locator('#analytics-consent').uncheck();
        await page.getByText('已关闭，后续可选事件将被服务器拒绝。').waitFor();
        await capture('data-synced');
        await page.route('**/api/analytics/summary*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'test_unavailable', message: '统计服务暂时不可用', retryable: true } }) }));
        await page.locator('#refresh-data').click();
        await page.getByText(/读取失败：统计服务暂时不可用/).waitFor();
        assert.equal(await page.locator('#data-metrics').isVisible(), false);
        await capture('data-error');
        await page.unroute('**/api/analytics/summary*'); await page.locator('#refresh-data').click();
        await page.getByText(/已同步服务端记录/).waitFor();
        const emptyPage = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
        await emptyPage.goto(`http://127.0.0.1:${port}/settings.html?section=data&theme=programa`, { waitUntil: 'networkidle' });
        await emptyPage.getByText(/还没有训练记录/).waitFor();
        assert.equal(await emptyPage.locator('#data-metrics').isVisible(), false);
        await emptyPage.screenshot({ path: resolve(folder, `${width}-data-empty-programa.png`) });
        await emptyPage.close();
      }
      await capture(view);
      if (view === 'retell') {
        await page.locator('#open-mic-check').click();
        await page.locator('#mic-check-title').waitFor();
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => !!document.activeElement.closest('#mic-check-dialog')), true);
        }
        await capture('microphone-dialog');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#open-mic-check').evaluate((el) => el === document.activeElement), true);
        if (width <= 900) await page.locator('.panel-picker select').selectOption('1');
        await page.locator('#transcript').fill('浏览器验收草稿，切换面板不应该清空。');
        await page.locator('#finish-retell').click({ trial: true });
        await capture('transcript');
        if (width <= 900) { await page.locator('.panel-picker select').selectOption('0'); await page.locator('.panel-picker select').selectOption('1'); }
        assert.match(await page.locator('#transcript').inputValue(), /不应该清空/);
        // UI-only fixtures below: not an actual model result or a persisted grade.
        await page.evaluate(() => {
          window.TrainingAPI.start = async (_training, _round, _mode, id) => ({ id });
          window.TrainingAPI.assess = async (request) => {
            const draft = JSON.parse(localStorage.getItem('expression.trainingDraft.v1'));
            const index = draft.step === 2 ? 0 : 1; const round = index === 0 ? 'first' : 'second';
            const item = window.WizardContent.SETS.find((set) => set.id === draft.scene).rounds[index];
            const text = item.central + item.text;
            const oral = window.ExpressionAnalyzer.analyze(text); const content = window.WizardContent.evaluate(item, text);
            const result = { oral, content, transcript: request.transcript, elapsed: 100, pace: 140, pauses: [0.8], averagePause: 0.8, longestPause: 0.8 };
            result.scoring = window.ExpressionScoring.calculate(round, result, item, window.ExpressionScoring.DEFAULT_WEIGHTS[round]);
            result.scoring.invalid = false; result.scoring.provisional = true;
            result.baselineScoring = result.scoring; result.assessment = { mode: 'demo', boundary: 'UI fixture only' }; return result;
          };
        });
        await page.locator('#finish-retell').click();
        await page.locator('#next-round').waitFor();
        await capture('analysis-coach');
        if (width <= 900) {
          await page.locator('[data-analysis-panel="coach"] .panel-picker select').selectOption('1'); await capture('analysis-evidence');
          await page.locator('[data-analysis-panel="coach"] .panel-picker select').selectOption('2');
        }
        await page.locator('#guided-retry').click({ trial: true });
        await page.locator('[data-analysis-tab="overview"]').click();
        assert.equal(await page.locator('.score-breakdown > div:visible').count(), 7);
        await capture('analysis-scores');
        await page.locator('[data-analysis-tab="detail"]').click();
        if (width <= 900) await page.locator('[data-analysis-panel="detail"] .panel-picker select').selectOption('1');
        assert.equal(await page.locator('.content-card').isVisible(), true); await capture('analysis-content');
        await page.locator('#next-round').click(); await capture('second-reading');
        await page.locator('#start-timer').click(); await page.locator('#finish-reading').click();
        if (width <= 900) await page.locator('.panel-picker select').selectOption('1');
        await page.locator('#transcript').fill('第二轮界面测试，只用于验证交互，不是真实模型结果。');
        await page.locator('#finish-retell').click(); await page.locator('.final-layout').waitFor();
        await capture('final');
        if (width <= 900) { await page.locator('.panel-picker select').selectOption('1'); await capture('final-memory'); await page.locator('.panel-picker select').selectOption('2'); }
        await page.locator('#restart').click(); await page.locator('#category-select').waitFor();
      }
      if (view === 'plans') {
        await page.locator('#plan-maintenance').selectOption('structureLogic');
        await page.locator('#ratio-maintenance').fill('15');
        await page.locator('#save-plan').click({ trial: true });
        if (width <= 900) await page.locator('.panel-picker select').selectOption('1');
        await page.locator('#new-plan').click({ trial: true });
        await capture('plans-library');
        await page.locator('#start-exam').click(); await capture('exam');
      }
      if (view === 'growth' && width <= 900) { await page.locator('.panel-picker select').selectOption('2'); await capture('growth-trend'); }
    }
    await page.close();
  }
  await writeFile(resolve(folder, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ folder, reports }));
} finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
