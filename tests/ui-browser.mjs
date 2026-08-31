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
 for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(url);}
 assert.equal(await a.locator('#send-panel').isVisible(),false);assert.equal(await a.locator('#receive-panel').isVisible(),false);
 await b.locator('#receive').click();await b.locator('#current-room').waitFor();const code=(await b.locator('#current-room').innerText()).replaceAll('-','');assert.match(code,/^[a-z0-9]{12}$/);
 await a.goto(url+'#join='+code);await a.locator('#connected-panel').waitFor({state:'visible',timeout:60000});assert.equal(await a.locator('#send-panel').isVisible(),true);
 await a.getByRole('button',{name:'Remember device',exact:true}).click();
 await a.waitForFunction(()=>document.querySelector('#trusted-devices').textContent.includes('Online'),null,{timeout:60000});
 await b.waitForFunction(()=>document.querySelector('#trusted-devices').textContent.includes('Online'),null,{timeout:60000});
 console.log('PASS: invitation auto-join and mutual remembered-device approval.');
 await a.reload();await b.reload();await a.locator('#send').click();await b.locator('#receive').click();
 await a.waitForFunction(()=>document.querySelector('#connected-devices').innerText.includes('Remembered'),null,{timeout:90000});
 await a.locator('#file-picker').setInputFiles([{name:'any-binary.apk',mimeType:'application/octet-stream',buffer:Buffer.from(Array.from({length:10*1024*1024+17},(_,i)=>i%251))},{name:'empty',mimeType:'application/octet-stream',buffer:Buffer.alloc(0)}]);
 await a.locator('#devices button').first().click();await b.locator('#incoming').waitFor({state:'visible',timeout:30000});assert.equal(await b.locator('#received-section').isVisible(),false);
 await b.locator('#accept').click();await a.waitForFunction(()=>document.querySelector('#history').textContent.includes('Verified complete'),null,{timeout:120000});
 await b.locator('#received-section').waitFor({state:'visible'});assert.equal(await b.getByRole('link',{name:'Save to device'}).count(),2);
 const downloadPromise=b.waitForEvent('download');await b.getByRole('link',{name:'Save to device'}).first().click();const download=await downloadPromise;const downloaded=await readFile(await download.path());assert.equal(downloaded.length,10*1024*1024+17);assert.ok(downloaded.every((v,i)=>v===i%251));console.log('PASS: saved browser download is byte-for-byte identical, SHA-256 '+createHash('sha256').update(downloaded).digest('hex'));
 await b.reload();await b.locator('#recovery-section').waitFor({state:'visible'});await b.getByRole('button',{name:'Show received files'}).first().click();await b.waitForFunction(()=>document.querySelectorAll('#downloads a').length===2);assert.equal(await b.getByRole('link',{name:'Save to device'}).count(),2);
 await a.setViewportSize({width:360,height:800});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS: trusted pairing after reload, binary + empty files, explicit consent, verification, persistent download recovery, mobile layout, subpath worker and assets; no page errors.');
}catch(e){console.error('UI diagnostics',errors,await Promise.all([a,b].map(p=>p.locator('body').innerText())));throw e;}finally{await browser.close();server.close();}

