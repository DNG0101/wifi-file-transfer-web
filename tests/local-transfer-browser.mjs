import {chromium} from 'playwright';
import {build} from 'esbuild';
import {resolver} from '../scripts/build.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
await build({entryPoints:['./tests/browser-entry.js'],plugins:[resolver],bundle:true,format:'esm',outfile:'test-results/browser.js'});
const root=process.cwd();
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/test.html'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/test-results/browser.js"></script>');return;}
 const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep))throw Error('path');
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(file));
 }catch{res.statusCode=404;res.end('missing');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>console.log('BROWSER',m.text()));
 const origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin+'/test.html');await page.waitForFunction(()=>window.testApi);console.log('Browser API ready');
 const result=await page.evaluate(async mockTransport=>{
  const pcs=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async fn=>{for(let i=0;i<600;i++){if(fn())return;await delay(100);}throw Error('Local transfer timed out');};
  const adapt=(dc,pc)=>{const handlers=new Map();dc.binaryType='arraybuffer';const c={dataChannel:dc,peerConnection:pc,get open(){return dc.readyState==='open';},on(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},send(data){dc.send(data);},close(){dc.close();pc.close();}};for(const type of ['open','close','error'])dc.addEventListener(type,e=>(handlers.get(type)||[]).forEach(fn=>fn(e)));dc.addEventListener('message',e=>(handlers.get('data')||[]).forEach(fn=>fn(e.data)));return c;};
  function pair(receive){
   if(mockTransport){
    const channel=()=>{const events=new Map();return {open:true,dataChannel:{bufferedAmount:0},peerConnection:{sctp:{maxMessageSize:262144}},on(type,fn){events.set(type,[...(events.get(type)||[]),fn]);},emit(type,data){for(const fn of events.get(type)||[])fn(data);},send(raw){const copy=structuredClone(raw);queueMicrotask(()=>{if(this.other.open)this.other.emit('data',copy);});},close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}};};
    const a=channel(),b=channel();a.other=b;b.other=a;receive(b);return {out:a,ready:Promise.resolve()};
   }
   const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]});pcs.push(a,b);const out=adapt(a.createDataChannel('file'),a);
   b.ondatachannel=e=>receive(adapt(e.channel,b));
   const gather=pc=>pc.iceGatheringState==='complete'?Promise.resolve():new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);reject(Error('ICE gathering timed out in this environment'));},15000);const done=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',done);resolve();}};pc.addEventListener('icegatheringstatechange',done);done();});
   const ready=(async()=>{await a.setLocalDescription(await a.createOffer());await gather(a);await b.setRemoteDescription(a.localDescription);await b.setLocalDescription(await b.createAnswer());await gather(b);await a.setRemoteDescription(b.localDescription);await until(()=>out.open);})();
   return {out,ready};
  }
  let incoming;const primary=pair(c=>incoming=c);await primary.ready;await until(()=>incoming?.open);console.log('Primary ready');
  let receiver,sender,received,phase=0;const profiles=[],lanePromises=[];const start=performance.now();
  const observe=c=>{const send=c.send.bind(c);c.send=raw=>{if(raw instanceof ArrayBuffer&&sender){if(phase===0){phase=1;sender.setLaneCount(12);}else if(phase===1&&sender.parallelism.lanes===12){phase=2;sender.setLaneCount(8);}}send(raw);};return c;};
  receiver=new testApi.BlockTransfer(incoming,{onOffer:(_,t)=>t.accept({storage:'opfs'}),onFile:f=>received=f.blob});
  const payload=new Uint8Array(64*1024*1024+123);for(let i=0;i<payload.length;i++)payload[i]=i%251;
  const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',payload)),x=>x.toString(16).padStart(2,'0')).join('');
  sender=new testApi.BlockTransfer(observe(primary.out),{files:[new File([payload],'local-large.bin')],onUpdate:u=>{if(profiles.at(-1)!==u.parallelism.lanes)profiles.push(u.parallelism.lanes);},openLane:index=>{const lane=pair(c=>receiver.addLane(c,index));lanePromises.push(lane.ready.catch(()=>{}));return observe(lane.out);}});
  const watch=setInterval(()=>console.log('Transfer',sender.state,sender.bytes,receiver.state,receiver.bytes,sender.detail||'',receiver.detail||''),5000);await until(()=>sender.terminal());clearInterval(watch);if(sender.state!=='complete')throw Error(sender.detail);await until(()=>receiver.state==='complete');
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await received.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
  const size=received.size,layout=receiver.record.layout,seconds=(performance.now()-start)/1000;
  await receiver.storage.cleanup();await testApi.records.remove(receiver.record.id);await testApi.records.remove(sender.record.id);for(const pc of pcs)pc.close();
  return {size,expected,actual,layout,profiles,phase,seconds,transport:mockTransport?'simulated channels':'local WebRTC'};
 },process.env.LOCAL_MOCK_TRANSPORT==='1');
 assert.equal(result.size,64*1024*1024+123);assert.equal(result.actual,result.expected);assert.equal(result.layout,'blocks-v2');assert.ok(result.profiles.includes(12));assert.equal(result.profiles.at(-1),8);assert.equal(result.phase,2);assert.deepEqual(errors,[]);console.log('PASS browser transfer + real OPFS + hash workers:',JSON.stringify(result));
 const ui=await browser.newPage({viewport:{width:390,height:844}});await ui.goto(origin);await ui.waitForFunction(()=>document.querySelector('#transfer-lanes')?.getAttribute('aria-valuetext'));
 for(const value of [8,25,50]){await ui.locator('#transfer-lanes').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);assert.equal(await ui.locator('#transfer-parallelism-value').textContent(),`${value} lanes / ${value*2} blocks`);}
 assert.equal(await ui.locator('#request-folder').textContent(),'Save to folder (large files)');console.log('PASS browser slider endpoints and folder-save UI');
}finally{await browser.close();await new Promise(r=>server.close(r));}
