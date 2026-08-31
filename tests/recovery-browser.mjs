import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {resolver} from '../scripts/build.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
await mkdir('test-results',{recursive:true});
const source=Buffer.from(Array.from({length:24*1024*1024+117},(_,i)=>i%251)),expected=createHash('sha256').update(source).digest('hex');
await writeFile('test-results/recovery-source.bin',source);
await build({entryPoints:['./tests/browser-entry.js'],plugins:[resolver],bundle:true,format:'esm',outfile:'test-results/recovery-fixture.js'});
const server=createServer(async(req,res)=>{if(req.url==='/fixture.js'||req.url==='/assets/hash-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(req.url==='/fixture.js'?'test-results/recovery-fixture.js':'assets/hash-worker.js'));}else{res.setHeader('Content-Type','text/html');res.end('<input id="source" type="file"><script type="module" src="/fixture.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const a=await browser.newPage(),b=await browser.newPage();for(const p of [a,b]){await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForFunction(()=>window.testApi);}
 async function receiver(resuming){return b.evaluate(async resuming=>{window.offers=0;window.room=new testApi.Room({onTransfer:conn=>{window.transfer=new testApi.BlockTransfer(conn,{onOffer:(_,t)=>{offers++;if(!resuming)t.accept({storage:'opfs'});},onFile:f=>window.receivedSize=f.blob.size});}});const code=testApi.newCode();await room.open(code,true,'Receiver','receive');return code;},resuming);}
 async function sender(code,resuming){await a.locator('#source').setInputFiles(path.resolve('test-results/recovery-source.bin'));await a.evaluate(async({code,resuming})=>{window.members=[];window.starts=[];window.room=new testApi.Room({onMembers:m=>window.members=m});await room.open(code,false,'Sender','send');const saved=resuming?(await testApi.records.list()).find(r=>r.direction==='send'):undefined;const conn=room.connect(members[0].id);const send=conn.send.bind(conn);conn.send=raw=>{if(typeof raw==='string'&&JSON.parse(raw).type==='block-start'){const block=JSON.parse(raw).block;starts.push(block);if(!resuming&&block===1){conn.close();return;}}send(raw);};window.transfer=new testApi.BlockTransfer(conn,{files:[document.querySelector('#source').files[0]],record:saved,reselected:resuming});},{code,resuming});}
 await sender(await receiver(false),false);await a.waitForFunction(()=>transfer.state==='reconnecting',null,{timeout:60000});assert.equal(await b.evaluate(()=>transfer.record.files[0].next),1);
 await a.reload();await b.reload();for(const p of [a,b])await p.waitForFunction(()=>window.testApi);
 await sender(await receiver(true),true);await a.waitForFunction(()=>transfer.terminal(),null,{timeout:120000});
 assert.equal(await a.evaluate(()=>transfer.state),'complete',await a.evaluate(()=>transfer.detail));assert.equal(await a.evaluate(()=>transfer.record.files[0].digest),expected);assert.equal(await b.evaluate(()=>transfer.record.files[0].digest),expected);assert.equal(await b.evaluate(()=>offers),0);assert.equal(await b.evaluate(()=>receivedSize),source.length);assert.deepEqual(await a.evaluate(()=>starts),[1,2,3]);
 console.log('PASS: both browsers reloaded after first durable 8 MiB block; original source reselected, OPFS progress recovered, block 0 not resent, full SHA-256 matched: '+expected);
 const directoryResult=await b.evaluate(async()=>{
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('directory-output-test',{create:true}),folder=await directory.getDirectoryHandle('folder',{create:true});
  const existing=await folder.getFileHandle('report.pdf',{create:true}),writer=await existing.createWritable();await writer.write('keep existing');await writer.close();
  const data=new Uint8Array([0,128,255]),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
  const id=crypto.randomUUID(),record={id:'receive:'+id,transferId:id,storage:'directory',directory,manifest:[{name:'report.pdf',path:'folder/report.pdf',size:3}],files:[{next:1,hashes:[hash],complete:false}]};
  const storage=await testApi.BlockStorage.open(record);await storage.write(0,0,data);const result=await storage.finalize(0,record.files[0],hash);const saved=await (await folder.getFileHandle(result.savedName)).getFile();return {name:result.savedName,original:await (await existing.getFile()).text(),bytes:Array.from(new Uint8Array(await saved.arrayBuffer())),complete:record.files[0].complete};
 });
 assert.deepEqual(directoryResult,{name:'report (1).pdf',original:'keep existing',bytes:[0,128,255],complete:true});console.log('PASS: directory output path uses actual browser filesystem handles, preserves folder paths and existing files, and verifies collision-renamed output.');
}finally{await browser.close();server.close();}
