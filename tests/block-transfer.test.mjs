import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {BlockTransfer,decodeChunk,encodeChunk,manifestFor,transportPlan} from '../src/block-transfer.js';
import {CheckpointHash,blockHash} from '../src/integrity.js';
import {BLOCK_SIZE} from '../src/storage.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<1500;i++){if(fn())return;await sleep(10);}throw Error('Test timed out');}
class Store {map=new Map();async get(id){return structuredClone(this.map.get(id));}async put(r){this.map.set(r.id,structuredClone(r));}async remove(id){this.map.delete(id);}}
function storageClass(){const files=new Map();return class {
  static async open(record){const s=new this();s.record=record;return s;}
  key(f,b){return `${this.record.transferId}:${f}:${b}`;}
  async write(f,b,data){files.set(this.key(f,b),new Uint8Array(data));}
  async verifyPrefix(f,state){for(let b=0;b<state.next;b++)if(!files.has(this.key(f,b)))return b;return state.next;}
  async finalize(f,state,digest,progress){const hash=new CheckpointHash(),parts=[];for(let b=0;b<state.next;b++){const bytes=files.get(this.key(f,b));hash.update(bytes);parts.push(bytes);progress((b+1)*BLOCK_SIZE);}assert.equal(hash.digest(),digest);state.complete=true;state.digest=digest;return {blob:new Blob(parts)};}
  async completedFile(f){return this.finalize(f,this.record.files[f],this.record.files[f].digest,()=>{});}
  async cleanup(){files.clear();}
};}
function pair(tweak=x=>x){
  class Connection extends EventEmitter {
    open=true;dataChannel={bufferedAmount:0};peerConnection={sctp:{maxMessageSize:65536}};
    send(raw){if(!this.open)throw Error('Closed');const data=tweak(structuredClone(raw),this);if(data!==undefined)queueMicrotask(()=>{if(this.other.open)this.other.emit('data',data);});}
    close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}
  }const a=new Connection(),b=new Connection();a.other=b;b.other=a;return[a,b];
}
const makeFile=size=>new File([Uint8Array.from({length:size},(_,i)=>i%251)],'binary.zip',{lastModified:123});
test('checkpoint hashes survive partial blocks and large byte counters',()=>{
  const h=new CheckpointHash();h.update(new Uint8Array(73));const restored=new CheckpointHash(h.snapshot());h.update(new Uint8Array(77));restored.update(new Uint8Array(77));assert.equal(h.digest(),restored.digest());
  const snapshot=h.snapshot();snapshot.length=10*1024**3+22;snapshot.pos=snapshot.length%64;snapshot.buffer=Array(64).fill(0);assert.equal(new CheckpointHash(snapshot).snapshot().length,10*1024**3+22);
});
test('10 GB metadata and bound binary frames do not truncate file sizes',()=>{
  assert.equal(manifestFor([{name:'10gb.bin',size:10*1024**3,lastModified:1}])[0].size,10*1024**3);
  const id=crypto.randomUUID(),raw=encodeChunk(id,3,1279,42,new Uint8Array([1,2]).buffer);assert.equal(decodeChunk(raw,id).block,1279);assert.throws(()=>decodeChunk(raw,crypto.randomUUID()));
});
test('turbo transport uses negotiated large frames and a deep bounded send window',()=>{
  const plan=transportPlan({peerConnection:{sctp:{maxMessageSize:262144}}});
  assert.equal(plan.payload,262144-36);assert.ok(plan.high>=8*1024*1024&&plan.high<=32*1024*1024);assert.ok(plan.low>=2*1024*1024&&plan.low<plan.high);
});
test('turbo transport reduces frame count when SCTP permits larger messages',async()=>{
  let frames=0;const[a,b]=pair(raw=>{if(raw instanceof ArrayBuffer)frames++;return raw;});a.peerConnection.sctp.maxMessageSize=262144;
  const store=new Store(),Storage=storageClass(),receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});
  const sender=new BlockTransfer(a,{store,files:[makeFile(600000)]});await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.ok(frames<=3,`Expected at most 3 binary frames, got ${frames}`);
});
test('block protocol sends binary and empty files, with final verification',async()=>{
  const[a,b]=pair(),store=new Store(),Storage=storageClass(),received=[];const file=makeFile(BLOCK_SIZE+321);
  const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'}),onFile:f=>received.push(f)});
  const sender=new BlockTransfer(a,{store,files:[file,new File([],'empty')]});await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.equal(await blockHash(await received[0].blob.arrayBuffer()),await blockHash(await file.arrayBuffer()));assert.equal(received[1].blob.size,0);
});
test('corrupt block is retransmitted without restarting the whole transfer',async()=>{
  let corrupt=true,starts=0;const[a,b]=pair(raw=>{if(typeof raw==='string'&&JSON.parse(raw).type==='block-start')starts++;if(raw instanceof ArrayBuffer&&corrupt){new Uint8Array(raw)[raw.byteLength-1]^=255;corrupt=false;}return raw;});
  const store=new Store(),Storage=storageClass();const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});const sender=new BlockTransfer(a,{store,files:[makeFile(200000)]});await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(starts,2);assert.equal(receiver.state,'complete');
});
test('network interruption resumes at the next verified block',async()=>{
  let broken=false;const starts=[];const[a,b]=pair((raw,conn)=>{if(typeof raw==='string'&&JSON.parse(raw).type==='block-start')starts.push(JSON.parse(raw).block);if(raw instanceof ArrayBuffer&&new DataView(raw).getUint32(24)===1&&!broken){broken=true;conn.close();return;}return raw;});
  const store=new Store(),Storage=storageClass();const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});const sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE*2+11)]});
  await until(()=>sender.state==='reconnecting'&&receiver.state==='reconnecting');const verified=receiver.record.files[0].next;assert.ok(verified>=0&&verified<=1);
  const before=new Map();for(let b=0;b<verified;b++)before.set(b,starts.filter(x=>x===b).length);
  const[c,d]=pair(raw=>{if(typeof raw==='string'&&JSON.parse(raw).type==='block-start')starts.push(JSON.parse(raw).block);return raw;});receiver.attach(d);sender.attach(c);await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);for(const [b,count] of before)assert.equal(starts.filter(x=>x===b).length,count,`verified block ${b} must not be resent`);assert.equal(receiver.state,'complete');
});
test('receiver never accepts bytes before explicit consent',async()=>{
  const[a,b]=pair(),store=new Store(),Storage=storageClass();let offered=false;const receiver=new BlockTransfer(b,{store,Storage,onOffer:()=>{offered=true;}});const sender=new BlockTransfer(a,{store,files:[makeFile(1024)]});await until(()=>offered);assert.equal(receiver.record,undefined);assert.equal(sender.state,'waiting');receiver.decline();await until(()=>sender.terminal());assert.equal(sender.state,'declined');
});
test('pause stops binary traffic and resume continues with verified completion',async()=>{
 let chunks=0,paused=false,sender;const[a,b]=pair(raw=>{if(raw instanceof ArrayBuffer){chunks++;if(!paused){paused=true;sender.pause();}}return raw;});
 const store=new Store(),Storage=storageClass();const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});sender=new BlockTransfer(a,{store,files:[makeFile(300000)]});await until(()=>paused);const before=chunks;await sleep(150);assert.equal(chunks,before);assert.equal(sender.state,'paused');sender.resume();await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');
});
test('storage quota failure propagates and never acknowledges or completes the block',async()=>{
 let acknowledgements=0;const[a,b]=pair(raw=>{if(typeof raw==='string'&&JSON.parse(raw).type==='block-ack')acknowledgements++;return raw;});const store=new Store(),Base=storageClass();class Full extends Base {async write(){throw new DOMException('full','QuotaExceededError');}}
 const receiver=new BlockTransfer(b,{store,Storage:Full,onOffer:(_,t)=>t.accept({storage:'test'})});const sender=new BlockTransfer(a,{store,files:[makeFile(50000)]});await until(()=>sender.terminal());assert.equal(sender.state,'failed');assert.match(sender.detail,/Storage is full/);assert.equal(receiver.record.files[0].next,0);assert.equal(acknowledgements,0);
});
test('source re-selection after refresh rejects changed bytes even with matching metadata',async()=>{
 let broken=false;const[a,b]=pair((raw,c)=>{if(raw instanceof ArrayBuffer&&new DataView(raw).getUint32(24)===1&&!broken){broken=true;c.close();return;}return raw;});const store=new Store(),Storage=storageClass(),file=makeFile(BLOCK_SIZE+20);
 const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});const first=new BlockTransfer(a,{store,files:[file]});await until(()=>first.state==='reconnecting');const saved=await store.get(first.record.id);clearInterval(first.heartbeat);clearInterval(receiver.heartbeat);
 const changed=new Uint8Array(await file.arrayBuffer());changed[20]^=1;const[c,d]=pair();const secondReceiver=new BlockTransfer(d,{store,Storage});const sender=new BlockTransfer(c,{store,record:saved,reselected:true,files:[new File([changed],file.name,{lastModified:file.lastModified})]});await until(()=>sender.terminal());assert.equal(sender.state,'failed');assert.match(sender.detail,/source file changed/);await until(()=>secondReceiver.terminal());
});
test('backpressure waits for native bufferedamountlow before sending file bytes',async()=>{
 const[a,b]=pair(),store=new Store(),Storage=storageClass();const channel=new EventTarget();channel.bufferedAmount=40*1024*1024;a.dataChannel=channel;
 const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});const sender=new BlockTransfer(a,{store,files:[makeFile(10000)]});await until(()=>sender.state==='transferring');await sleep(100);assert.equal(receiver.record.files[0].next,0);assert.equal(receiver.blocks.size,0);channel.bufferedAmount=0;channel.dispatchEvent(new Event('bufferedamountlow'));await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);
});
test('direct-save policy rejects browser storage before any payload is accepted',async()=>{
 const[a,b]=pair(),store=new Store(),Storage=storageClass();const receiver=new BlockTransfer(b,{store,Storage,requireDirectory:true,onOffer:(_,t)=>t.accept({storage:'opfs'})});const sender=new BlockTransfer(a,{store,files:[makeFile(1024)]});await until(()=>sender.terminal());assert.equal(sender.state,'failed');assert.match(sender.detail,/Choose a device folder/);assert.equal(receiver.record,undefined);
});


