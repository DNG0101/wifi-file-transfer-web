import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {resolver} from '../scripts/build.mjs';
import assert from 'node:assert/strict';
await build({entryPoints:['./tests/browser-entry.js'],plugins:[resolver],bundle:true,format:'esm',outfile:'test-results/browser.js'});
const server=createServer(async(req,res)=>{if(req.url==='/browser.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile('test-results/browser.js'));}else{res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/browser.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const a=await browser.newPage(),b=await browser.newPage();
  for(const page of [a,b]){page.on('pageerror',e=>console.error('PAGE ERROR',e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.testApi);}
  const code=await a.evaluate(async()=>{const {Room,newCode}=testApi;window.errors=[];window.members=[];window.room=new Room({onMembers:m=>window.members=m,onError:e=>window.errors.push(e)});const code=newCode();await room.open(code,true,'Sender','send');return code;});
  await b.evaluate(async code=>{const {Room,Transfer,memorySink}=testApi;window.members=[];window.received=[];window.errors=[];window.room=new Room({onMembers:m=>window.members=m,onError:e=>window.errors.push(e),onTransfer:conn=>{window.transfer=new Transfer(conn,{onOffer:()=>window.offered=true,onFile:async f=>window.received.push({name:f.name,bytes:Array.from(new Uint8Array(await f.blob.arrayBuffer()))})});}});await room.open(code,false,'Receiver','receive');},code);
  await a.waitForFunction(()=>members.some(m=>m.name==='Receiver'),{timeout:30000});
  await a.evaluate(()=>{window.transfer=new testApi.Transfer(room.connect(members[0].id),{files:[new File([Uint8Array.from({length:2*1024*1024+19},(_,i)=>i%251)],'test.bin'),new File([],'empty.txt')]});});
  await b.waitForFunction(()=>window.offered);assert.equal(await b.evaluate(()=>received.length),0);
  await b.evaluate(()=>transfer.accept(()=>testApi.memorySink()));
  await a.waitForFunction(()=>transfer.terminal(),{timeout:30000});
  assert.equal(await a.evaluate(()=>transfer.state),'complete');
  await b.waitForFunction(()=>received.length===2);
  const received=await b.evaluate(()=>received);assert.equal(received[0].bytes.length,2*1024*1024+19);assert.ok(received[0].bytes.every((b,i)=>b===i%251));assert.equal(received[1].bytes.length,0);
  console.log('PASS: two real Chromium peers joined through PeerJS Cloud, discovered receiver, waited for consent, and transferred binary + empty files over WebRTC.');
  await b.evaluate(()=>room.close());await a.waitForFunction(()=>members.length===0);console.log('PASS: disconnected receiver removed from room.');
}finally{await browser.close();server.close();}
