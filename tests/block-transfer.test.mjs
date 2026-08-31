import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {BlockTransfer,decodeChunk,encodeChunk,manifestFor} from '../src/block-transfer.js';
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
  await until(()=>sender.state==='reconnecting'&&receiver.state==='reconnecting');assert.equal(receiver.record.files[0].next,1);
  const[c,d]=pair(raw=>{if(typeof raw==='string'&&JSON.parse(raw).type==='block-start')starts.push(JSON.parse(raw).block);return raw;});receiver.attach(d);sender.attach(c);await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(starts.filter(x=>x===0).length,1);assert.equal(receiver.state,'complete');
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
 const[a,b]=pair(),store=new Store(),Storage=storageClass();const channel=new EventTarget();channel.bufferedAmount=2*1024*1024;a.dataChannel=channel;
 const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});const sender=new BlockTransfer(a,{store,files:[makeFile(10000)]});await until(()=>sender.state==='transferring');await sleep(100);assert.equal(receiver.record.files[0].next,0);assert.equal(receiver.block,null);channel.bufferedAmount=0;channel.dispatchEvent(new Event('bufferedamountlow'));await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);
});