test('parallel transfer lanes stripe a large file across independent connections',async()=>{
  let primaryFrames=0,laneFrames=0;
  const[a,b]=pair(raw=>{if(raw instanceof ArrayBuffer)primaryFrames++;return raw;});
  const store=new Store(),Storage=storageClass();
  const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});
  const sender=new BlockTransfer(a,{store,Storage,files:[makeFile(BLOCK_SIZE*2+12345)],laneCount:3,openLane:index=>{
    const[out,inc]=pair(raw=>{if(raw instanceof ArrayBuffer)laneFrames++;return raw;});receiver.addLane(inc,index);return out;
  }});
  await until(()=>sender.terminal());
  assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');
  assert.ok(primaryFrames>0,'primary lane should carry file frames');assert.ok(laneFrames>0,'extra PeerConnections should carry file frames');
});

test('receiver assembles non-overlapping frames that arrive out of order',()=>{
  const[a,b]=pair(),store=new Store(),Storage=storageClass(),receiver=new BlockTransfer(b,{store,Storage});
  const id=crypto.randomUUID(),block={file:0,index:0,hash:'0'.repeat(64),data:new Uint8Array(6),received:0,buckets:new Map(),endSeen:false,finalizing:null};receiver.id=id;receiver.blocks.set('0:0',block);
  receiver.receiveBinary(encodeChunk(id,0,0,3,new Uint8Array([4,5,6]).buffer));
  receiver.receiveBinary(encodeChunk(id,0,0,0,new Uint8Array([1,2,3]).buffer));
  assert.deepEqual([...block.data],[1,2,3,4,5,6]);assert.equal(block.received,6);
  clearInterval(receiver.heartbeat);a.close();
});

