// Transport-independent regression scenarios. Node uses the real SHA-256 engine;
// the restricted validation runner injects a deterministic checksum.
export async function transferMatrix({BlockTransfer,blockHash,File,Blob,BLOCK_SIZE,clone=structuredClone}) {
 const results=[],all=[],timers=new Set();
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,label)=>{for(let n=0;n<2000;n++){if(fn())return;await delay(2);}throw Error('Timed out: '+label+' '+all.map(t=>t.state+':'+t.detail).join('; '));};
 const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
 class Events {
  listeners=new Map();
  on(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);return this;}
  emit(type,value){for(const fn of this.listeners.get(type)||[])fn(value);}
 }
 function pair(tweak=x=>x){
  class Connection extends Events {
   open=true;dataChannel={bufferedAmount:0};peerConnection={sctp:{maxMessageSize:65536}};
   send(raw){if(!this.open)throw Error('Closed');const data=tweak(clone(raw),this);if(data!==undefined)Promise.resolve().then(()=>{if(this.other.open)this.other.emit('data',data);});}
   close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}
  }
  const a=new Connection(),b=new Connection();a.other=b;b.other=a;return [a,b];
 }
 class Store {
  map=new Map();gate=null;
  async get(id){return clone(this.map.get(id));}
  async put(record){const copy=clone(record);if(this.gate)await this.gate(copy);this.map.set(record.id,copy);}
  async remove(id){this.map.delete(id);}
 }
 function environment(){
  const store=new Store(),blocks=new Map(),saved=[];
  class Storage {
   static gate=null;static writeGate=null;static finalizeGate=null;static writeEntered=false;
   static async open(record){if(this.gate)await this.gate(record);return new this(record);}
   constructor(record){this.record=record;}
   key(f,b){return this.record.transferId+':'+f+':'+b;}
   async write(f,b,data){Storage.writeEntered=true;if(Storage.writeGate)await Storage.writeGate(this.record);blocks.set(this.key(f,b),new Uint8Array(data));}
   async verifyPrefix(f,state){return state.next;}
   async finalize(f,state,digest,progress,cancelled=()=>false){
    if(Storage.finalizeGate)await Storage.finalizeGate(this.record);
    if(cancelled())throw Error('Cancelled verification');
    const parts=[];for(let b=0;b<state.next;b++)parts.push(blocks.get(this.key(f,b)));
    const blob=new Blob(parts);
    check(await blockHash(await blob.arrayBuffer())===digest,'Whole-file integrity mismatch');
    state.complete=true;state.digest=digest;progress(blob.size);
    saved.push({id:this.record.transferId,file:f,blob});return {blob};
   }
   async cleanup(){for(const key of blocks.keys())if(key.startsWith(this.record.transferId+':'))blocks.delete(key);}
  }
  return {store,Storage,blocks,saved};
 }
 const file=(name='日本語-العربية.bin',size=180000)=>new File([Uint8Array.from({length:size},(_,i)=>(i*7)%251)],name,{lastModified:123});
 function start(env,{files=[file()],tweak,accept=true,priority=false,from='A',to='B'}={}){
  const [a,b]=pair(tweak);let sender,receiver;
  receiver=new BlockTransfer(b,{store:env.store,Storage:env.Storage,senderId:from,receiverId:to,onOffer:(_,t)=>{if(accept)void t.accept({storage:'test'});},onCancel:()=>{if(priority){sender.cancel(false);return true;}}});
  sender=new BlockTransfer(a,{store:env.store,Storage:env.Storage,files,senderId:from,receiverId:to,onCancel:()=>{if(priority){receiver.cancel(false);return true;}}});
  all.push(sender,receiver);return {sender,receiver,a,b};
 }
 async function done(t){await until(()=>t.sender.terminal()&&t.receiver.terminal(),'completion');check(t.sender.state==='complete',t.sender.detail);check(t.receiver.state==='complete',t.receiver.detail);}
 async function cancelled(t,side){
  t[side].cancel();await until(()=>t.sender.state==='cancelled'&&t.receiver.state==='cancelled','both cancelled');
  check(await t[side].cancelAcknowledged===true,'Cancellation acknowledgement');
  await Promise.all([t.sender.cleanupPromise,t.receiver.cleanupPromise]);
  check(!t.sender.store.map.has('send:'+t.sender.id)&&!t.receiver.store.map.has('receive:'+t.sender.id),'Cancelled records removed');
 }
 try {
  for(const side of ['sender','receiver']){
   const env=environment(),t=start(env,{accept:false});await until(()=>t.receiver.state==='offered','offer');
   await cancelled(t,side);const again=start(env,{files:[file('again'),file('empty',0)]});await done(again);
   results.push(side+' cancels offered transfer; next multi-file transfer succeeds');
  }
  for(const side of ['sender','receiver']){
   const env=environment(),gate=deferred();env.Storage.writeGate=()=>gate.promise;
   const t=start(env);await until(()=>env.Storage.writeEntered,'pending write');
   t[side].cancel();await until(()=>t.sender.state==='cancelled'&&t.receiver.state==='cancelled','cancel during write');
   gate.resolve();await Promise.all([t.sender.cleanupPromise,t.receiver.cleanupPromise]);check(env.blocks.size===0,'Late write leaked blocks');check(env.store.map.size===0,'Late write leaked records');
   env.Storage.writeGate=null;await done(start(env));results.push(side+' cancellation during a pending disk write cleans up and allows resend');
  }
  {
   const env=environment(),gate=deferred();env.Storage.gate=()=>gate.promise;
   const t=start(env);await until(()=>t.receiver.state==='preparing','preparing');t.sender.cancel();await until(()=>t.receiver.state==='cancelled','preparation cancellation');gate.resolve();
   await Promise.all([t.sender.cleanupPromise,t.receiver.cleanupPromise]);check(env.store.map.size===0&&env.blocks.size===0,'Preparation leaked data');results.push('Cancellation during destination opening');
  }
  {
   const env=environment(),gate=deferred();env.Storage.finalizeGate=()=>gate.promise;
   const t=start(env);await until(()=>t.receiver.state==='verifying','verification');t.receiver.cancel();await until(()=>t.sender.state==='cancelled','verification cancellation');gate.resolve();
   await Promise.all([t.sender.cleanupPromise,t.receiver.cleanupPromise]);check(env.saved.length===0&&env.blocks.size===0,'Cancelled verification produced a download');results.push('Cancellation during final verification');
  }
  {
   const env=environment(),gate=deferred();let entered=false;
   env.store.gate=record=>{if(record.direction==='send'&&!entered){entered=true;return gate.promise;}};
   const t=start(env);await until(()=>entered,'sender record write');t.sender.cancel();await until(()=>t.receiver.state==='cancelled','sender write cancellation');gate.resolve();
   await Promise.all([t.sender.cleanupPromise,t.receiver.cleanupPromise]);check(env.store.map.size===0,'Delayed sender write recreated record');results.push('Cancellation waits for sender metadata writes');
  }
  {
   const env=environment(),t=start(env,{accept:false,priority:true,tweak:raw=>typeof raw==='string'&&JSON.parse(raw).type==='cancel'?undefined:raw});
   await until(()=>t.receiver.state==='offered','priority offer');await cancelled(t,'sender');results.push('Separate control channel cancels when file-channel cancellation is blocked');
  }
  for(const topology of [['A','B','A','C'],['A','B','C','B'],['A','B','B','A'],['A','B','A','B']]){
   const env=environment(),one=start(env,{accept:false,from:topology[0],to:topology[1],files:[file('one'),file('two'),file('empty',0)]}),two=start(env,{accept:false,from:topology[2],to:topology[3],files:[file('three'),file('four')]});
   await until(()=>one.receiver.state==='offered'&&two.receiver.state==='offered','simultaneous offers');
   await Promise.all([one.receiver.accept({storage:'test'}),two.receiver.accept({storage:'test'})]);await Promise.all([done(one),done(two)]);
   check(env.saved.length===5,'Concurrent files lost');results.push('Concurrent multi-file '+topology[0]+'→'+topology[1]+' and '+topology[2]+'→'+topology[3]);
  }
  {
   const env=environment(),one=start(env,{accept:false}),two=start(env,{accept:false,to:'C'});await until(()=>one.receiver.state==='offered'&&two.receiver.state==='offered','independent offers');
   one.receiver.decline();await until(()=>one.sender.terminal(),'decline');await two.receiver.accept({storage:'test'});await done(two);await done(start(env));results.push('Declining one peer preserves the other and repeat sends');
  }
  {
   const env=environment();let first=true,one;one=start(env,{to:'B',tweak:raw=>{if(raw instanceof ArrayBuffer&&first){first=false;one.sender.pause();}return raw;}});
   const two=start(env,{to:'C',files:[file('concurrent'),file('empty',0)]});await until(()=>one.sender.localPaused,'pause');await done(two);
   check(!one.sender.terminal(),'Pause did not hold transfer');await cancelled(one,'sender');
   check(env.saved.filter(x=>x.id===two.sender.id).length===2,'Other peer downloads lost');await done(start(env));results.push('Paused peer can be cancelled while another completes, then resend');
  }
  {
   const env=environment(),source=file('multi-block',BLOCK_SIZE+1234);let corrupted=false,starts=0;
   const t=start(env,{files:[source,file('zero',0)],tweak:raw=>{
    if(typeof raw==='string'&&JSON.parse(raw).type==='block-start')starts++;
    if(raw instanceof ArrayBuffer&&!corrupted){new Uint8Array(raw)[raw.byteLength-1]^=1;corrupted=true;}return raw;
   }});
   await done(t);check(starts===3,'Corruption did not retry exactly one block');check(env.saved.length===2,'Multi-block files missing');
   results.push('Multi-block file retries corrupt block and finishes with verified empty file');
  }
  {
   const env=environment();let paused=false,t;
   t=start(env,{tweak:raw=>{if(raw instanceof ArrayBuffer&&!paused){paused=true;t.receiver.pause();}return raw;}});
   await until(()=>t.receiver.localPaused,'receiver pause');t.receiver.resume();await done(t);
   results.push('Receiver pause and resume complete normally');
  }
  {
   const env=environment(),[a,b]=pair();a.open=false;b.open=false;
   const sender=new BlockTransfer(a,{store:env.store,Storage:env.Storage,files:[file()]});
   const receiver=new BlockTransfer(b,{store:env.store,Storage:env.Storage,id:sender.id});all.push(sender,receiver);
   sender.cancel();b.open=true;a.open=true;a.emit('open');
   await until(()=>receiver.state==='cancelled','cancel before open');check(await sender.cancelAcknowledged,'Early cancellation not acknowledged');
   await Promise.all([sender.cleanupPromise,receiver.cleanupPromise]);check(env.store.map.size===0,'Early cancellation leaked data');
   results.push('Cancellation before the file channel opens is delivered on opening');
  }
  return results;
 }finally{for(const t of all){clearInterval(t.heartbeat);if(!t.terminal())t.cancel(false);t.finishCancellation?.(false);t.conn.close();}}
}
