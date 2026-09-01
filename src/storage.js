import {Integrity,blockHash} from './integrity.js';
import {safeName} from './transfer.js';
export const BLOCK_SIZE=8*1024*1024;
export const MAX_FILE_SIZE=1024**4;
const DB_NAME='wft-durable-v3';
const CLEANUP_MS=48*60*60*1000;
let database;
export async function db() {
  if(database)return database;
  database=await new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{for(const name of ['transfers','blocks','devices','settings'])request.result.createObjectStore(name,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });return database;
}
async function transact(store,operation,write=false) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(store,write?'readwrite':'readonly');let result;
    const request=operation(tx.objectStore(store));request.onsuccess=()=>{result=request.result;};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||request.error);tx.onabort=()=>reject(tx.error||Error('Storage write was interrupted.'));
  });
}
export const records={get:id=>transact('transfers',s=>s.get(id)),put:record=>transact('transfers',s=>s.put(record),true),list:()=>transact('transfers',s=>s.getAll()),remove:id=>transact('transfers',s=>s.delete(id),true)};
export const deviceRecords={get:id=>transact('devices',s=>s.get(id)),put:record=>transact('devices',s=>s.put(record),true),list:()=>transact('devices',s=>s.getAll()),remove:id=>transact('devices',s=>s.delete(id),true)};
export async function cleanupApplicationStorage(now=Date.now()){
  const marker='wft-last-storage-cleanup';let last=0;
  try{last=Number(localStorage.getItem(marker))||0;}catch{}
  if(last&&now-last<CLEANUP_MS)return false;
  const keepLocal=new Set(['wft-device-name','wft-device-id','app_device_uuid','wft-device-id-version','wft-device-id-updated',marker]);
  try{
    const values=new Map();for(const key of keepLocal)if(key!==marker){const value=localStorage.getItem(key);if(value!==null)values.set(key,value);}
    localStorage.clear();for(const [key,value] of values)localStorage.setItem(key,value);localStorage.setItem(marker,String(now));
  }catch{}
  try{
    const database=await db();await new Promise((resolve,reject)=>{
      const tx=database.transaction(['transfers','blocks','settings'],'readwrite');
      tx.objectStore('transfers').clear();tx.objectStore('blocks').clear();tx.objectStore('settings').clear();
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Cleanup interrupted.'));
    });
  }catch{}
  try{indexedDB.deleteDatabase('wft-presence-v1');}catch{}
  return true;
}
export function cleanPath(value) {
  const parts=String(value||'').replace(/\\/g,'/').split('/');
  if(parts.length>20||parts.some(p=>!p||p==='.'||p==='..'||p.length>240)||String(value).startsWith('/'))throw Error('Unsafe folder path.');
  return parts.map(safeName).join('/');
}
export async function storageAvailability(bytes=0) {
  const estimate=await navigator.storage?.estimate?.().catch(()=>({}))||{};
  const available=typeof estimate.quota==='number'?Math.max(0,estimate.quota-(estimate.usage||0)):null;
  return {opfs:!!navigator.storage?.getDirectory,indexedDB:typeof indexedDB!=='undefined',directory:typeof window.showDirectoryPicker==='function',available,enough:available===null||available>bytes*2+16*1024*1024};
}
export function friendlyStorageError(e) {
  if(e?.name==='QuotaExceededError')return 'Storage is full. Free space, then retry.';
  if(['NotAllowedError','SecurityError'].includes(e?.name))return 'Storage permission was denied. Choose the destination again and allow access.';
  return e?.message||'Could not write the file.';
}
async function uniqueFile(directory,name) {
  const dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,extension=dot>0?name.slice(dot):'';
  for(let n=0;n<10000;n++) {
    const candidate=n?`${stem} (${n})${extension}`:name;
    try{await directory.getFileHandle(candidate);}catch(e){if(e.name==='NotFoundError')return {name:candidate,handle:await directory.getFileHandle(candidate,{create:true})};throw e;}
  }throw Error('Too many files with the same name. Choose another folder.');
}
export class BlockStorage {
  constructor(record,root,staging){this.record=record;this.root=root;this.staging=staging;}
  static async open(record) {
    let root,staging;
    if(record.storage==='directory') {
      root=record.directory;
      if(!root)throw Error('Choose the original destination folder to resume.');
      if(root.queryPermission&&await root.queryPermission({mode:'readwrite'})!=='granted')throw Error('Allow access to the original destination folder before resuming.');
    }else if(record.storage==='opfs') root=await navigator.storage.getDirectory();
    if(root)staging=await root.getDirectoryHandle('.wft-'+record.transferId,{create:true});
    return new BlockStorage(record,root,staging);
  }
  key(file,block){return `${this.record.transferId}:${file}:${block}`;}
  async write(file,block,bytes) {
    if(this.staging){const h=await this.staging.getFileHandle(`f${file}-b${block}.part`,{create:true});const w=await h.createWritable();try{await w.write(bytes);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
    else await transact('blocks',s=>s.put({id:this.key(file,block),data:new Blob([bytes])}),true);
  }
  async read(file,block) {
    if(this.staging)return (await (await this.staging.getFileHandle(`f${file}-b${block}.part`)).getFile()).arrayBuffer();
    const item=await transact('blocks',s=>s.get(this.key(file,block)));if(!item)throw Error('A temporary transfer block is missing. Retry the transfer.');return item.data.arrayBuffer();
  }
  async removeBlock(file,block) {
    if(this.staging)await this.staging.removeEntry(`f${file}-b${block}.part`).catch(()=>{});
    else await transact('blocks',s=>s.delete(this.key(file,block)),true);
  }
  async verifyPrefix(file,state) {
    for(let b=0;b<state.next;b++) {
      try{const bytes=await this.read(file,b);if(await blockHash(bytes)!==state.hashes[b])return b;}catch{return b;}
    }return state.next;
  }
  async finalize(file,state,digest,onProgress=()=>{},isCancelled=()=>false) {
    const meta=this.record.manifest[file];let output,writer;const fallback=[];
    const hash=new Integrity();
    try {
      if(this.record.storage==='directory') {
        let dir=this.root;const parts=cleanPath(meta.path||meta.name).split('/');
        for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});
        output=await uniqueFile(dir,parts.at(-1));writer=await output.handle.createWritable();
      }else if(this.staging){output={name:meta.name,handle:await this.staging.getFileHandle(`verified-${file}`,{create:true})};writer=await output.handle.createWritable();}
      else if(meta.size>256*1024*1024)throw Error('This browser needs a download folder or OPFS for large files.');
      for(let b=0;b<state.next;b++) {
        if(isCancelled())throw Error('Verification cancelled.');
        const bytes=await this.read(file,b);
        if(await blockHash(bytes)!==state.hashes[b])throw Error('A temporary block changed. Retry the transfer.');
        await hash.update(bytes);if(writer)await writer.write(bytes);else fallback.push(bytes);
        onProgress(Math.min(meta.size,(b+1)*BLOCK_SIZE));
      }
      if(await hash.digest()!==digest)throw Error('Final file integrity failed. Nothing has been marked complete.');
      if(isCancelled())throw Error('Verification cancelled.');
      if(writer)await writer.close();
      if(isCancelled())throw Error('Verification cancelled before completion was acknowledged.');
      state.digest=digest;state.complete=true;state.outputName=output?.name;state.outputHandle=output?.handle;
      await records.put(this.record);
      if(this.record.storage==='directory')for(let b=0;b<state.next;b++)await this.removeBlock(file,b);
      return this.record.storage==='directory'?{savedName:output.name}:{blob:output?await output.handle.getFile():new Blob(fallback,{type:'application/octet-stream'})};
    }catch(e){await writer?.abort().catch(()=>{});throw e;}finally{hash.close();}
  }
  async completedFile(file) {const state=this.record.files[file];if(this.record.storage==='directory')return {savedName:state.outputName};if(state.outputHandle)return {blob:await state.outputHandle.getFile()};return this.finalize(file,state,state.digest);}
  async cleanup() {
    if(this.staging)await this.root.removeEntry('.wft-'+this.record.transferId,{recursive:true}).catch(()=>{});
    else for(let f=0;f<this.record.files.length;f++)for(let b=0;b<this.record.files[f].next;b++)await this.removeBlock(f,b);
  }
}
