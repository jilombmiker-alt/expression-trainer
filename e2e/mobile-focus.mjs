import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
const root = resolve(import.meta.dirname, '..');
const origin = process.env.PREVIEW_TEST_ORIGIN || 'http://127.0.0.1:4187';
const server = process.env.PREVIEW_TEST_ORIGIN ? null : spawn('python3', ['main.py'], { cwd: resolve(root, '.private-deploy/vefaas-frontend-preview'), env: { ...process.env, PORT: '4187' }, stdio: 'ignore' });
const evidence = await mkdtemp(resolve(tmpdir(), 'expression-mobile-v2-'));
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* startup */ } await new Promise((done) => setTimeout(done, 250)); }
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 640 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin); assert.match(await page.title(), /表达训练器/);
  await page.screenshot({ path: resolve(evidence, 'welcome.png') });
  await page.getByRole('link', { name: /开始练习/ }).click();
  await page.screenshot({ path: resolve(evidence, 'selection.png') });
  for (const selector of ['#category-select', '#topic-select', '#confirm-start', '.import-guide']) {
    const bounds = await page.locator(selector).boundingBox();
    assert.ok(bounds.y >= 48 && bounds.y + bounds.height <= 600, `${selector} must be fully visible`);
  }
  await page.locator('#confirm-start').click();
  const paragraph = await page.locator('.reading-card > p').boundingBox();
  assert.ok(paragraph.height >= 180, `Article has only ${paragraph.height}px`);
  const controls = await page.locator('.reading-control').boundingBox();
  assert.ok(controls.height <= 64, 'Timer controls should be a compact toolbar');
  assert.ok(await page.locator('#countdown').isVisible());
  assert.deepEqual(await page.locator('#duration option').evaluateAll((options) => options.map((option) => Number(option.value))), [30,60,90,120,150,180,210,240,300]);
  await page.locator('#duration').selectOption('30');
  assert.equal(await page.locator('#countdown').textContent(), '00:30');
  await page.screenshot({ path: resolve(evidence, 'reading.png') });
  await page.locator('#start-timer').click();
  await page.locator('#record').waitFor({timeout:35000});
  const answer = await page.locator('#transcript').boundingBox();
  await page.screenshot({ path: resolve(evidence, 'retell.png') });
  console.log(JSON.stringify({ evidence, answer, voice: await page.locator('.voice-card').boundingBox(), retell: await page.locator('.retell-layout').boundingBox() }));
  assert.ok(answer.height >= 130, `Answer has only ${answer.height}px`);
  assert.ok(await page.locator('#record').isVisible());
  await page.screenshot({ path: resolve(evidence, 'retell.png') });
  await page.evaluate(() => {
    // Explicit failure simulation; never claims real device ASR acceptance.
    window.mockRecognitionStarts = 0;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    window.SpeechRecognition = class {
      start() { window.mockRecognitionStarts++; setTimeout(() => { this.onerror?.({ error: 'network' }); this.onend?.(); }, 0); }
      stop() { this.onend?.(); }
    };
  });
  await page.locator('#record').click();
  await page.getByText('浏览器未能连接识别服务').waitFor();
  await new Promise((done) => setTimeout(done, 2000));
  assert.equal(await page.evaluate(() => window.mockRecognitionStarts), 1);
  await page.locator('#keyboard-input').click();
  await page.locator('#transcript').fill('这段内容的核心观点是先理解，再清楚地表达。');
  await page.screenshot({ path: resolve(evidence, 'speech-fallback.png') });
  await page.evaluate(() => {
    // Native callback contract simulation, not a real microphone/phone test.
    window.ExpressionNativeSpeech = {
      available: true,
      start(session) {
        window.nativeTestSession = session;
        const send = (type, text = '') => window.dispatchEvent(new CustomEvent('expression:native-speech', { detail: { session, type, text } }));
        send('ready'); send('partial', '系统识别测试'); send('ended'); send('result', '系统识别测试。');
      }, stop() {}, cancel() {},
    };
    window.dispatchEvent(new Event('expression:native-ready'));
  });
  await page.locator('#record').click();
  assert.match(await page.locator('#transcript').inputValue(), /这段内容.*系统识别测试。/);
  await page.getByText('本段识别完成，请核对文字').waitFor();
  await page.goto(`${origin}/knowledge-studio.html`);
  assert.equal(await page.locator('#duration option').count(), 9);
  assert.ok((await page.locator('#source').boundingBox()).height >= 130);
  const generate = await page.locator('#generate').boundingBox();
  assert.ok(generate.y + generate.height <= 610);
  await page.screenshot({ path: resolve(evidence, 'import.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, origin, paragraphHeight: paragraph.height, answerHeight: answer.height, timerHeight: controls.height, visibleSelectionControls: true, mockedNetworkErrorStopsRetries: true, evidence, realMicrophoneTested: false }));
} finally { await browser?.close(); server?.kill('SIGTERM'); }
