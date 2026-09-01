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
async function openPage(context,name){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.locator('details').filter({hasText:'Settings & your devices'}).locator('summary').click();await p.locator('#device-name').fill(name);await p.locator('#device-name').blur();return p;}
try{
 const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
 const pages=[];for(let i=0;i<3;i++)pages.push(await openPage(contexts[i],'Online '+(i+1)));
 for(const p of pages)await p.locator('#online-toggle').check();
 for(const p of pages)await p.waitForFunction(()=>document.querySelectorAll('#online-users .online-user').length>=3,null,{timeout:90000});
 for(const p of pages){const names=await p.locator('#online-users').innerText();for(let i=1;i<=3;i++)assert.ok(names.includes('Online '+i));}
 const records=await pages[0].evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wft-presence-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise((resolve,reject)=>{const r=db.transaction('presenceRecords').objectStore('presenceRecords').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});});
 assert.equal(new Set(records.map(r=>r.uuid)).size,records.length);assert.ok(records.every(r=>r.status==='online'&&r.version===r.revision));
 const persistent=await pages[0].evaluate(()=>localStorage.getItem('app_device_uuid'));await pages[0].reload();assert.equal(await pages[0].evaluate(()=>localStorage.getItem('app_device_uuid')),persistent);
 const dbPolicy=await pages[0].evaluate(async()=>{const mod=await import('./src/presence-db.js'),db=new mod.PresenceDB(),now=Date.now(),uuid='ffffffff-ffff-4fff-8fff-ffffffffffff';const base={uuid,name:'Stale',peerId:'x',peer2Id:'y',status:'online',version:50,revision:50,heartbeatSeq:1,lastSeen:now-mod.STALE_MS-1,updatedAt:now-mod.STALE_MS-1};await db.merge([base],now);const rejected=!(await db.all()).some(r=>r.uuid===uuid);const fresh={...base,version:51,revision:51,lastSeen:now,updatedAt:now};await db.merge([fresh],now);const returned=(await db.online(now)).some(r=>r.uuid===uuid);const raw=await db.open(),indexes=[...raw.transaction('presenceRecords').objectStore('presenceRecords').indexNames];return {rejected,returned,indexes};});assert.equal(dbPolicy.rejected,true);assert.equal(dbPolicy.returned,true);assert.deepEqual(dbPolicy.indexes.sort(),['lastSeen','peerId','status','updatedAt']);
 console.log('PASS: three independent browser identities converge; UUID persists across reload; stale rows cannot resurrect; returning identity is accepted.');

 const shared=await browser.newContext(),leader=await openPage(shared,'Shared tabs'),standby=await shared.newPage();await standby.goto(url);
 await leader.locator('#online-toggle').check();await standby.waitForFunction(()=>document.querySelector('#online-toggle').checked);
 await Promise.all([leader,standby].map(p=>p.waitForFunction(()=>/active|managed by another tab/.test(document.querySelector('#online-state').textContent),null,{timeout:30000})));
 const states=await Promise.all([leader,standby].map(p=>p.locator('#online-state').innerText()));assert.equal(states.filter(x=>x.includes('managed by another tab')).length,1);
 const leaderIndex=states.findIndex(x=>x.includes('active'));await [leader,standby][leaderIndex].close();const remaining=[leader,standby][1-leaderIndex];
 await remaining.waitForFunction(()=>document.querySelector('#online-state').textContent.includes('active'),null,{timeout:30000});
 console.log('PASS: shared UUID tabs elect one heartbeat peer and standby takes over after leader closes.');
 await remaining.locator('#online-toggle').uncheck();await remaining.waitForFunction(()=>document.querySelector('#online-state').textContent.includes('disabled'));
 assert.deepEqual(errors,[]);
 for(const c of [...contexts,shared])await c.close();
}finally{await browser.close();server.close();}

