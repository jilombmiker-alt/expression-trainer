import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';
const origin = 'https://sm60l23llrvvf6g9a5l98.apigateway-cn-beijing.volceapi.com';
const web = resolve('.private-deploy/vefaas-frontend-preview/web');
const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture=/tmp/expression-android-validation/voice-pauses.wav']});
try {
  const context = await browser.newContext({permissions:['microphone'],viewport:{width:390,height:844}});
  const page = await context.newPage(); const errors=[];
  if (!process.env.LIVE_ASSETS) await page.addInitScript(()=>{
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async(...args)=>{try{return await original(...args);}catch(e){console.error('microphone failure',e.name,e.message);throw e;}};
    const add=Worklet.prototype.addModule;
    // Worklet network requests bypass Playwright routing. Load the exact candidate bytes through fetch.
    Worklet.prototype.addModule=async function(url){const text=await (await fetch(url)).text();const blob=URL.createObjectURL(new Blob([text],{type:'text/javascript'}));try{return await add.call(this,blob);}finally{URL.revokeObjectURL(blob);}};
  });
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error')console.log('browser:',msg.text());});
  // Only replace static assets with candidate files. API and WebSocket hit the real service.
  if (!process.env.LIVE_ASSETS) await page.route(origin+'/**',async route=>{
    const url = new URL(route.request().url()); if(url.pathname.startsWith('/api/'))return route.continue();
    const file=resolve(web,'.'+url.pathname); if(!file.startsWith(web+'/'))return route.abort();
    try {await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});}catch{await route.continue();}
  });
  await page.goto(origin+'/welcome.html'); await page.getByRole('link',{name:/开始练习/}).click();
  await page.locator('#confirm-start').click(); await page.locator('#start-timer').click(); await page.locator('#finish-reading').click();
  await page.getByText('火山实时转录已就绪',{exact:true}).waitFor();
  const started=Date.now(); await page.locator('#record').click();
  try { await page.waitForFunction(()=>document.querySelector('#transcript').value.length>0,{},{timeout:25000}); }
  catch(error) { console.log(JSON.stringify({errors,state:await page.locator('#voice-state').innerText(),signal:await page.locator('#microphone-signal').innerText()})); throw error; }
  const firstText=await page.locator('#transcript').inputValue();
  assert.equal(await page.locator('#record').getAttribute('aria-pressed'),'true');
  const firstTextMs=Date.now()-started;
  await mkdir('docs/evidence/android-0.3.0',{recursive:true});
  await page.screenshot({path:'docs/evidence/android-0.3.0/browser-before-stop.png'});
  await page.waitForTimeout(11000); await page.locator('#record').click();
  await page.getByText('实时转录完成',{exact:true}).waitFor({timeout:30000});
  assert.equal(await page.locator('#record').getAttribute('aria-pressed'),'false');
  const transcript=await page.locator('#transcript').inputValue(); assert.ok(transcript.includes('中心思想'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,input:'controlled WAV through Chrome getUserMedia and AudioWorklet; not physical microphone',firstTextMs,firstText,transcript}));
} finally {await browser.close();}
