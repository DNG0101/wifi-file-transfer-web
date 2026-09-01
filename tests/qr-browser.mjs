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

const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
async function page(){const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);return p;}
async function scan(target,source){
 const data=await source.locator('#room-qr').getAttribute('src');
 await target.evaluate(data=>{
  navigator.mediaDevices.getUserMedia=async()=>{
   const img=new Image();img.src=data;await img.decode();
   const canvas=document.createElement('canvas');canvas.width=960;canvas.height=720;
   const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,960,720);
   ctx.imageSmoothingEnabled=false;ctx.drawImage(img,220,100,520,520);
   // Feed actual QR pixels through the production video/canvas/jsQR scanner.
   window.testCameraCanvas=canvas;window.testCameraStream=canvas.captureStream(10);
   return window.testCameraStream;
  };
 },data);
 await target.locator('#scan-qr').click();
 await target.locator('#scanner-dialog').waitFor({state:'hidden',timeout:15000});
 assert.equal(await target.evaluate(()=>window.testCameraStream.getTracks().every(t=>t.readyState==='ended')),true);
}
try {
 for(const hostMode of ['send','receive']){
  const host=await page(),guest=await page();
  await host.locator('#'+hostMode).click();await host.locator('#current-room').waitFor();
  // The scanning device already has its own invitation in the same mode.
  await guest.locator('#'+hostMode).click();await guest.locator('#current-room').waitFor();
  await scan(guest,host);await guest.locator('#connected-panel').waitFor({state:'visible',timeout:60000});
  await host.locator('#connected-panel').waitFor({state:'visible',timeout:60000});
  assert.equal(await guest.locator('#'+(hostMode==='send'?'receive':'send')).getAttribute('aria-pressed'),'true');
  const code=await host.locator('#current-room').innerText();
  await scan(host,host);assert.equal(await host.locator('#current-room').innerText(),code);
  assert.ok((await host.locator('#status').innerText()).includes('current invitation'));
  assert.equal(await host.locator('#connected-panel').isVisible(),true);
  await scan(guest,host);assert.ok((await guest.locator('#status').innerText()).includes('already joined'));
  const sender=hostMode==='send'?host:guest;
  await sender.locator('#devices button').first().click();await sender.locator('#send-panel').waitFor({state:'visible'});
  console.log('PASS actual QR camera-frame decoding, role '+hostMode+', repeated/self scans preserve pairing, file channel opens.');
  await host.close();await guest.close();
 }
 const host=await page();await host.locator('#receive').click();await host.locator('#current-room').waitFor();
 const code=(await host.locator('#current-room').innerText()).replaceAll('-','');
 const racing=await browser.newPage();racing.on('pageerror',e=>errors.push(e.message));
 let release;const held=new Promise(r=>release=r);
 await racing.route('**/connection-config.json',async route=>{await held;await route.fulfill({json:{}});});
 await racing.goto(url);await racing.locator('#send').click();
 await racing.evaluate(code=>{location.hash='join='+code+'&mode=send';},code);
 await racing.waitForFunction(()=>!location.hash);release();
 await racing.locator('#connected-panel').waitFor({state:'visible',timeout:60000});
 assert.equal((await racing.locator('#current-room').innerText()).replaceAll('-',''),code);
 console.log('PASS invitation arriving during startup supersedes pending local invitation.');
 assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