test('sliding window keeps multiple durable blocks in flight before earlier ACKs',async()=>{
  let outstanding=0,maxOutstanding=0;const[a,b]=pair(raw=>{if(typeof raw==='string'){const m=JSON.parse(raw);if(m.type==='block-start'){outstanding++;maxOutstanding=Math.max(maxOutstanding,outstanding);}if(m.type==='block-ack')outstanding=Math.max(0,outstanding-1);}return raw;});
  const store=new Store(),Storage=storageClass(),receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});
  const sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE*4+777)]});await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.ok(maxOutstanding>=2,`expected pipelined blocks, saw ${maxOutstanding}`);
});


test('50 lanes negotiate 100 blocks and transfer a single file with serialized writes',async()=>{
 const [a,b]=pair(),store=new Store(),Base=storageClass();let writers=0,maxWriters=0;const used=new Set();
 class Serial extends Base{async write(...args){writers++;maxWriters=Math.max(maxWriters,writers);await sleep(2);await super.write(...args);writers--;}}
 const receiver=new BlockTransfer(b,{store,Storage:Serial,onOffer:(_,t)=>t.accept({storage:'test'})});
 const sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE*2+12345)],laneCount:50,openLane:index=>{
  const [out,inc]=pair(raw=>{if(raw instanceof ArrayBuffer)used.add(index);return raw;});assert.equal(receiver.addLane(inc,index),true);return out;
 }});
 await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');
 assert.deepEqual(sender.parallelism,{lanes:50,blocks:100});assert.deepEqual(receiver.parallelism,sender.parallelism);assert.equal(sender.lanes.size,50);assert.equal(used.size,49);assert.equal(maxWriters,1);
});
test('sender falls back to original limits when receiver omits negotiation',async()=>{
 const [a,b]=pair(raw=>{if(typeof raw==='string'){const m=JSON.parse(raw);if(m.type==='accept'){delete m.parallelism;return JSON.stringify(m);}}return raw;});
 const store=new Store(),receiver=new BlockTransfer(b,{store,Storage:storageClass(),onOffer:(_,t)=>t.accept({storage:'test'})});
 const sender=new BlockTransfer(a,{store,files:[makeFile(1000)],laneCount:50});await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.deepEqual(sender.parallelism,{lanes:3,blocks:4});assert.equal(receiver.state,'complete');
});
test('invalid peer parallelism fails before file acceptance or payload',async()=>{
 const [a,b]=pair(raw=>{if(typeof raw==='string'){const m=JSON.parse(raw);if(m.type==='hello'){m.parallelism={lanes:50,blocks:101};return JSON.stringify(m);}}return raw;});
 const store=new Store();let offered=false;
 const receiver=new BlockTransfer(b,{store,Storage:storageClass(),onOffer:()=>{offered=true;}}),sender=new BlockTransfer(a,{store,files:[makeFile(1)]});
 await until(()=>sender.terminal());assert.equal(sender.state,'failed');assert.equal(receiver.state,'failed');assert.equal(offered,false);assert.match(sender.detail,/parallelism/);
});

