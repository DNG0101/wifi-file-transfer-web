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
  res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(await readFile(target));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/wifi-file-transfer-web/`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];let a,b,c,ctxA,ctxB,ctxC,diagTimer;
const snapshot=async p=>p?.evaluate(()=>({
 name:document.querySelector('#device-name')?.value,
 uuid:localStorage.getItem('app_device_uuid')||localStorage.getItem('wft-device-id'),
 onlineChecked:document.querySelector('#online-toggle')?.checked,
 onlineState:document.querySelector('#online-state')?.textContent,
 onlineUsers:document.querySelector('#online-users')?.innerText,
 status:document.querySelector('#status')?.textContent,
 debug:document.querySelector('#debug-log')?.textContent
})).catch(e=>({snapshotError:e.message}));
const dump=async label=>console.log(label,JSON.stringify({A:await snapshot(a),B:await snapshot(b),C:await snapshot(c),errors},null,2));
try{
 ctxA=await browser.newContext({acceptDownloads:true});ctxB=await browser.newContext({acceptDownloads:true});ctxC=await browser.newContext({acceptDownloads:true});
 a=await ctxA.newPage();b=await ctxB.newPage();c=await ctxC.newPage();
 for(const p of [a,b,c]){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});p.on('download',d=>void d.cancel().catch(()=>{}));await p.goto(url,{waitUntil:'domcontentloaded'});}
 const setName=(p,name)=>p.evaluate(name=>{const e=document.querySelector('#device-name');e.value=name;e.dispatchEvent(new Event('change',{bubbles:true}));},name);
 const chooseFile=async(p,name,size,value)=>{const picker=p.locator('#file-picker');assert.equal(await picker.isDisabled(),false,`file picker must be enabled after selecting ${name}`);await picker.setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.alloc(size,value)});};
 await setName(a,'Sender A');await setName(b,'Receiver B');await setName(c,'Receiver C');
 await Promise.all([a,b,c].map(p=>p.locator('#online-toggle').check()));
 diagTimer=setInterval(()=>void dump('PEER2 PERIODIC'),15000);
 await a.waitForFunction(()=>{const t=document.querySelector('#online-users')?.innerText||'';return t.includes('Receiver B')&&t.includes('Receiver C');},null,{timeout:60000});
 clearInterval(diagTimer);diagTimer=null;await dump('PEER2 CONVERGED');
 const row=(p,name)=>p.locator('#online-users .online-user').filter({hasText:name});
 await row(a,'Receiver B').getByRole('button',{name:'Connect'}).click();await a.waitForFunction(()=>document.querySelector('#target-name')?.textContent.includes('Receiver B'));assert.equal(await b.locator('#incoming').isVisible(),false);
 await row(a,'Receiver C').getByRole('button',{name:'Connect'}).click();await a.waitForFunction(()=>document.querySelector('#target-name')?.textContent.includes('Receiver C'));assert.equal(await b.locator('#incoming').isVisible(),false);assert.equal(await c.locator('#incoming').isVisible(),false);
 await chooseFile(a,'first.bin',512*1024,7);await c.locator('#incoming').waitFor({state:'visible',timeout:30000});assert.equal(await b.locator('#incoming').isVisible(),false);await c.locator('#decline').click();await a.waitForFunction(()=>document.querySelector('#history')?.textContent.includes('Declined'),null,{timeout:30000});
 await row(a,'Receiver B').getByRole('button',{name:'Connect'}).click();await a.waitForFunction(()=>document.querySelector('#target-name')?.textContent.includes('Receiver B'));await chooseFile(a,'second.bin',768*1024,9);await b.locator('#incoming').waitFor({state:'visible',timeout:30000});assert.equal(await c.locator('#incoming').isVisible(),false);await b.locator('#accept').click();await a.waitForFunction(()=>document.querySelector('#history')?.textContent.includes('Verified complete'),null,{timeout:90000});
 await row(a,'Receiver C').getByRole('button',{name:'Connect'}).click();await a.waitForFunction(()=>document.querySelector('#target-name')?.textContent.includes('Receiver C'));assert.equal(await row(a,'Receiver B').getByRole('button',{name:'Connect'}).isDisabled(),false);assert.equal(await row(a,'Receiver C').getByRole('button',{name:'Connect'}).isDisabled(),false);assert.deepEqual(errors,[]);
 console.log('PASS: isolated multi-user receiver switching/decline/success path stays unlocked.');
}catch(e){clearInterval(diagTimer);await dump('MULTI USER FAILURE');throw e;}finally{
 clearInterval(diagTimer);for(const ctx of [ctxA,ctxB,ctxC])await ctx?.close().catch(()=>{});await browser.close().catch(()=>{});server.close();
}
