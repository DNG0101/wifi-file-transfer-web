import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,open,mkdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {resolver} from '../scripts/build.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
const bytes=Number(process.env.TEST_BYTES||10737418240);
await mkdir('test-results',{recursive:true});
const source=path.resolve('test-results/large-source.bin');
const file=await open(source,'w');await file.truncate(bytes);
// Sparse allocation on supporting file systems; bytes still traverse the channel and disk.
await file.write(Buffer.from('WebRTC large-file validation'),0,28,0);await file.write(Buffer.from('verified end'),0,12,bytes-12);await file.close();
assert.equal((await stat(source)).size,bytes);
const sourceHash=createHash('sha256');for await(const chunk of createReadStream(source))sourceHash.update(chunk);const expected=sourceHash.digest('hex');
console.log(JSON.stringify({stage:'source',bytes,sha256:expected}));
await build({entryPoints:['./tests/browser-entry.js'],plugins:[resolver],bundle:true,format:'esm',outfile:'test-results/browser.js'});
const server=createServer(async(req,res)=>{try{if(req.url==='/browser.js'||req.url==='/assets/hash-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(req.url==='/browser.js'?'test-results/browser.js':'assets/hash-worker.js'));}else{res.setHeader('Content-Type','text/html');res.end('<input type="file" id="source"><script type="module" src="/browser.js"></script>');}}catch(e){res.statusCode=500;res.end(e.message);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launchPersistentContext(path.resolve('test-results/large-sender-profile'),{channel:'chrome',headless:true,args:['--enable-precise-memory-info']});
const receiverBrowser=await chromium.launchPersistentContext(path.resolve('test-results/large-receiver-profile'),{channel:'chrome',headless:true,args:['--enable-precise-memory-info']});
const started=Date.now();let poll;
try{
 const a=await browser.newPage(),b=await receiverBrowser.newPage();
 for(const p of [a,b]){p.on('pageerror',e=>console.error('PAGE ERROR',e.message));await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForFunction(()=>window.testApi);}
 const code=await b.evaluate(async()=>{const {Room,newCode,BlockTransfer}=testApi;window.received=[];window.room=new Room({onTransfer:c=>{window.transfer=new BlockTransfer(c,{onOffer:()=>transfer.accept({storage:'opfs'}),onFile:f=>received.push({size:f.blob.size,name:f.name}),onUpdate:u=>window.progress=u});}});const code=newCode();await room.open(code,true,'Large receiver','receive');return code;});
 await a.evaluate(async code=>{window.members=[];window.room=new testApi.Room({onMembers:m=>window.members=m});await room.open(code,false,'Large sender','send');},code);
 await a.waitForFunction(()=>members.length===1);await a.locator('#source').setInputFiles(source);
 await a.evaluate(()=>{window.transfer=new testApi.BlockTransfer(room.connect(members[0].id),{files:[document.querySelector('#source').files[0]],onUpdate:u=>window.progress=u});});
 let maxHeap=0,maxBuffer=0;
 poll=setInterval(async()=>{try{const sample=await Promise.all([a,b].map(p=>p.evaluate(()=>({state:transfer.state,bytes:progress?.bytes,total:progress?.total,verified:progress?.verifiedBytes,heap:performance.memory?.usedJSHeapSize,buffer:transfer.conn.dataChannel?.bufferedAmount}))));maxHeap=Math.max(maxHeap,...sample.map(x=>x.heap||0));maxBuffer=Math.max(maxBuffer,...sample.map(x=>x.buffer||0));console.log(JSON.stringify({seconds:Math.round((Date.now()-started)/1000),sample}));}catch{}},10000);
 await a.waitForFunction(()=>transfer.terminal(),null,{timeout:3600000});
 const result=await a.evaluate(()=>({state:transfer.state,detail:transfer.detail,digest:transfer.record.files[0].digest}));assert.equal(result.state,'complete',result.detail);assert.equal(result.digest,expected);
 const receiver=await b.evaluate(()=>({state:transfer.state,digest:transfer.record.files[0].digest,received}));assert.equal(receiver.state,'complete');assert.equal(receiver.digest,expected);assert.equal(receiver.received[0].size,bytes);
 console.log(JSON.stringify({PASS:true,bytes,expected,maxHeap,maxBuffer,seconds:(Date.now()-started)/1000,receiver}));
 await b.evaluate(async()=>{await transfer.storage.cleanup();await testApi.records.remove(transfer.record.id);});
}finally{clearInterval(poll);await browser.close();await receiverBrowser.close();server.close();}