test('negotiated 100-block receiver window accepts its last slot and rejects overflow',async()=>{
 const [a,b]=pair(),receiver=new BlockTransfer(b,{store:new Store(),Storage:storageClass()});
 receiver.id=crypto.randomUUID();receiver.parallelism={lanes:50,blocks:100};receiver.manifest=[{size:BLOCK_SIZE*101}];receiver.record={files:[{next:0,complete:false}]};receiver.storage={};
 try{
  await receiver.receiveControl({type:'block-start',file:0,block:99,size:BLOCK_SIZE,hash:'0'.repeat(64)},receiver.epoch);
  assert.equal(receiver.blocks.size,1);
  await assert.rejects(()=>receiver.receiveControl({type:'block-start',file:0,block:100,size:BLOCK_SIZE,hash:'0'.repeat(64)},receiver.epoch),/Invalid block/);
  const [extra]=pair();assert.equal(receiver.addLane(extra,50),false);assert.equal(extra.open,false);
 }finally{clearInterval(receiver.heartbeat);receiver.state='complete';a.close();}
});

test('live slider increases to 50/100 then decreases to 8/16 after draining blocks',async()=>{
 let sender,receiver,phase=0;const updates=[];
 const observe=raw=>{
  if(typeof raw==='string'){
   const m=JSON.parse(raw);
   if(m.type==='parallelism-update'){assert.equal(receiver.blocks.size,0);assert.equal(receiver.completedData.size,0);updates.push(m.parallelism.lanes);}
  }else if(raw instanceof ArrayBuffer&&sender){
   if(phase===0){phase=1;sender.setLaneCount(25);sender.setLaneCount(50);}
   else if(phase===1&&sender.parallelism.lanes===50){phase=2;sender.setLaneCount(8);}
  }
  return raw;
 };
 const [a,b]=pair(observe),store=new Store();receiver=new BlockTransfer(b,{store,Storage:storageClass(),onOffer:(_,t)=>t.accept({storage:'test'})});
 sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE*6+100)],openLane:index=>{const [out,inc]=pair(observe);receiver.addLane(inc,index);return out;}});
 await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.equal(phase,2);assert.deepEqual(updates,[50,8]);assert.deepEqual(sender.parallelism,{lanes:8,blocks:16});assert.deepEqual(receiver.parallelism,sender.parallelism);assert.equal(sender.lanes.size,8);assert.equal(receiver.lanes.size,8);
});
test('live setting stays pending while paused and applies after resume',async()=>{
 let sender,paused=false;const updates=[];
 const observe=raw=>{if(raw instanceof ArrayBuffer&&!paused){paused=true;sender.pause();sender.setLaneCount(50);}if(typeof raw==='string'&&JSON.parse(raw).type==='parallelism-update')updates.push(JSON.parse(raw));return raw;};
 const [a,b]=pair(observe),store=new Store(),receiver=new BlockTransfer(b,{store,Storage:storageClass(),onOffer:(_,t)=>t.accept({storage:'test'})});
 sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE*3+1)]});
 await until(()=>paused);await sleep(100);assert.equal(updates.length,0);assert.equal(sender.parallelism.lanes,8);sender.resume();await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.equal(updates.length,1);assert.equal(sender.parallelism.lanes,50);
});
test('older receiver continues without receiving unsupported live control messages',async()=>{
 let sender,changed=false,liveMessages=0;
 const [a,b]=pair(raw=>{
  if(typeof raw==='string'){const m=JSON.parse(raw);if(m.type==='accept'){delete m.liveParallelism;return JSON.stringify(m);}if(m.type==='parallelism-update')liveMessages++;}
  else if(!changed){changed=true;sender.setLaneCount(50);}return raw;
 });
 const store=new Store(),receiver=new BlockTransfer(b,{store,Storage:storageClass(),onOffer:(_,t)=>t.accept({storage:'test'})});
 sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE+1)]});await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.equal(liveMessages,0);assert.equal(sender.parallelism.lanes,8);assert.equal(sender.requestedParallelism.lanes,50);
});
test('cancelling with a pending slider increase does not open more lanes',async()=>{
 let sender,changed=false,updates=0;
 const [a,b]=pair(raw=>{if(raw instanceof ArrayBuffer&&!changed){changed=true;sender.setLaneCount(50);sender.cancel();}if(typeof raw==='string'&&JSON.parse(raw).type==='parallelism-update')updates++;return raw;});
 const store=new Store(),receiver=new BlockTransfer(b,{store,Storage:storageClass(),onOffer:(_,t)=>t.accept({storage:'test'})});sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE+1)]});
 await until(()=>receiver.terminal());assert.equal(sender.state,'cancelled');assert.equal(receiver.state,'cancelled');assert.equal(updates,0);await receiver.cleanupPromise;
});

