import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const root=process.cwd();
const server=createServer(async(req,res)=>{try{
  let pathname=new URL(req.url,'http://local').pathname;
  if(!pathname.startsWith('/wifi-file-transfer-web/'))throw Error('Expected repository subpath');
  pathname=pathname.slice('/wifi-file-transfer-web/'.length)||'index.html';
  const target=path.resolve(root,pathname);
  if(!target.startsWith(root+path.sep)||pathname.includes('..'))throw Error('Invalid path');
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.json':'application/json'};
  res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');
  res.end(await readFile(target));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/wifi-file-transfer-web/`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
let a,b,c,ctxA,ctxB,ctxC;
try{
  // Separate contexts simulate three real users: distinct localStorage, UUID,
  // IndexedDB, OPFS and Web Locks.
  ctxA=await browser.newContext({acceptDownloads:true});
  ctxB=await browser.newContext({acceptDownloads:true});
  ctxC=await browser.newContext({acceptDownloads:true});
  a=await ctxA.newPage();b=await ctxB.newPage();c=await ctxC.newPage();
  for(const p of [a,b,c]){
    p.on('pageerror',e=>errors.push(e.message));
    p.on('download',d=>void d.cancel().catch(()=>{}));
    await p.goto(url,{waitUntil:'domcontentloaded'});
  }
  const setName=async(p,name)=>p.evaluate(name=>{const e=document.querySelector('#device-name');e.value=name;e.dispatchEvent(new Event('change',{bubbles:true}));},name);
  await setName(a,'Sender A');await setName(b,'Receiver B');await setName(c,'Receiver C');
  await Promise.all([a,b,c].map(p=>p.locator('#online-toggle').check()));
  await a.waitForFunction(()=>{const t=document.querySelector('#online-users')?.innerText||'';return t.includes('Receiver B')&&t.includes('Receiver C');},null,{timeout:90000});

  const row=(p,name)=>p.locator('#online-users .online-user').filter({hasText:name});
  await row(a,'Receiver B').getByRole('button',{name:'Connect'}).click();
  await a.waitForFunction(()=>document.querySelector('#target-name')?.textContent.includes('Receiver B'));
  assert.equal(await b.locator('#incoming').isVisible(),false,'Selecting B must not create a transfer request');

  await row(a,'Receiver C').getByRole('button',{name:'Connect'}).click();
  await a.waitForFunction(()=>document.querySelector('#target-name')?.textContent.includes('Receiver C'));
  assert.equal(await b.locator('#incoming').isVisible(),false,'Switching to C must not lock B');
  assert.equal(await c.locator('#incoming').isVisible(),false,'Selecting C must not send hello before file selection');

  await a.locator('#file-picker').setInputFiles({name:'first.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(512*1024,7)});
  await c.locator('#incoming').waitFor({state:'visible',timeout:30000});
  assert.equal(await b.locator('#incoming').isVisible(),false,'Only selected receiver C should get the transfer offer');
  await c.locator('#decline').click();
  await a.waitForFunction(()=>document.querySelector('#history')?.textContent.includes('Declined'),null,{timeout:30000});

  await row(a,'Receiver B').getByRole('button',{name:'Connect'}).click();
  await a.waitForFunction(()=>document.querySelector('#target-name')?.textContent.includes('Receiver B'));
  await a.locator('#file-picker').setInputFiles({name:'second.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(768*1024,9)});
  await b.locator('#incoming').waitFor({state:'visible',timeout:30000});
  assert.equal(await c.locator('#incoming').isVisible(),false,'C must stay unlocked after its declined transfer');
  await b.locator('#accept').click();
  await a.waitForFunction(()=>document.querySelector('#history')?.textContent.includes('Verified complete'),null,{timeout:90000});

  await row(a,'Receiver C').getByRole('button',{name:'Connect'}).click();
  await a.waitForFunction(()=>document.querySelector('#target-name')?.textContent.includes('Receiver C'));
  assert.equal(await row(a,'Receiver B').getByRole('button',{name:'Connect'}).isDisabled(),false);
  assert.equal(await row(a,'Receiver C').getByRole('button',{name:'Connect'}).isDisabled(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: isolated multi-user receivers remain selectable before transfer, after decline, and after success; only file selection opens file-v3.');
}finally{
  await Promise.all([ctxA,ctxB,ctxC].filter(Boolean).map(ctx=>ctx.close().catch(()=>{})));
  await browser.close();server.close();
}
