import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';

// Versioned checkpoints for the pinned noble SHA-256 implementation. They include
// the 64-byte partial buffer, not file contents, and preserve lengths above 4 GB.
export class CheckpointHash {
  constructor(snapshot) {
    this.hash=sha256.create();
    if(snapshot) {
      if(snapshot.version!==1||!Number.isSafeInteger(snapshot.length)||snapshot.length<0||!Array.isArray(snapshot.words)||snapshot.words.length!==8||!snapshot.words.every(Number.isInteger)||!Array.isArray(snapshot.buffer)||snapshot.buffer.length!==64||snapshot.pos!==snapshot.length%64)throw Error('Invalid saved integrity checkpoint.');
      this.hash.set(...snapshot.words);this.hash.length=snapshot.length;this.hash.pos=snapshot.pos;this.hash.buffer.set(snapshot.buffer);
    }
  }
  update(data){this.hash.update(new Uint8Array(data));return this.snapshot();}
  snapshot(){return {version:1,words:this.hash.get(),length:this.hash.length,pos:this.hash.pos,buffer:Array.from(this.hash.buffer)};}
  digest(){return bytesToHex(this.hash.clone().digest());}
}
export async function blockHash(data){return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',data)));}

export class Integrity {
  constructor(snapshot) {
    this.sequence=0;this.pending=new Map();
    if(typeof Worker==='function') {
      this.worker=new Worker(new URL('../assets/hash-worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{const item=this.pending.get(data.id);if(!item)return;this.pending.delete(data.id);data.error?item.reject(Error(data.error)):item.resolve(data.value);};
      this.worker.onerror=()=>{for(const p of this.pending.values())p.reject(Error('Integrity worker stopped. Retry the transfer.'));this.pending.clear();};
      this.ready=this.call('reset',snapshot);
    }else{this.local=new CheckpointHash(snapshot);this.ready=Promise.resolve();}
  }
  call(op,value){return new Promise((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject});this.worker.postMessage({id,op,value},value instanceof ArrayBuffer?[value]:[]);});}
  async update(bytes){await this.ready;return this.worker?this.call('update',bytes.slice(0)):this.local.update(bytes);}
  async digest(){await this.ready;return this.worker?this.call('digest'):this.local.digest();}
  close(){this.worker?.terminate();for(const p of this.pending.values())p.reject(Error('Integrity operation cancelled.'));this.pending.clear();}
}
