import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';
const web = resolve('.private-deploy/vefaas-frontend-preview/web');
const server = createServer(async (req,res)=>{
  const file = resolve(web, '.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(web+'/')) {res.writeHead(404).end();return;}
  try {const body=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)] || 'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const passed = [];
try {
  const context = await browser.newContext({ permissions:['microphone'] });
  const page = await context.newPage(); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  let healthCalls=0; let submits=0; let fail=true; let empty=false;
  await page.route('**/api/speech/health', r=>r.fulfill({json: {available: ++healthCalls > 1, engine:'volcano',capabilities:['post_recording_transcription']}}));
  await page.route('**/api/speech/transcribe?*', async r=>{
    submits++;
    assert.ok(r.request().postDataBuffer().length>0);
    if(fail) return r.fulfill({status:502,json:{error:{message:'测试网络中断'}}});
    return r.fulfill({json:{text:empty?'':'第一点，表达需要观点和理由。',engine:'volcano',durationMs:6000,pauses:[],needsConfirmation:true,warning:'请核对文字。',pauseMeasurement:{method:'pcm-energy-v1',available:true,intervals:[{startMs:1000,endMs:1800,durationMs:800},{startMs:3000,endMs:4500,durationMs:1500}]}}});
  });
  await page.goto(origin+'/welcome.html'); await page.getByRole('link',{name:/开始练习/}).click();
  await page.locator('#confirm-start').click(); await page.locator('#start-timer').click(); await page.locator('#finish-reading').click();
  await page.evaluate(()=>{
    window.nativeStarts=0;
    window.ExpressionNativeSpeech={available:true,start(){window.nativeStarts++;},stop(){},cancel(){}};
    window.dispatchEvent(new Event('expression:native-ready'));
  });
  await page.locator('#transcript').fill('已有的第一段不能丢失。');
  await page.locator('#record').click(); await page.waitForTimeout(650);
  assert.equal(await page.evaluate(()=>window.nativeStarts),0);
  assert.ok(healthCalls>=2); passed.push('temporary health failure recovers; cloud outranks native');
  await page.locator('#record').click(); await page.locator('#retry-audio').waitFor({state:'visible'});
  assert.equal(await page.locator('#transcript').inputValue(),'已有的第一段不能丢失。');
  fail=false; await page.locator('#retry-audio').click(); await page.getByText('高精度转录完成',{exact:true}).waitFor();
  assert.equal(submits,2); assert.match(await page.locator('#transcript').inputValue(),/^已有的第一段不能丢失。\n第一点/);
  passed.push('failed upload retains audio; manual retry appends without losing text');
  await page.locator('#record').click(); await page.waitForTimeout(650); await page.locator('#record').click(); await page.getByText('高精度转录完成',{exact:true}).waitFor();
  assert.equal((await page.locator('#transcript').inputValue()).split('第一点').length-1,2);
  passed.push('second recording appends to first');
  empty=true; const previous=await page.locator('#transcript').inputValue();
  await page.locator('#record').click(); await page.waitForTimeout(650); await page.locator('#record').click(); await page.getByText('这次识别没有完成',{exact:true}).waitFor();
  assert.equal(await page.locator('#transcript').inputValue(),previous); passed.push('empty ASR result is failure and preserves text');
  await page.locator('#record').click(); await page.waitForTimeout(350);
  const beforeCancel=submits; await page.locator('#keyboard-input').click(); await page.waitForTimeout(350);
  assert.equal(await page.locator('#record').getAttribute('aria-pressed'),'false'); assert.equal(submits,beforeCancel);
  passed.push('switching to text stops recording without submitting cancelled audio');
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});
  await page.locator('#record').click(); await page.getByText('没有获得麦克风权限',{exact:true}).waitFor();
  assert.equal(await page.locator('#record').isDisabled(),false); assert.equal(await page.locator('#transcript').inputValue(),previous);
  passed.push('permission denial leaves retry and text available');
  // Persisted localStorage draft + lost sessionStorage reproduces app restart.
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
  const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('frontend-preview:expression.trainingDraft.v1')));
  assert.ok(saved.backendRunId);
  await page.evaluate(()=>sessionStorage.clear()); await page.reload();
  await page.locator('#resume-draft').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#transcript').inputValue(),previous);
  assert.equal(await page.locator('#input-error').textContent(),'');
  const restored = await page.evaluate(()=>JSON.parse(sessionStorage.getItem('expression.previewRuns.v1')));
  assert.ok(restored.runs[saved.backendRunId]); assert.ok(restored.attempts[saved.backendAttemptId]);
  const draftAfter = await page.evaluate(()=>JSON.parse(localStorage.getItem('frontend-preview:expression.trainingDraft.v1')));
  assert.equal(draftAfter.backendRunId,saved.backendRunId); assert.deepEqual(draftAfter.answerTiming,saved.answerTiming);
  passed.push('app restart rehydrates local run and attempt, preserving transcript and timing');
  // A silent stream must not be displayed as received sound.
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{
    const audio=new AudioContext(); await audio.resume(); const destination=audio.createMediaStreamDestination();
    window.testSilentAudio=audio; return destination.stream;
  };});
  await page.locator('#record').click();
  await page.waitForFunction(()=>document.querySelector('#microphone-signal')?.dataset.signal==='silent');
  assert.match(await page.locator('#microphone-signal').textContent(),/暂未检测到声音/);
  await page.screenshot({path:'/tmp/expression-silent-microphone.png'});
  await page.locator('#keyboard-input').click();
  assert.equal(await page.locator('#microphone-signal').isVisible(),false);
  await page.evaluate(()=>window.testSilentAudio.close());
  passed.push('silent input has honest warning; monitor is cleaned up on cancel');
  await page.locator('#confirm-transcript').click(); await page.locator('#finish-retell').click();
  await page.locator('[data-analysis-tab="detail"]').click();
  assert.match(await page.locator('.oral-card').textContent(),/最长停顿（估计）1.5s/);
  assert.match(await page.locator('.pause-method').textContent(),/4 次/);
  for(const viewport of [{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-analysis-panel="detail"] .panel-picker select').selectOption('2');
    assert.equal(await page.locator('.advice-card').isVisible(),true);
    assert.ok(await page.locator('.advice-card li').count()>=2);
    const geometry = await page.evaluate(()=>{
      const card=document.querySelector('.advice-card'); const footer=document.querySelector('.analysis-footer');
      const entries=[...card.querySelectorAll('li')].map(x=>x.getBoundingClientRect());
      return {overlap:entries.some((x,i)=>i&&x.top<entries[i-1].bottom),bottom:card.getBoundingClientRect().bottom,footer:footer.getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(geometry.overlap,false); assert.ok(geometry.bottom<=geometry.footer+1);assert.equal(geometry.overflow,false);
    await page.screenshot({path:`/tmp/expression-analysis-${viewport.width}.png`});
  }
  passed.push('recorded pause evidence reaches assessment; portrait and landscape advice do not overlap');
  assert.deepEqual(errors,[]); console.log(JSON.stringify({ok:true,passed,pageErrors:errors}));
} finally {await browser.close();server.closeAllConnections();server.close();}