test('interruption while applying a live setting resumes using the latest request',async()=>{
 let sender,changed=false,broken=false;
 const [a,b]=pair((raw,conn)=>{
  if(raw instanceof ArrayBuffer&&!changed){changed=true;sender.setLaneCount(25);}
  if(typeof raw==='string'&&JSON.parse(raw).type==='parallelism-ready'&&!broken){broken=true;conn.close();return;}
  return raw;
 });
 const store=new Store(),receiver=new BlockTransfer(b,{store,Storage:storageClass(),onOffer:(_,t)=>t.accept({storage:'test'})});sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE*3+1)]});
 await until(()=>sender.state==='reconnecting'&&receiver.state==='reconnecting');assert.equal(broken,true);
 sender.setLaneCount(50);const [c,d]=pair();receiver.attach(d);sender.attach(c);await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.deepEqual(sender.parallelism,{lanes:50,blocks:100});assert.deepEqual(receiver.parallelism,sender.parallelism);
});
test('receiver rejects a live change while blocks are outstanding',async()=>{
 const [a,b]=pair(),receiver=new BlockTransfer(b,{store:new Store(),Storage:storageClass()});receiver.id=crypto.randomUUID();receiver.liveParallelism=true;receiver.record={};receiver.storage={};receiver.blocks.set('0:0',{});
 try{await assert.rejects(()=>receiver.receiveControl({type:'parallelism-update',parallelism:{lanes:50,blocks:100}},receiver.epoch),/active blocks/);assert.equal(receiver.parallelism.lanes,8);}
 finally{clearInterval(receiver.heartbeat);receiver.state='complete';a.close();}
});
