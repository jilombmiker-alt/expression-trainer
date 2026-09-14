const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness() {
  const events = [], timers = new Map(); let listener, session, socket, id=0, stops=0;
  const root={addEventListener(_,fn){listener=fn;},removeEventListener(){listener=null;},ExpressionPcm:{start(value){session=value;},stop(){stops++;}}};
  class Socket {constructor(){socket=this;this.readyState=1;this.bufferedAmount=0;this.sent=[];}send(data){this.sent.push(data);}close(){this.readyState=3;}}
  const context={window:root,crypto:{randomUUID:()=> 'test-session'},location:{href:'https://test.invalid/',protocol:'https:'},URL,WebSocket:Socket,Uint8Array,atob,Date,setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(id){timers.delete(id);},setInterval(){return ++id;},clearInterval(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('./realtime-speech.js'),'utf8'),context);
  const callbacks=Object.fromEntries(['started','input','text','stopping','final','error'].map(name=>[name,data=>events.push({name,data})]));
  const handle=root.ExpressionRealtime.open(callbacks);
  return {handle,events,timers,get socket(){return socket;},get stops(){return stops;},native(type,extra={}){listener?.({detail:{session,type,...extra}});},async message(data){await socket.onmessage({data:JSON.stringify(data)});}};
}
test('native PCM is buffered until ready and text arrives before stopping',async()=>{
  const h=harness();h.native('ready');h.native('data',{audio:btoa('\0\1'),rms:.1});assert.equal(h.socket.sent.length,0);
  await h.message({type:'ready'});assert.equal(h.socket.sent[0].byteLength,2);
  await h.message({type:'partial',text:'第一点'});assert.equal(h.events.at(-1).data,'第一点');
  assert.ok(!h.events.some(e=>e.name==='stopping'));
  h.handle.stop();h.native('stopped');assert.equal(JSON.parse(h.socket.sent.at(-1)).type,'stop');
  await h.message({type:'final',text:'第一点，抓住中心。'});assert.equal(h.events.at(-1).name,'final');assert.equal(h.timers.size,0);
});
test('denied native mic fails and cleans up connection',()=>{const h=harness();h.native('error',{message:'没有获得安卓麦克风权限'});assert.match(h.events.at(-1).data,/权限/);assert.equal(h.socket.readyState,3);assert.equal(h.timers.size,0);});
test('empty result is not success and distinguishes silent PCM',async()=>{const h=harness();await h.message({type:'ready'});h.native('data',{audio:btoa('\0\0'),rms:0});await h.message({type:'final',text:''});assert.equal(h.events.at(-1).name,'error');assert.match(h.events.at(-1).data,/音量接近零/);});
test('cancel drops late events and closes capture',async()=>{const h=harness();h.handle.cancel();h.native('data',{audio:'AA=='});await h.message({type:'partial',text:'late'});assert.equal(h.events.length,0);assert.ok(h.stops>0);assert.equal(h.socket.readyState,3);});
test('network close preserves prior partial and reports failure',async()=>{const h=harness();await h.message({type:'partial',text:'已有文字'});h.socket.onclose();assert.equal(h.events[0].data,'已有文字');assert.equal(h.events.at(-1).name,'error');assert.equal(h.timers.size,0);});
