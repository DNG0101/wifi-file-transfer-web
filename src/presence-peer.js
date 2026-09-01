import * as PeerModule from 'peerjs';
import {peerOptions} from './room.js';
import {PresenceDB,HEARTBEAT_MS,MAX_RECORDS,comparePresence,validPresence} from './presence-db.js';
const Peer=PeerModule.Peer||PeerModule.default.Peer||PeerModule.default;
const SLOTS=4,MAX_MESSAGE=128*1024,CONNECT_TIMEOUT=12000;
const uuidOk=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'');
const slotFor=id=>[...id].reduce((n,c)=>(n*33+c.charCodeAt(0))>>>0,5381)%SLOTS;
const namespaceId=value=>[...value].reduce((n,c)=>(n*16777619^c.charCodeAt(0))>>>0,2166136261).toString(36);

export class PresencePeerManager{
 constructor({uuid,name,peer1Id='',db=new PresenceDB(),PeerClass=Peer,options=peerOptions(),onChange=()=>{},onState=()=>{},channelFactory=n=>typeof BroadcastChannel==='function'?new BroadcastChannel(n):null,locks=navigator.locks,namespace=typeof location==='undefined'?'wifi-file-transfer-web':location.origin+location.pathname.replace(/index\.html$/,'')}){
  Object.assign(this,{uuid,name,peer1Id,db,PeerClass,options,onChange,onState,channelFactory,locks});this.prefix='wftp-'+namespaceId(namespace)+'-';this.connections=new Map();this.pending=new Map();this.seen=new Map();this.enabled=false;this.leader=false;this.sessionId=crypto.randomUUID();
 }
 state(value,detail=''){this.onState(value,detail);}
 async start(){
  if(this.stopping)await this.stopping;
  if(this.enabled){await this.publish();return;}
  this.enabled=true;this.channel=this.channelFactory?.('wft-presence-v1');this.channel?.addEventListener('message',e=>this.handleTabMessage(e.data));
  this.state('connecting','Starting Peer 2 online discovery…');
  if(this.locks?.request){
   await this.tryLeadership();this.standbyTimer=setInterval(()=>{if(this.enabled&&!this.leader&&Date.now()>=(this.retryAt||0))void this.tryLeadership();},5000);
  }else{this.leader=true;try{await this.startNetwork();}catch(e){this.abortNetwork();this.starting=false;this.leader=false;throw e;}}
 }
 async tryLeadership(){if(this.lockPending||!this.enabled||this.leader)return;this.lockPending=true;let settled=false,decided;const ready=new Promise(r=>decided=()=>{if(!settled){settled=true;r();}});
  this.lockTask=this.locks.request('wft-presence-leader',{ifAvailable:true},async lock=>{this.lockPending=false;if(!this.enabled){decided();return;}if(!lock){this.state('standby','Peer 2 is active in another tab.');decided();return;}this.leader=true;try{await this.startNetwork();this.failureCount=0;this.retryAt=0;decided();await new Promise(r=>this.releaseLock=r);}catch(e){this.abortNetwork();this.starting=false;this.leader=false;this.failureCount=(this.failureCount||0)+1;this.retryAt=Date.now()+[5000,15000,30000,60000][Math.min(3,this.failureCount-1)];this.state('failed',e.message);decided();}}).catch(e=>{this.lockPending=false;this.state('failed',e.message);decided();});await ready;
 }
 abortNetwork(){clearInterval(this.timer);for(const timer of this.pending.values())clearTimeout(timer);this.pending.clear();for(const c of this.connections.values())c.close();this.connections.clear();this.peer?.destroy();this.peer=null;this.peer2Id='';}
 async startNetwork(){
  if(!this.enabled||this.starting)return;this.starting=true;const slot=slotFor(this.uuid),slotId=this.prefix+slot;
  try{this.peer=await this.createPeer(slotId);this.isSlotLeader=true;}
  catch(e){if(e.type!=='unavailable-id')throw e;this.peer=await this.createPeer();this.isSlotLeader=false;}
  this.peer2Id=this.peer.id;
  this.peer.on('connection',c=>this.accept(c));
  this.peer.on('disconnected',()=>{if(this.enabled){this.state('reconnecting','Peer 2 signaling interrupted…');try{this.peer.reconnect();}catch{}}});
  this.peer.on('error',e=>{if(!['peer-unavailable','unavailable-id'].includes(e.type))this.state('failed',`Peer 2 connection failed (${e.type||'network'}).`);});
  await this.refreshSelf(true);await this.publish();
  await this.ensureTopology();
  this.timer=setInterval(()=>void this.tick().catch(e=>this.state('failed',e.message)),HEARTBEAT_MS);
  this.state('connected',`Online · Peer 2 active · ${this.peer2Id}`);
  this.starting=false;
 }
 createPeer(id){return new Promise((resolve,reject)=>{const p=new this.PeerClass(id,this.options),timer=setTimeout(()=>{p.destroy();reject(Error('Peer 2 service did not respond.'));},20000);let done=false;p.on('open',()=>{if(done)return;done=true;clearTimeout(timer);resolve(p);});p.on('error',e=>{if(done)return;done=true;clearTimeout(timer);p.destroy();reject(e);});});}
 accept(conn){if(conn.metadata?.kind!=='presence-v1'||this.connections.size>=24){conn.on('open',()=>conn.close());return;}this.attach(conn);}
 attach(conn){
  const id=conn.peer,old=this.connections.get(id);if(old&&old!==conn)old.close();
  const pendingTimer=this.pending.get(id);if(pendingTimer){clearTimeout(pendingTimer);this.pending.delete(id);}
  this.connections.set(id,conn);
  conn.on('open',()=>{const timer=this.pending.get(id);if(timer){clearTimeout(timer);this.pending.delete(id);}void this.sendSummary(conn);});
  conn.on('data',m=>void this.handleMessage(conn,m));
  const clean=()=>{if(this.connections.get(id)===conn)this.connections.delete(id);const timer=this.pending.get(id);if(timer){clearTimeout(timer);this.pending.delete(id);}};
  conn.on('close',clean);conn.on('error',clean);if(conn.open)void this.sendSummary(conn);
 }
 connect(id){
  if(!this.peer||!this.enabled||id===this.peer.id||this.connections.has(id)||this.pending.has(id))return;
  try{
   const conn=this.peer.connect(id,{reliable:true,serialization:'json',metadata:{kind:'presence-v1',uuid:this.uuid}});
   const timer=setTimeout(()=>{this.pending.delete(id);if(!conn.open)conn.close();},CONNECT_TIMEOUT);this.pending.set(id,timer);this.attach(conn);
  }catch{}
 }
 async ensureTopology(){
  if(!this.peer||!this.enabled)return;
  // Every Peer 2 attempts every deterministic rendezvous slot. This removes the
  // old directional topology where some join orders could take a long time to converge.
  for(let i=0;i<SLOTS;i++){const id=this.prefix+i;if(id!==this.peer.id)this.connect(id);}
  // Also dial Peer 2 IDs learned from fresh presence rows. This turns rendezvous
  // into bootstrap only; active users then synchronize directly when reachable.
  const rows=await this.db.online();for(const row of rows)if(row.uuid!==this.uuid&&row.peer2Id)this.connect(row.peer2Id);
 }
 envelope(type,payload){return {type,messageId:crypto.randomUUID(),originUuid:this.uuid,sentAt:Date.now(),payload};}
 send(conn,type,payload){if(!conn.open)return;const message=this.envelope(type,payload);if(JSON.stringify(message).length<=MAX_MESSAGE)conn.send(message);}
 async sendSummary(conn){const rows=await this.db.all();this.send(conn,'SYNC_SUMMARY',{records:rows.slice(0,MAX_RECORDS).map(({uuid,revision,heartbeatSeq,updatedAt})=>({uuid,revision,heartbeatSeq,updatedAt}))});}
 validEnvelope(m){if(!m||typeof m!=='object'||!uuidOk(m.originUuid)||!uuidOk(m.messageId)||!Number.isFinite(m.sentAt)||Math.abs(Date.now()-m.sentAt)>10*60*1000)return false;const size=JSON.stringify(m).length;if(size>MAX_MESSAGE||this.seen.has(m.messageId))return false;this.seen.set(m.messageId,Date.now());return true;}
 async handleMessage(conn,m){
  if(!this.validEnvelope(m))return;
  try{
   if(m.type==='SYNC_SUMMARY'){
    const heads=m.payload?.records;if(!Array.isArray(heads)||heads.length>MAX_RECORDS)return;const remote=new Map();for(const h of heads)if(uuidOk(h?.uuid)&&['revision','heartbeatSeq','updatedAt'].every(k=>Number.isSafeInteger(h[k])&&h[k]>=0))remote.set(h.uuid,h);
    const local=await this.db.all(),byId=new Map(local.map(r=>[r.uuid,r])),send=[],request=[];
    for(const row of local){const head=remote.get(row.uuid);if(!head||comparePresence(row,{...row,...head})>0)send.push(row);}
    for(const [id,head] of remote){const row=byId.get(id);if(!row||comparePresence(row,{...row,...head})<0)request.push(id);}
    if(send.length)this.send(conn,'SYNC_RECORDS',{records:send});if(request.length)this.send(conn,'SYNC_REQUEST',{uuids:request});
   }else if(m.type==='SYNC_REQUEST'){
    const ids=m.payload?.uuids;if(!Array.isArray(ids)||ids.length>MAX_RECORDS||ids.some(id=>!uuidOk(id)))return;const wanted=new Set(ids),rows=(await this.db.all()).filter(r=>wanted.has(r.uuid));if(rows.length)this.send(conn,'SYNC_RECORDS',{records:rows});
   }else if(m.type==='SYNC_RECORDS'){
    const rows=m.payload?.records;if(!Array.isArray(rows)||rows.length>MAX_RECORDS||rows.some(r=>!validPresence(r)))return;await this.db.merge(rows);await this.publish();await this.ensureTopology();for(const c of this.connections.values())if(c!==conn)void this.sendSummary(c);
   }
  }catch{this.state('connected','Peer 2 ignored an invalid presence update.');}
 }
 revision(change=false){const key='wft-presence-revision';let value=this.localRevision||0;try{value=Math.max(value,Number(localStorage.getItem(key))||0);if(change)localStorage.setItem(key,String(++value));}catch{if(change)value++;}this.localRevision=value;return value;}
 async refreshSelf(change=false,status='online'){
  const previous=await this.db.all().then(rows=>rows.find(r=>r.uuid===this.uuid));const identityChanged=!previous||previous.name!==this.name||previous.peerId!==this.peer1Id||previous.peer2Id!==this.peer2Id||previous.status!==status;
  const now=Date.now(),revision=this.revision(change||identityChanged),row={uuid:this.uuid,name:this.name.trim().slice(0,48)||'My device',peerId:this.peer1Id||'',peer2Id:this.peer2Id||'',status,version:revision,revision,heartbeatSeq:(previous?.heartbeatSeq||0)+1,lastSeen:now,updatedAt:now};await this.db.put(row,now);this.self=row;return row;
 }
 async tick(){if(this.tickPromise)return this.tickPromise;this.tickPromise=this.runTick().finally(()=>{this.tickPromise=null;});return this.tickPromise;}
 async runTick(){if(!this.enabled||!this.leader)return;for(const [id,time] of this.seen)if(Date.now()-time>10*60*1000)this.seen.delete(id);await this.refreshSelf();if(!this.enabled)return;await this.db.cleanup();await this.ensureTopology();for(const conn of this.connections.values())void this.sendSummary(conn);await this.publish();}
 async publish(){const users=await this.db.online();this.onChange(users);this.channel?.postMessage({type:'users',users});}
 handleTabMessage(message){if(!this.leader&&message?.type==='users'&&Array.isArray(message.users))this.onChange(message.users.filter(r=>validPresence(r)));}
 async setIdentity({name=this.name,peer1Id=this.peer1Id}){const changed=name!==this.name||peer1Id!==this.peer1Id;this.name=name;this.peer1Id=peer1Id;if(changed&&this.enabled&&this.leader){await this.refreshSelf(true);for(const c of this.connections.values())void this.sendSummary(c);await this.publish();}}
 async stop(){if(this.stopping)return this.stopping;if(!this.enabled)return;this.stopping=this.stopNow();try{await this.stopping;}finally{this.stopping=null;}}
 async stopNow(){
  if(!this.enabled)return;this.enabled=false;clearInterval(this.timer);clearInterval(this.standbyTimer);await this.tickPromise?.catch(()=>{});
  if(this.leader&&this.peer){try{await this.refreshSelf(true,'offline');for(const c of this.connections.values())this.send(c,'SYNC_RECORDS',{records:[this.self]});}catch{}await new Promise(r=>setTimeout(r,100));}
  for(const timer of this.pending.values())clearTimeout(timer);this.pending.clear();for(const c of this.connections.values())c.close();this.connections.clear();this.peer?.destroy();this.peer=null;this.peer2Id='';this.leader=false;this.releaseLock?.();this.releaseLock=null;this.channel?.close();this.channel=null;this.state('offline','Peer 2 stopped · online discovery disabled.');
 }
}
