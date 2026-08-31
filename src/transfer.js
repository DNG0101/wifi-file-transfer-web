import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export const CHUNK = 16 * 1024;
export const MEMORY_LIMIT = 256 * 1024 * 1024;
export const safeName = name => String(name).split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/[. ]+$/g, '').slice(0,180) || 'received-file';
export function validateManifest(files) {
  if (!Array.isArray(files) || !files.length || files.length > 1000) throw Error('Select between 1 and 1,000 files.');
  let total = 0;
  const clean = files.map(f => {
    if (!f || typeof f.name !== 'string' || f.name.length > 1024 || !Number.isSafeInteger(f.size) || f.size < 0) throw Error('Invalid file information.');
    total += f.size;
    if (!Number.isSafeInteger(total)) throw Error('File selection is too large.');
    return {name:safeName(f.name),size:f.size};
  });
  if (new TextEncoder().encode(JSON.stringify(clean)).length > 45*1024) throw Error('Too many long filenames for one request. Send a smaller batch.');
  return clean;
}

// One ordered connection per transfer. Receive processing is serialized, including disk writes.
export class Transfer {
  constructor(conn, options = {}) {
    this.conn = conn; this.options = options; this.state = 'connecting';
    this.direction = options.files ? 'send' : 'receive'; this.files = options.files;
    this.index = -1; this.completedBytes = 0; this.ack = 0; this.sent = 0;
    this.lastActivity = Date.now(); this.queue = Promise.resolve(); this.lastRender = 0;
    conn.on('data', raw => {
      this.queue = this.queue.then(() => this.receive(raw)).catch(e => this.fail(e.message));
    });
    conn.on('close', () => this.fail('Connection closed. Keep both pages open and try again.'));
    conn.on('error', e => this.fail(e.message || 'Connection failed.'));
    this.watch = setInterval(() => {
      const limit=this.state==='connecting'?25000:['offered','waiting'].includes(this.state)?180000:60000;
      if (Date.now() - this.lastActivity > limit) this.fail(this.state==='connecting'?'Could not connect to this device. Run Network check or retry the connection.':'Transfer timed out. Keep both pages visible and try again.');
    }, 1000);
    if (this.files) {
      const start = () => this.run().catch(e => this.fail(e.message));
      if (conn.open) start(); else conn.on('open', start);
    }
  }
  terminal() { return ['complete','failed','declined','cancelled'].includes(this.state); }
  emit(state = this.state, detail = '') {
    const changed=state!==this.state;
    this.state = state;
    if (!changed && !detail && !this.terminal() && Date.now()-this.lastRender<100) return;
    this.lastRender=Date.now();
    this.options.onUpdate?.({state,detail,direction:this.direction,files:this.manifest || [],bytes:this.completedBytes + (this.direction === 'send' ? this.ack : this.current?.received || 0),total:this.total || 0});
  }
  control(type, rest = {}) {
    if (!this.conn.open) throw Error('Device is no longer connected.');
    this.conn.send(JSON.stringify({type,...rest}));
  }
  async until(predicate) {
    const started = Date.now();
    while (!predicate()) {
      if (this.terminal()) throw Error('Transfer stopped.');
      if (Date.now() - started > (this.state==='waiting'?180000:120000)) throw Error('Device did not respond.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  async run() {
    this.manifest = validateManifest(this.files); this.total = this.manifest.reduce((n,f)=>n+f.size,0);
    this.emit('waiting'); this.control('offer',{files:this.manifest});
    await this.until(()=>this.accepted);
    for (let i=0; i<this.files.length; i++) {
      this.index = i; this.ack = 0; this.sent = 0; this.ready = false; this.fileDone = false;
      const file = this.files[i]; const hash = sha256.create();
      this.control('start',{index:i}); await this.until(()=>this.ready);
      this.emit('transferring');
      for (let offset=0; offset<file.size; offset+=CHUNK) {
        await this.until(()=>this.sent-this.ack < 512*1024 && (this.conn.dataChannel?.bufferedAmount || 0)<1024*1024);
        const bytes = new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer());
        if (this.terminal()) return;
        hash.update(bytes); this.sent += bytes.length; this.conn.send(bytes.buffer);
      }
      await this.until(()=>this.ack === file.size);
      this.control('end',{index:i,hash:bytesToHex(hash.digest())});
      await this.until(()=>this.fileDone);
      this.completedBytes += file.size; this.ack = 0; this.emit();
    }
    this.awaitingDone=true;this.control('done'); await this.until(()=>this.doneAck);
    clearInterval(this.watch); this.emit('complete');
    setTimeout(()=>this.conn.close(),500);
  }
  async receive(raw) {
    if (this.terminal()) return;
    this.lastActivity = Date.now();
    if (typeof raw !== 'string') {
      if (this.direction !== 'receive' || this.state !== 'transferring' || !this.current) throw Error('Unexpected file data.');
      const bytes = new Uint8Array(raw instanceof Blob ? await raw.arrayBuffer() : raw);
      const c = this.current;
      if (!bytes.length || bytes.length > CHUNK || c.received+bytes.length > c.file.size) throw Error('Invalid file chunk.');
      c.hash.update(bytes); await c.sink.write(bytes); c.received += bytes.length;
      if(this.terminal())return;
      this.control('ack',{index:this.index,bytes:c.received}); this.emit(); return;
    }
    if (raw.length > 1024*1024) throw Error('Control message too large.');
    const m = JSON.parse(raw);
    if (!m || typeof m.type !== 'string') throw Error('Invalid transfer message.');
    if (m.type === 'cancel' || m.type === 'decline' || m.type === 'error') {
      const reason=typeof m.reason==='string'?m.reason.slice(0,200):m.type==='decline'?'Receiver declined the transfer.':'The other device stopped the transfer.';
      this.fail(reason,m.type==='decline'?'declined':m.type==='error'?'failed':'cancelled',false); return;
    }
    if (this.direction === 'send') {
      if (m.type === 'accept' && this.state === 'waiting') this.accepted = true;
      else if (m.type === 'ready' && m.index === this.index) this.ready = true;
      else if (m.type === 'ack' && m.index === this.index && Number.isSafeInteger(m.bytes) && m.bytes>=this.ack && m.bytes<=this.sent) { this.ack=m.bytes; this.emit(); }
      else if (m.type === 'file-done' && m.index === this.index) this.fileDone=true;
      else if (m.type === 'done-ack' && this.awaitingDone) this.doneAck=true;
      else throw Error('Unexpected transfer acknowledgement.');
      return;
    }
    if (m.type === 'offer' && this.state === 'connecting') {
      this.manifest=validateManifest(m.files); this.total=this.manifest.reduce((n,f)=>n+f.size,0);
      this.emit('offered'); this.options.onOffer?.(this.manifest,this); return;
    }
    if (m.type === 'start' && this.accepted && !this.current && m.index===this.index+1 && m.index<this.manifest.length) {
      this.index=m.index; const file=this.manifest[this.index];
      const sink=await this.sinkFactory(file,this.index);
      if(this.terminal()){await sink.abort?.();return;}
      this.current={file,received:0,hash:sha256.create(),sink};
      this.emit('transferring'); this.control('ready',{index:this.index}); return;
    }
    if (m.type === 'end' && this.current && m.index===this.index) {
      const c=this.current;
      if (c.received!==c.file.size || bytesToHex(c.hash.digest())!==m.hash) throw Error('File integrity check failed. Please resend.');
      const result=await c.sink.close();
      if(this.terminal())return;
      this.options.onFile?.({...c.file,...result});
      this.completedBytes+=c.file.size; this.current=null;
      this.control('file-done',{index:this.index}); this.emit(); return;
    }
    if (m.type === 'done' && this.accepted && !this.current && this.index===this.manifest.length-1) {
      this.control('done-ack'); clearInterval(this.watch); this.emit('complete'); return;
    }
    throw Error('Unexpected transfer message.');
  }
  accept(sinkFactory) {
    if (this.state!=='offered') return;
    this.sinkFactory=sinkFactory; this.accepted=true; this.lastActivity=Date.now();
    this.emit('transferring'); this.control('accept');
  }
  decline() { this.fail('Transfer declined.','declined',true); }
  cancel() { this.fail('Transfer cancelled.','cancelled',true); }
  fail(detail,state='failed',notify=true) {
    if (this.terminal()) return;
    if (notify && this.conn.open) { try {this.control(state==='declined'?'decline':state==='failed'?'error':'cancel',{reason:detail.slice(0,200)});}catch{} }
    clearInterval(this.watch); this.emit(state,detail);
    const sink=this.current?.sink;
    Promise.resolve().then(()=>sink?.abort?.()).catch(()=>{});
    this.current=null;
    setTimeout(()=>this.conn.close(),100);
  }
}

export function memorySink() {
  let chunks=[];
  return {write:async bytes=>{chunks.push(bytes);},close:async()=>{const blob=new Blob(chunks,{type:'application/octet-stream'});chunks=[];return {blob};},abort:async()=>{chunks=[];}};
}

export async function directorySink(directory,file) {
  const original=safeName(file.name); let name=original;
  // Never overwrite an existing file, including duplicate names in one batch.
  for(let suffix=1;;suffix++) {
    try {await directory.getFileHandle(name);name=`${original} (${suffix})`;}
    catch(e) {if(e.name==='NotFoundError') break;throw e;}
  }
  const handle=await directory.getFileHandle(name,{create:true});
  const writer=await handle.createWritable();
  return {write:bytes=>writer.write(bytes),close:async()=>{await writer.close();return {savedName:name};},abort:()=>writer.abort()};
}
