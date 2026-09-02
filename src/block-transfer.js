import {BLOCK_SIZE,MAX_FILE_SIZE,records,BlockStorage,cleanPath,friendlyStorageError} from './storage.js';
import {Integrity,blockHash} from './integrity.js';
import {safeName} from './transfer.js';

const VERSION=3,HEADER=36,MAX_FRAME=64*1024,MAX_CONTROL=48*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const CLOSED=new Set(['complete','failed','declined','cancelled']);
const TRANSITIONS={connecting:['waiting','offered','preparing','reconnecting'],waiting:['transferring','paused','reconnecting'],offered:['preparing','reconnecting'],preparing:['transferring','paused','reconnecting','verifying'],transferring:['paused','verifying','reconnecting'],paused:['transferring','verifying','reconnecting'],reconnecting:['connecting','waiting','offered','preparing','transferring','paused'],verifying:['transferring','paused','reconnecting']};
export class Interrupted extends Error {}
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export function manifestFor(files) {
  if(!Array.isArray(files)||!files.length||files.length>200)throw Error('Choose between 1 and 200 files per transfer.');
  const manifest=files.map(f=>{
    if(typeof f.name!=='string'||f.name.length>240||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_FILE_SIZE)throw Error('Invalid file metadata or file larger than the supported 1 TB limit.');
    const path=f.webkitRelativePath||f.path||f.name;
    return {name:safeName(f.name),path:cleanPath(path),size:f.size,type:typeof f.type==='string'?f.type.slice(0,120):'',lastModified:Number.isSafeInteger(f.lastModified)?f.lastModified:0};
  });
  if(new TextEncoder().encode(JSON.stringify(manifest)).length>32*1024)throw Error('Too many filenames in one batch. Select fewer files.');
  return manifest;
}
function sameManifest(a,b){return JSON.stringify(a)===JSON.stringify(b);}
const emptyFile=()=>({next:0,hashes:[],checkpoint:null,complete:false});
export function encodeChunk(id,file,block,offset,payload) {
  const out=new Uint8Array(HEADER+payload.byteLength),v=new DataView(out.buffer);
  v.setUint32(0,0x57465433);const hex=id.replace(/-/g,'');for(let n=0;n<16;n++)out[4+n]=parseInt(hex.slice(n*2,n*2+2),16);
  v.setUint32(20,file);v.setUint32(24,block);v.setUint32(28,offset);v.setUint32(32,payload.byteLength);out.set(new Uint8Array(payload),HEADER);return out.buffer;
}
export function decodeChunk(raw,id) {
  if(!(raw instanceof ArrayBuffer)||raw.byteLength<=HEADER||raw.byteLength>MAX_FRAME)throw Error('Malformed binary frame.');
  const v=new DataView(raw),hex=Array.from(new Uint8Array(raw,4,16),b=>b.toString(16).padStart(2,'0')).join('');
  if(v.getUint32(0)!==0x57465433||hex!==id.replace(/-/g,'')||v.getUint32(32)!==raw.byteLength-HEADER)throw Error('File data belongs to a different transfer.');
  return {file:v.getUint32(20),block:v.getUint32(24),offset:v.getUint32(28),bytes:new Uint8Array(raw,HEADER)};
}
export class BlockTransfer {
  constructor(conn,options={}) {
    this.options=options;this.store=options.store||records;this.Storage=options.Storage||BlockStorage;
    this.direction=options.files?'send':'receive';this.files=options.files;
    this.record=options.record;this.manifest=this.record?.manifest;this.id=this.record?.transferId||options.id||(this.files?crypto.randomUUID():null);
    this.token=this.record?.token||(this.files?secret():null);this.state='connecting';this.epoch=0;this.waiters=[];
    this.localPaused=false;this.peerPaused=false;this.lastActivity=Date.now();this.lastUI=0;this.samples=[];this.bytes=0;this.total=0;
    this.attach(conn);
    this.heartbeat=setInterval(()=>{
      if(this.terminal())return;
      if(this.conn?.open&&this.id)try{this.send('ping');}catch{}
      const limit=['offered','waiting','preparing','verifying'].includes(this.state)?180000:45000;
      if(!this.localPaused&&!this.peerPaused&&this.state!=='reconnecting'&&Date.now()-this.lastActivity>limit)this.interrupted('Connection stopped responding. Verified progress is saved.');
    },10000);
  }
  terminal(){return CLOSED.has(this.state);}
  transition(next,detail='') {
    if(this.terminal()&&next!==this.state)return;
    if(next!==this.state&&!CLOSED.has(next)&&!TRANSITIONS[this.state]?.includes(next))throw Error(`Invalid transfer state: ${this.state} to ${next}`);
    this.state=next;this.detail=detail;this.emit(true);
  }
  emit(force=false) {
    const now=Date.now();if(!force&&now-this.lastUI<200)return;this.lastUI=now;
    const bytes=this.record?this.record.files.reduce((sum,f,i)=>sum+Math.min(this.manifest[i].size,f.next*BLOCK_SIZE),0):0;
    this.bytes=bytes;this.samples.push([now,bytes]);this.samples=this.samples.filter(s=>now-s[0]<5000);
    const first=this.samples[0],speed=this.samples.length>1&&now>first[0]&&!['paused','reconnecting','verifying'].includes(this.state)?Math.max(0,(bytes-first[1])*1000/(now-first[0])):0;
    this.options.onUpdate?.({id:this.id,state:this.state,detail:this.detail||'',direction:this.direction,files:this.manifest||[],bytes,total:this.total,speed,eta:speed?(this.total-bytes)/speed:null,remotePaused:this.peerPaused,localPaused:this.localPaused,fileIndex:this.fileIndex||0,verifiedBytes:this.verifiedBytes||0});
  }
  attach(conn) {
    const old=this.conn,previousQueue=this.queue;this.epoch++;const epoch=this.epoch;this.conn=conn;this.queue=previousQueue?.catch(()=>{})||Promise.resolve();this.queuedBytes=0;this.block=null;this.helloSeen=false;
    if(old&&old!==conn)old.close();this.rejectWaiters(new Interrupted('Reconnecting'));
    if(this.state==='reconnecting')this.transition('connecting');this.lastActivity=Date.now();
    conn.on('data',raw=>{
      if(epoch!==this.epoch||this.terminal())return;
      this.lastActivity=Date.now();
      try {
        if(typeof raw==='string') {
          if(raw.length>MAX_CONTROL)throw Error('Control message too large.');const m=JSON.parse(raw);
          if(!m||m.v!==VERSION||typeof m.type!=='string'||!UUID.test(m.id)||this.id&&m.id!==this.id)throw Error('Invalid transfer message.');
          if(m.type==='ping'){this.send('pong');return;}if(m.type==='pong')return;
          if(m.type==='pause'||m.type==='resume'){this.peerPaused=m.type==='pause';this.refreshPause();return;}
          if(m.type==='cancel'||m.type==='reject'||m.type==='error'){this.fail(typeof m.reason==='string'?m.reason.slice(0,200):'The other device stopped the transfer.',m.type==='reject'?'declined':m.type==='cancel'?'cancelled':'failed',false);return;}
          if(this.direction==='send') {
            if(m.type==='verify-progress'){this.verifiedBytes=m.bytes;this.emit();return;}
            const waiter=this.waiters.find(w=>w.types.includes(m.type));
            if(!waiter)throw Error('Unexpected transfer acknowledgement.');this.waiters.splice(this.waiters.indexOf(waiter),1);waiter.resolve(m);return;
          }
          this.queue=this.queue.then(()=>{this.guard(epoch);return this.receiveControl(m,epoch);}).catch(e=>this.handleError(e));
        }else {
          const size=raw.byteLength||raw.size||0;this.queuedBytes+=size;if(this.queuedBytes>BLOCK_SIZE+2*1024*1024)throw Error('Peer sent too much data without acknowledgement.');
          this.queue=this.queue.then(async()=>{try{this.guard(epoch);const data=raw instanceof Blob?await raw.arrayBuffer():raw;this.guard(epoch);this.receiveBinary(data);}finally{if(epoch===this.epoch)this.queuedBytes-=size;}}).catch(e=>this.handleError(e));
        }
      }catch(e){this.handleError(e);}
    });
    conn.on('close',()=>{if(epoch===this.epoch)this.interrupted('Connection interrupted. Verified blocks are preserved.');});
    conn.on('error',()=>{if(epoch===this.epoch)this.interrupted('Could not reach the other device. Verified progress is saved.');});
    if(this.files){const start=()=>this.run(epoch).catch(e=>this.handleError(e));if(conn.open)queueMicrotask(start);else conn.on('open',start);}
  }
  guard(epoch){if(this.terminal())throw new Interrupted('Transfer stopped.');if(epoch!==this.epoch||!this.conn.open)throw new Interrupted('Connection interrupted.');}
  handleError(e){if(e instanceof Interrupted)return;this.fail(friendlyStorageError(e));}
  send(type,extra={}){if(!this.conn?.open||!this.id)throw new Interrupted('Connection unavailable.');const message=JSON.stringify({v:VERSION,id:this.id,type,...extra});if(new TextEncoder().encode(message).length>MAX_CONTROL)throw Error('Transfer metadata is too large. Select fewer files.');this.conn.send(message);}
  rejectWaiters(error){for(const w of this.waiters)w.reject(error);this.waiters=[];}
  request(type,extra,types,epoch) {
    this.guard(epoch);
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==waiter);reject(Error('The other device did not respond. Your progress is saved.'));},type==='file-finish'?3600000:180000);
      const waiter={types:Array.isArray(types)?types:[types],resolve:m=>{clearTimeout(timeout);resolve(m);},reject:e=>{clearTimeout(timeout);reject(e);}};
      this.waiters.push(waiter);try{this.send(type,extra);}catch(e){this.waiters.pop();waiter.reject(e);}
    });
  }
  async writable(epoch) {
    while(this.localPaused||this.peerPaused){this.guard(epoch);await new Promise(r=>setTimeout(r,100));}
    this.guard(epoch);const dc=this.conn.dataChannel;
    if(!dc||dc.bufferedAmount<1024*1024)return;
    dc.bufferedAmountLowThreshold=256*1024;
    await new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);dc.removeEventListener('bufferedamountlow',low);dc.removeEventListener('close',closed);resolve();};
      const low=()=>{if(dc.bufferedAmount<=dc.bufferedAmountLowThreshold)finish();};
      const closed=()=>{finish();reject(new Interrupted('Connection closed'));};
      const timer=setTimeout(finish,1000);dc.addEventListener('bufferedamountlow',low);dc.addEventListener('close',closed);low();
    });
    return this.writable(epoch);
  }
  async run(epoch) {
    this.manifest=manifestFor(this.files);this.total=this.manifest.reduce((n,f)=>n+f.size,0);
    if(!this.record)this.record={id:'send:'+this.id,transferId:this.id,token:this.token,direction:'send',manifest:this.manifest,files:this.manifest.map(emptyFile),senderId:this.options.senderId||'local',receiverId:this.options.receiverId||'remote',created:Date.now(),state:'waiting'};
    if(!sameManifest(this.manifest,this.record.manifest))throw Error('Select the same original files, with matching names, sizes, and modification dates, to resume.');
    this.guard(epoch);const acceptance=this.request('hello',{token:this.token,manifest:this.manifest,senderId:this.record.senderId,receiverId:this.record.receiverId,paused:this.localPaused},'accept',epoch);this.transition('waiting');
    const accepted=await acceptance;
    if(!Array.isArray(accepted.files)||accepted.files.length!==this.files.length)throw Error('Invalid saved transfer state.');
    await this.store.put(this.record);this.guard(epoch);
    this.peerPaused=!!accepted.paused;this.transition(this.localPaused||this.peerPaused?'paused':'transferring');
    const maxMessage=this.conn.peerConnection?.sctp?.maxMessageSize;
    const transport=Math.min(MAX_FRAME,Number.isFinite(maxMessage)&&maxMessage>HEADER?maxMessage:16*1024)-HEADER;
    for(let f=0;f<this.files.length;f++) {
      this.fileIndex=f;const file=this.files[f],state=this.record.files[f],remote=accepted.files[f],count=Math.ceil(file.size/BLOCK_SIZE);
      if(!Number.isInteger(remote.next)||remote.next<0||remote.next>count)throw Error('Invalid saved block offset.');
      let checkpoint=state.checkpoint;
      if(remote.next!==state.next||this.options.reselected) {
        const rebuild=new Integrity();try{
          for(let b=0;b<remote.next;b++) {this.guard(epoch);const bytes=await file.slice(b*BLOCK_SIZE,Math.min(file.size,(b+1)*BLOCK_SIZE)).arrayBuffer();const digest=await blockHash(bytes);if(state.hashes[b]&&state.hashes[b]!==digest)throw Error('The selected source file changed. Choose the original file or start a new transfer.');state.hashes[b]=digest;checkpoint=await rebuild.update(bytes);}
        }finally{rebuild.close();}
        if(!remote.next)checkpoint=null;
      }
      if(remote.next&&remote.lastHash!==state.hashes[remote.next-1])throw Error('Saved source and receiver progress do not match.');
      state.next=remote.next;state.checkpoint=checkpoint;state.complete=false;await this.store.put(this.record);
      const hash=new Integrity(checkpoint);
      try {
        for(let b=state.next;b<count;b++) {
          await this.writable(epoch);
          const bytes=await file.slice(b*BLOCK_SIZE,Math.min(file.size,(b+1)*BLOCK_SIZE)).arrayBuffer();this.guard(epoch);
          const digest=await blockHash(bytes);let attempts=0,ack;
          do {
            await this.writable(epoch);
            await this.request('block-start',{file:f,block:b,size:bytes.byteLength,hash:digest},'ready',epoch);
            for(let offset=0;offset<bytes.byteLength;offset+=transport) {await this.writable(epoch);this.conn.send(encodeChunk(this.id,f,b,offset,bytes.slice(offset,offset+transport)));}
            ack=await this.request('block-end',{file:f,block:b},['block-ack','block-nack'],epoch);
            if(ack.file!==f||ack.block!==b)throw Error('Acknowledgement belongs to another block.');
          }while(ack.type==='block-nack'&&++attempts<3);
          if(ack.type!=='block-ack'||ack.hash!==digest)throw Error('A block repeatedly failed integrity checks. Retry on a stable connection.');
          state.checkpoint=await hash.update(bytes);state.hashes[b]=digest;state.next=b+1;this.record.updated=Date.now();await this.store.put(this.record);this.emit();
        }
        const digest=await hash.digest();this.guard(epoch);this.verifiedBytes=0;this.transition('verifying','All blocks received. Waiting for the receiver to verify the saved file…');
        const result=await this.request('file-finish',{file:f,hash:digest},'file-complete',epoch);
        if(result.file!==f||result.hash!==digest)throw Error('Final receiver verification did not match.');
        state.complete=true;state.digest=digest;await this.store.put(this.record);
        this.transition(this.localPaused||this.peerPaused?'paused':'transferring');
      }finally{hash.close();}
    }
    await this.request('finish',{},'complete',epoch);this.record.state='complete';await this.store.put(this.record);this.transition('complete','Receiver verified and saved all files.');clearInterval(this.heartbeat);setTimeout(()=>this.conn.close(),500);
  }
  async receiveControl(m,epoch) {
    if(m.type==='hello') {
      if(this.helloSeen)throw Error('Duplicate transfer greeting.');this.helloSeen=true;
      if(typeof m.token!=='string'||!HEX.test(m.token)||typeof m.senderId!=='string'||m.senderId.length>64||typeof m.receiverId!=='string'||m.receiverId.length>64)throw Error('Invalid transfer identity.');
      if(this.options.senderId&&m.senderId!==this.options.senderId||this.options.receiverId&&m.receiverId!==this.options.receiverId)throw Error('Transfer is addressed to a different device.');
      this.id=m.id;this.token=m.token;this.manifest=manifestFor(m.manifest);this.total=this.manifest.reduce((n,f)=>n+f.size,0);this.peerPaused=!!m.paused;
      const saved=await this.store.get('receive:'+this.id);this.guard(epoch);
      if(saved) {
        if(this.options.requireDirectory&&saved.storage!=='directory')throw Error('This older transfer used browser storage. Start a new transfer and choose a device folder.');
        if(saved.token!==m.token||saved.senderId!==m.senderId||saved.receiverId!==m.receiverId||!sameManifest(saved.manifest,this.manifest))throw Error('This transfer ID belongs to another sender or file.');
        this.record=saved;this.transition('preparing','Recovering saved transfer progress…');this.storage=await this.Storage.open(saved);this.guard(epoch);
        for(let f=0;f<saved.files.length;f++)if(!saved.files[f].complete){const valid=await this.storage.verifyPrefix(f,saved.files[f]);if(valid!==saved.files[f].next){saved.files[f].next=valid;saved.files[f].hashes=saved.files[f].hashes.slice(0,valid);}}
        await this.store.put(saved);this.guard(epoch);this.acceptState();
      }else {
        this.pendingHello=m;this.transition('offered');this.options.onOffer?.(this.manifest,this);
      }return;
    }
    if(!this.record||!this.storage)throw Error('File data arrived before acceptance.');
    if(m.type==='block-start') {
      if(!Number.isInteger(m.file)||m.file<0)throw Error('Invalid file index.');const file=this.manifest[m.file],state=this.record.files[m.file];
      if(this.block||!file||state.complete||!Number.isInteger(m.block)||m.block!==state.next||m.size!==Math.min(BLOCK_SIZE,file.size-m.block*BLOCK_SIZE)||m.size<=0||!HEX.test(m.hash))throw Error('Invalid block metadata.');
      this.block={file:m.file,index:m.block,hash:m.hash,data:new Uint8Array(m.size),received:0};this.send('ready',{file:m.file,block:m.block});return;
    }
    if(m.type==='block-end') {
      const block=this.block;if(!block||m.file!==block.file||m.block!==block.index||block.received!==block.data.length)throw Error('Incomplete file block.');
      this.block=null;const digest=await blockHash(block.data);this.guard(epoch);
      if(digest!==block.hash){this.send('block-nack',{file:m.file,block:m.block});return;}
      await this.storage.write(m.file,m.block,block.data);this.guard(epoch);
      const state=this.record.files[m.file];state.hashes[m.block]=digest;state.next=m.block+1;this.record.updated=Date.now();await this.store.put(this.record);this.guard(epoch);
      this.send('block-ack',{file:m.file,block:m.block,hash:digest});this.emit();return;
    }
    if(m.type==='file-finish') {
      if(!Number.isInteger(m.file)||m.file<0)throw Error('Invalid file index.');const state=this.record.files[m.file],file=this.manifest[m.file];if(!file||!state||state.next!==Math.ceil(file.size/BLOCK_SIZE)||!HEX.test(m.hash)||this.block)throw Error('Cannot verify an incomplete file.');
      this.fileIndex=m.file;this.verifiedBytes=0;this.transition('verifying','Checking the saved file and preparing your download…');
      if(state.complete){if(state.digest!==m.hash)throw Error('Saved file hash does not match.');this.options.onFile?.({...file,...await this.storage.completedFile(m.file)});}
      else {
        const result=await this.storage.finalize(m.file,state,m.hash,bytes=>{this.verifiedBytes=bytes;this.emit();if(epoch===this.epoch&&this.conn.open)this.send('verify-progress',{bytes});},()=>this.terminal());
        this.guard(epoch);this.options.onFile?.({...file,...result});
      }
      this.send('file-complete',{file:m.file,hash:m.hash});this.transition(this.localPaused||this.peerPaused?'paused':'transferring');return;
    }
    if(m.type==='finish') {
      if(this.record.files.some(f=>!f.complete))throw Error('Cannot complete an unverified transfer.');
      this.record.state='complete';await this.store.put(this.record);this.guard(epoch);this.send('complete');this.transition('complete','All files are verified.');clearInterval(this.heartbeat);return;
    }
    throw Error('Unknown transfer message.');
  }
  receiveBinary(raw) {
    const frame=decodeChunk(raw,this.id),block=this.block;
    if(!block||frame.file!==block.file||frame.block!==block.index||frame.offset!==block.received||frame.offset+frame.bytes.length>block.data.length)throw Error('Out-of-order or unexpected file data.');
    block.data.set(frame.bytes,frame.offset);block.received+=frame.bytes.length;
  }
  async accept(destination) {
    if(this.state!=='offered')return;const epoch=this.epoch;this.transition('preparing','Preparing persistent storage…');
    try {
      if(this.options.requireDirectory&&(destination?.storage!=='directory'||!destination.directory))throw Error('Choose a device folder. Browser-stored file contents are disabled.');
      this.record={id:'receive:'+this.id,transferId:this.id,token:this.token,direction:'receive',manifest:this.manifest,files:this.manifest.map(emptyFile),senderId:this.pendingHello.senderId,receiverId:this.pendingHello.receiverId,created:Date.now(),state:'transferring',storage:destination.storage,directory:destination.directory};
      this.storage=await this.Storage.open(this.record);if(this.state==='cancelled'){await this.storage.cleanup();return;}this.guard(epoch);await this.store.put(this.record);this.guard(epoch);this.acceptState();
    }catch(e){this.handleError(e);}
  }
  acceptState(){this.send('accept',{files:this.record.files.map(f=>({next:f.next,lastHash:f.hashes.at(-1)})),paused:this.localPaused});this.transition(this.localPaused||this.peerPaused?'paused':'transferring');}
  refreshPause(){if(['transferring','paused'].includes(this.state))this.transition(this.localPaused||this.peerPaused?'paused':'transferring',this.peerPaused?'Paused on the other device.':this.localPaused?'Paused. Your verified progress is saved.':'');}
  pause(){if(!['transferring','paused'].includes(this.state))return;this.localPaused=true;this.send('pause');this.refreshPause();}
  resume(){if(this.state==='reconnecting'){this.options.onInterrupted?.(this);return;}this.localPaused=false;if(this.conn.open)this.send('resume');this.refreshPause();}
  interrupted(detail) {
    if(this.terminal()||this.state==='reconnecting')return;
    this.epoch++;this.block=null;
    this.rejectWaiters(new Interrupted(detail));this.transition('reconnecting',detail);this.options.onInterrupted?.(this);
  }
  decline(){this.fail('Receiver declined this transfer.','declined');}
  cancel(){this.fail('Transfer cancelled. Partial files are being removed.','cancelled');}
  fail(detail,state='failed',notify=true) {
    if(this.terminal())return;
    if(notify&&this.id&&this.conn?.open)try{this.send(state==='declined'?'reject':state==='cancelled'?'cancel':'error',{reason:detail.slice(0,200)});}catch{}
    this.epoch++;this.block=null;this.rejectWaiters(new Interrupted(detail));clearInterval(this.heartbeat);
    if(this.record){this.record.state=state;void this.store.put(this.record).catch(()=>{});}
    this.transition(state,detail);setTimeout(()=>this.conn.close(),300);
    if(state==='cancelled')void this.queue.finally(async()=>{await this.storage?.cleanup();if(this.record)await this.store.remove(this.record.id);}).catch(()=>{});
  }
}
