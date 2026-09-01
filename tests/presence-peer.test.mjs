import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PresencePeerManager} from '../src/presence-peer.js';
import {mergePresenceRecords} from '../src/presence-db.js';
globalThis.localStorage={data:new Map(),getItem(k){return this.data.get(k)??null;},setItem(k,v){this.data.set(k,String(v));}};
class MemoryDB{constructor(){this.rows=[];}async all(){return structuredClone(this.rows);}async merge(rows,now=Date.now()){this.rows=mergePresenceRecords(this.rows,rows,now);return this.all();}async put(r,n){await this.merge([r],n);}async cleanup(){return [];}async online(){return this.rows.filter(r=>r.status==='online');}}
class Conn extends EventEmitter{constructor(peer){super();this.peer=peer;this.open=false;}send(m){queueMicrotask(()=>this.other.emit('data',structuredClone(m)));}close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}}
class FakePeer extends EventEmitter{
 static peers=new Map();static seq=0;
 constructor(id){super();this.id=id||'unique-'+(++FakePeer.seq);if(FakePeer.peers.has(this.id)){queueMicrotask(()=>this.emit('error',{type:'unavailable-id'}));return;}FakePeer.peers.set(this.id,this);queueMicrotask(()=>this.emit('open',this.id));}
 connect(id,options){const a=new Conn(id),b=new Conn(this.id);a.other=b;b.other=a;b.metadata=a.metadata=options.metadata;const target=FakePeer.peers.get(id);queueMicrotask(()=>{if(!target){this.emit('error',{type:'peer-unavailable'});a.emit('error',Error('missing'));return;}a.open=b.open=true;target.emit('connection',b);a.emit('open');b.emit('open');});return a;}
 reconnect(){}destroy(){if(FakePeer.peers.get(this.id)===this)FakePeer.peers.delete(this.id);for(const event of ['connection','open','error'])this.removeAllListeners(event);this.emit('disconnected');}
}
const uuid=n=>`${n.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('three online peers converge through separate rendezvous shards without mixing transfer peers',async()=>{
 FakePeer.peers.clear();const managers=[];const dbs=[];
 for(let n=1;n<=3;n++){const db=new MemoryDB();dbs.push(db);const manager=new PresencePeerManager({uuid:uuid(n),name:'Device '+n,peer1Id:'transfer-'+n,db,PeerClass:FakePeer,options:{},locks:null,channelFactory:()=>null});managers.push(manager);await manager.start();}
 for(let i=0;i<10&&!dbs.every(d=>d.rows.length===3);i++){await Promise.all(managers.map(m=>m.tick()));await delay(10);}
 for(const db of dbs){assert.equal(db.rows.length,3);assert.deepEqual(new Set(db.rows.map(r=>r.uuid)).size,3);assert.ok(db.rows.every(r=>r.peerId.startsWith('transfer-')));}
 await managers[1].setIdentity({name:'Renamed',peer1Id:'transfer-new'});for(let i=0;i<5;i++){await Promise.all(managers.map(m=>m.tick()));await delay(10);}
 for(const db of dbs)assert.equal(db.rows.find(r=>r.uuid===uuid(2)).peerId,'transfer-new');
 await Promise.all(managers.map(m=>m.stop()));
});
test('repeated start does not create duplicate timers or peers and stop publishes offline',async()=>{
 FakePeer.peers.clear();const db=new MemoryDB(),m=new PresencePeerManager({uuid:uuid(9),name:'Only',db,PeerClass:FakePeer,options:{},locks:null,channelFactory:()=>null});
 await m.start();const peer=m.peer,timer=m.timer;await m.start();assert.equal(m.peer,peer);assert.equal(m.timer,timer);await m.stop();assert.equal((await db.all()).find(r=>r.uuid===uuid(9)).status,'offline');assert.equal(m.connections.size,0);
});
test('malformed and oversized sync messages are ignored',async()=>{
 FakePeer.peers.clear();const db=new MemoryDB(),m=new PresencePeerManager({uuid:uuid(8),name:'Safe',db,PeerClass:FakePeer,options:{},locks:null,channelFactory:()=>null});await m.start();const before=(await db.all()).length;
 await m.handleMessage({open:true,send(){}},{type:'SYNC_RECORDS',messageId:crypto.randomUUID(),originUuid:uuid(7),sentAt:Date.now(),payload:{records:Array(257).fill({})}});
 assert.equal((await db.all()).length,before);await m.stop();
});

test('client re-elects its rendezvous slot after the browser holding it leaves',async()=>{
 FakePeer.peers.clear();const hash=x=>[...x].reduce((n,c)=>(n*33+c.charCodeAt(0))>>>0,5381)%4;
 let a=20,b=21;while(hash(uuid(a))!==hash(uuid(b)))b++;
 const leader=new PresencePeerManager({uuid:uuid(a),name:'Leader',db:new MemoryDB(),PeerClass:FakePeer,options:{},locks:null,channelFactory:()=>null});
 const client=new PresencePeerManager({uuid:uuid(b),name:'Client',db:new MemoryDB(),PeerClass:FakePeer,options:{},locks:null,channelFactory:()=>null});
 try{await leader.start();await client.start();assert.equal(client.isSlotLeader,false);await leader.stop();
  for(let i=0;i<8&&!client.isSlotLeader;i++){await client.ensureTopology();await delay(20);}
  assert.equal(client.isSlotLeader,true);
 }finally{await leader.stop();await client.stop();}
});
