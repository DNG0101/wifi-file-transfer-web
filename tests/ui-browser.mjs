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
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try {
 const contextA=await browser.newContext({acceptDownloads:true}),contextB=await browser.newContext({acceptDownloads:true});
 const a=await contextA.newPage(),b=await contextB.newPage();
 for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.locator('#name-dialog').waitFor({state:'visible'});}
 await a.locator('#welcome-name').fill('日本の端末');await a.locator('#name-form button').click();
 await b.locator('#welcome-name').fill('هاتف أحمد');await b.locator('#name-form button').click();
 for(const p of [a,b])assert.equal(await p.locator('#name-dialog').isVisible(),false);
 await a.reload();assert.equal(await a.locator('#name-dialog').isVisible(),false);
 assert.equal(await a.locator('#device-name').inputValue(),'日本の端末');
 await b.locator('#receive').click();await b.waitForFunction(()=>document.querySelector('#current-room').textContent.trim().length>0);
 const code=(await b.locator('#current-room').innerText()).replaceAll('-','');
 await a.goto(url+'#join='+code);
 await b.locator('#connection-request').waitFor({state:'visible',timeout:60000});
 assert.equal(await a.locator('#connected-panel').isVisible(),false);
 await b.locator('#accept-connection').click();
 for(const p of [a,b])await p.locator('#connected-panel').waitFor({state:'visible',timeout:60000});
 async function send(sender,receiver,name,buffer){
   await sender.locator('#devices button').first().click();
   await sender.locator('#send-panel').waitFor({state:'visible',timeout:30000});
   await sender.locator('#file-picker').setInputFiles({name,mimeType:'application/octet-stream',buffer});
   await receiver.locator('#incoming').waitFor({state:'visible',timeout:30000});
   assert.equal(await receiver.locator('#request-folder').isVisible(),false);
   await receiver.waitForFunction(()=>!document.querySelector('#accept').disabled);
   const downloadPromise=receiver.waitForEvent('download',{timeout:120000});
   await receiver.locator('#accept').click();
   const download=await downloadPromise;
   assert.equal(download.suggestedFilename(),name);
   const downloadPath=await download.path();assert.ok(downloadPath);
   assert.deepEqual(await readFile(downloadPath),buffer);
   await sender.waitForFunction(()=>document.querySelector('#active-summary').textContent==='',null,{timeout:120000});
   const fallback=receiver.locator('#downloads a').last();
   assert.equal(await fallback.innerText(),'Download');assert.equal(await fallback.isVisible(),true);
   const retryPromise=receiver.waitForEvent('download');await fallback.click();
   assert.deepEqual(await readFile(await (await retryPromise).path()),buffer);
 }
 await send(a,b,'résumé-日本語.bin',Buffer.from([0,1,2,255,128,13,10]));
 await send(b,a,'ملف.txt',Buffer.from('مرحبا — hello — नमस्ते'));
 await send(a,b,'empty.txt',Buffer.alloc(0));
 assert.equal(await b.locator('#recovery-section').isVisible(),true);
 await b.reload();assert.equal(await b.locator('#name-dialog').isVisible(),false);
 await b.getByRole('button',{name:'Show received files'}).first().waitFor();
 const restored=b.waitForEvent('download');await b.getByRole('button',{name:'Show received files'}).first().click();
 assert.equal(await (await restored).failure(),null);
 await a.setViewportSize({width:360,height:800});
 assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: first-visit Unicode names, returning user, mutual consent, two-way transfers, browser downloads, empty/binary files, fallback links, recovery, mobile layout.');
}finally{await browser.close();server.close();}
