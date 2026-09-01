export const HEARTBEAT_MS=20000,STALE_MS=5*60*1000,MAX_RECORDS=256;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let database;
export function validPresence(value,now=Date.now(),allowExpired=false){
 if(!value||typeof value!=='object'||!UUID.test(value.uuid||'')||typeof value.name!=='string'||!value.name.trim()||value.name.length>48)return false;
 if(typeof value.peerId!=='string'||value.peerId.length>128||typeof value.peer2Id!=='string'||value.peer2Id.length>128||!['online','offline'].includes(value.status))return false;
 for(const key of ['version','revision','heartbeatSeq','lastSeen','updatedAt'])if(!Number.isSafeInteger(value[key])||value[key]<0)return false;
 if(value.version!==value.revision)return false;
 if(value.lastSeen>now+60000||value.updatedAt>now+60000||(!allowExpired&&now-value.lastSeen>STALE_MS))return false;
 return true;
}
const tie=r=>JSON.stringify([r.status,r.peerId,r.peer2Id,r.name,r.uuid]);
export function comparePresence(a,b){return a.revision-b.revision||a.heartbeatSeq-b.heartbeatSeq||a.updatedAt-b.updatedAt||tie(a).localeCompare(tie(b));}
const cleanPresence=r=>Object.fromEntries(['uuid','name','peerId','peer2Id','status','version','revision','heartbeatSeq','lastSeen','updatedAt'].map(k=>[k,r[k]]));
export function mergePresenceRecords(local,remote,now=Date.now()){
 const merged=new Map();for(const source of [...local,...remote])if(validPresence(source,now)){const row=cleanPresence(source);if(!merged.has(row.uuid)||comparePresence(merged.get(row.uuid),row)<0)merged.set(row.uuid,row);}
 return [...merged.values()].sort((a,b)=>b.lastSeen-a.lastSeen||b.updatedAt-a.updatedAt||a.uuid.localeCompare(b.uuid)).slice(0,MAX_RECORDS);
}
export class PresenceDB{
 constructor(indexed=indexedDB,name='wft-presence-v1'){this.indexed=indexed;this.name=name;}
 async open(){if(this.database)return this.database;this.database=await new Promise((resolve,reject)=>{const r=this.indexed.open(this.name,1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('presenceRecords',{keyPath:'uuid'});for(const key of ['peerId','status','lastSeen','updatedAt'])s.createIndex(key,key);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return this.database;}
 async transaction(mode,fn){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('presenceRecords',mode),store=tx.objectStore('presenceRecords');let value;try{value=fn(store);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Presence storage interrupted.'));});}
 async all(){const db=await this.open();return new Promise((resolve,reject)=>{const r=db.transaction('presenceRecords').objectStore('presenceRecords').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async merge(incoming,now=Date.now()){
  if(!Array.isArray(incoming)||incoming.length>MAX_RECORDS)throw Error('Invalid presence batch.');const db=await this.open();
  return new Promise((resolve,reject)=>{const tx=db.transaction('presenceRecords','readwrite'),store=tx.objectStore('presenceRecords'),request=store.getAll();let merged;
   request.onsuccess=()=>{try{merged=mergePresenceRecords(request.result,incoming,now);for(const row of merged)store.put(row);}catch(e){tx.abort();reject(e);}};
   tx.oncomplete=()=>resolve(merged);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Presence merge interrupted.'));
  });
 }
 async put(row,now=Date.now()){if(!validPresence(row,now,true))throw Error('Invalid presence record.');await this.merge([row],now);return row;}
 async cleanup(now=Date.now()){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('presenceRecords','readwrite'),request=tx.objectStore('presenceRecords').openCursor(),expired=[];request.onsuccess=()=>{const c=request.result;if(!c)return;if(!validPresence(c.value,now)){expired.push(c.value.uuid);c.delete();}c.continue();};tx.oncomplete=()=>resolve(expired);tx.onerror=()=>reject(tx.error);});}
 async online(now=Date.now()){return (await this.all()).filter(r=>validPresence(r,now)&&r.status==='online').sort((a,b)=>a.name.localeCompare(b.name)||a.uuid.localeCompare(b.uuid));}
 close(){this.database?.close();this.database=null;}
}
