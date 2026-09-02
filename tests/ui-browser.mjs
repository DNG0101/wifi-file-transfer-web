import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
await import('../scripts/build.mjs');
const root=process.cwd();
const server=createServer(async(req,res)=>{try{let pathname=new URL(req.url,'http://local').pathname;if(!pathname.startsWith('/wifi-file-transfer-web/'))throw Error('Expected repository subpath');pathname=pathname.slice('/wifi-file-transfer-web/'.length)||'index.html';const target=path.resolve(root,pathname);if(!target.startsWith(root+path.sep)||pathname.includes('..'))throw Error('Invalid path');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(await readFile(target));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/wifi-file-transfer-web/`;
const browser=await chromium.launch({channel:'chrome',headless:true});let a,b;const errors=[];
try{
 a=await browser.newPage();b=await browser.newPage();
 for(const p of [a,b]){await p.addInitScript(()=>{window.showDirectoryPicker=async()=>{const root=await navigator.storage.getDirectory();return root.getDirectoryHandle('test-device-folder',{create:true});};});p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(url);}
 assert.equal(await a.locator('#send-panel').isVisible(),false);assert.equal(await a.locator('#receive-panel').isVisible(),false);assert.equal(await a.locator('#debug-enabled').isChecked(),true);assert.equal(await a.locator('#discovery-panel').isVisible(),true);await a.locator('#send').click();await a.locator('#current-room').waitFor();assert.equal(await a.locator('#scan-qr').isVisible(),true);assert.equal(await a.locator('#send-panel').isVisible(),false);
 await b.locator('#receive').click();await b.locator('#current-room').waitFor();const code=(await b.locator('#current-room').innerText()).replaceAll('-','');assert.match(code,/^[a-z0-9]{12}$/);
 await a.goto(url+'#join='+code);await a.locator('#connected-panel').waitFor({state:'visible',timeout:60000});assert.equal(await a.locator('#send-panel').isVisible(),false);assert.equal(await b.locator('#scan-qr').isVisible(),true);
 await a.getByRole('button',{name:'Remember device',exact:true}).click();
 await a.waitForFunction(()=>document.querySelector('#trusted-devices').textContent.includes('Online'),null,{timeout:60000});
 await b.waitForFunction(()=>document.querySelector('#trusted-devices').textContent.includes('Online'),null,{timeout:60000});
 console.log('PASS: invitation auto-join and mutual remembered-device approval.');
 await a.reload();await b.reload();await a.locator('#send').click();await b.locator('#receive').click();
 await a.waitForFunction(()=>document.querySelector('#connected-devices').innerText.includes('Remembered'),null,{timeout:90000});
 await a.locator('#devices button').first().click();await a.locator('#send-panel').waitFor({state:'visible'});await a.evaluate(()=>document.querySelector('#file-picker').addEventListener('change',()=>window.fileChosenAt=Date.now(),{capture:true}));
 const payload=Buffer.allocUnsafe(1024*1024+17);for(let i=0;i<payload.length;i++)payload[i]=i%251;
 await a.locator('#file-picker').setInputFiles([{name:'any-binary.apk',mimeType:'application/octet-stream',buffer:payload},{name:'empty',mimeType:'application/octet-stream',buffer:Buffer.alloc(0)}]);
 await b.locator('#incoming').waitFor({state:'visible',timeout:30000});console.log('Browser file-selection event to observed receiver offer (ms):',Date.now()-await a.evaluate(()=>window.fileChosenAt));assert.equal(await b.locator('#received-section').isVisible(),false);assert.equal(await b.locator('#accept').isDisabled(),true);await b.locator('#request-folder').click();await b.waitForFunction(()=>!document.querySelector('#accept').disabled);
 await b.locator('#accept').click();await a.waitForFunction(()=>document.querySelector('#history').textContent.includes('Verified complete'),null,{timeout:120000});
 await b.locator('#received-section').waitFor({state:'visible'});assert.equal(await b.getByRole('link',{name:'Save to device'}).count(),0);
 const saved=await b.evaluate(async()=>{const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('test-device-folder'),file=await (await folder.getFileHandle('any-binary.apk')).getFile();const bytes=new Uint8Array(await file.arrayBuffer());const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wft-durable-v3');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const count=await new Promise(resolve=>{const r=db.transaction('blocks').objectStore('blocks').count();r.onsuccess=()=>resolve(r.result);});const records=await new Promise(resolve=>{const r=db.transaction('transfers').objectStore('transfers').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return {size:file.size,exact:bytes.every((v,i)=>v===i%251),browserBlocks:count,direct:records.every(r=>r.storage==='directory'),empty:(await (await folder.getFileHandle('empty')).getFile()).size};});
 assert.deepEqual(saved,{size:1024*1024+17,exact:true,browserBlocks:0,direct:true,empty:0});
 console.log('PASS: selecting files immediately offers the batch on a pre-opened channel; acceptance requires a device folder; actual filesystem output bytes match and no payload blocks exist in IndexedDB.');
 await b.reload();await b.locator('#recovery-section').waitFor({state:'visible'});await b.getByRole('button',{name:'Show received files'}).first().click();await b.waitForFunction(()=>document.querySelectorAll('#downloads .download').length===2);assert.equal(await b.getByRole('link',{name:'Save to device'}).count(),0);
 // Reverse roles: the receiver opens an invitation generated on the sender.
 const c=await browser.newPage(),d=await browser.newPage();await d.addInitScript(()=>{window.showDirectoryPicker=undefined;});for(const p of [c,d]){p.on('pageerror',e=>errors.push(e.message));await p.goto(url);}
 await c.locator('#send').click();await c.locator('#current-room').waitFor();const senderCode=(await c.locator('#current-room').innerText()).replaceAll('-','');
 await d.goto(url+'#join='+senderCode+'&mode=receive');await d.locator('#connected-panel').waitFor({state:'visible',timeout:60000});assert.equal(await d.locator('#receive-panel').isVisible(),true);assert.equal(await d.locator('#scan-qr').isVisible(),true);assert.equal(await d.locator('#room-qr').isVisible(),true);assert.equal(await c.locator('#room-qr').isVisible(),true);
 assert.ok((await d.locator('#direct-save-support').innerText()).includes('not supported'));assert.equal(await d.locator('#choose-folder').isVisible(),false);
 console.log('PASS: QR/scanner are present on both roles, sender-generated invitations select Receive mode, and unsupported direct-save browsers get an explicit limitation.');
 await c.close();await d.close();
 await a.setViewportSize({width:360,height:800});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS: trusted pairing after reload, binary + empty files, direct folder writes, explicit consent, verification, saved-file metadata recovery, mobile layout, subpath worker and assets; no page errors.');
}catch(e){console.error('UI diagnostics',errors,await Promise.all([a,b].map(p=>p.locator('body').innerText())));throw e;}finally{await browser.close();server.close();}

