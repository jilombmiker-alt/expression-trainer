import {readFile} from 'node:fs/promises';
const targets=await(await fetch('http://127.0.0.1:9228/json/list')).json();
const ws=new WebSocket(targets[0].webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
try{
  const source=await readFile('web/realtime-speech.js','utf8');
  const expression=source+`;window.liveProbe={started:false,stopped:false,bytes:0,peak:0,partial:[],errors:[]};window.liveHandle=ExpressionRealtime.open({started(){liveProbe.started=true},input(d){liveProbe.bytes=d.bytes;liveProbe.peak=Math.max(liveProbe.peak,d.rms)},text(t){liveProbe.partial.push({text:t,beforeStop:!liveProbe.stopped})},stopping(){liveProbe.stopped=true},final(d){liveProbe.final=d},error(m){liveProbe.errors.push(m)}});'probe started'`;
  const result=await new Promise((r,j)=>{ws.onmessage=e=>r(JSON.parse(e.data));ws.onerror=j;ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,userGesture:true,returnByValue:true}}));});
  console.log(JSON.stringify(result));
}finally{ws.close();}
