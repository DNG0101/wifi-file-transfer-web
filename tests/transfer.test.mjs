import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Transfer,memorySink,validateManifest,safeName,directorySink } from '../src/transfer.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await wait(5);}throw Error('test timeout');}
function pair(tweak=x=>x){
  class Conn extends EventEmitter {open=true; dataChannel={bufferedAmount:0};send(data){if(!this.open)throw Error('closed');const copy=structuredClone(tweak(data));queueMicrotask(()=>{if(this.other.open)this.other.emit('data',copy);});}close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}}
  const a=new Conn(),b=new Conn();a.other=b;b.other=a;return [a,b];
}
test('binary, empty, and multiple files arrive byte-for-byte, only after consent',async()=>{
  const [a,b]=pair();const payload=Uint8Array.from({length:2*1024*1024+19},(_,i)=>i%251);
  const files=[new File([payload],'archive.zip'),new File([],'empty'),new File(['hello 🌍'],'note.txt')];
  const received=[];let offered=false;
  const receiver=new Transfer(b,{onOffer:()=>{offered=true;},onFile:f=>received.push(f)});
  const sender=new Transfer(a,{files});
  await until(()=>offered);await wait(30);assert.equal(receiver.completedBytes,0);assert.equal(receiver.current,undefined);
  receiver.accept(()=>memorySink());await until(()=>sender.terminal());assert.equal(sender.state,'complete');assert.equal(receiver.state,'complete');assert.equal(received.length,3);
  for(let i=0;i<3;i++)assert.deepEqual(new Uint8Array(await received[i].blob.arrayBuffer()),new Uint8Array(await files[i].arrayBuffer()));a.close();
});
test('decline sends no file bytes',async()=>{const[a,b]=pair();const receiver=new Transfer(b,{onOffer:(_,t)=>t.decline()});const sender=new Transfer(a,{files:[new File(['secret'],'private.txt')]});await until(()=>sender.terminal());assert.equal(sender.state,'declined');assert.equal(receiver.completedBytes,0);});
test('corruption is detected before download is exposed',async()=>{let corrupted=false;const[a,b]=pair(data=>{if(data instanceof ArrayBuffer&&!corrupted){corrupted=true;new Uint8Array(data)[0]^=255;}return data;});let exposed=false;const receiver=new Transfer(b,{onOffer:(_,t)=>t.accept(()=>memorySink()),onFile:()=>{exposed=true;}});const sender=new Transfer(a,{files:[new File(['original'],'file.bin')]});await until(()=>receiver.terminal());assert.equal(receiver.state,'failed');assert.equal(exposed,false);await until(()=>sender.terminal());});
test('disconnection fails both sides and aborts partial writer',async()=>{const[a,b]=pair();let aborted=false;const receiver=new Transfer(b,{onOffer:(_,t)=>t.accept(()=>({write:async()=>{a.close();},abort:async()=>{aborted=true;}}))});const sender=new Transfer(a,{files:[new File([new Uint8Array(40000)],'big.bin')]});await until(()=>sender.terminal()&&receiver.terminal());assert.equal(sender.state,'failed');assert.equal(receiver.state,'failed');assert.equal(aborted,true);});
test('slow disk writes serialize and produce accurate bytes',async()=>{const[a,b]=pair();let writes=0,max=0,total=0;const receiver=new Transfer(b,{onOffer:(_,t)=>t.accept(()=>({write:async bytes=>{writes++;max=Math.max(max,writes);await wait(2);total+=bytes.length;writes--;},close:async()=>({}),abort:async()=>{}}))});const sender=new Transfer(a,{files:[new File([new Uint8Array(160001)],'slow.bin')]});await until(()=>sender.terminal());assert.equal(sender.state,'complete');assert.equal(max,1);assert.equal(total,160001);a.close();});
test('invalid manifest and unsafe filenames',()=>{assert.throws(()=>validateManifest([{name:'bad',size:-1}]));assert.throws(()=>validateManifest([]));assert.throws(()=>validateManifest([{name:'bad',size:Infinity}]));assert.equal(safeName('../nested/evil.exe'),'evil.exe');assert.equal(safeName('C:\\folder\\a?.txt'),'a_.txt');});
test('folder saving avoids existing names',async()=>{const names=new Set(['same.txt']);let chosen;const dir={getFileHandle:async(name,options)=>{if(options?.create){chosen=name;names.add(name);return {createWritable:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})};}if(!names.has(name))throw Object.assign(Error(),{name:'NotFoundError'});return {};}};const sink=await directorySink(dir,{name:'same.txt'});await sink.close();assert.equal(chosen,'same.txt (1)');});
