import test from 'node:test';
import assert from 'node:assert/strict';
import {BlockStorage,records,BLOCK_SIZE} from '../src/storage.js';
import {blockHash} from '../src/integrity.js';
import {manifestFor,encodeChunk,decodeChunk} from '../src/block-transfer.js';
function directory(){
 const files=new Map(),writes=[];
 const dir={files,writes,async getFileHandle(name,options={}){
  if(!files.has(name)){if(!options.create)throw new DOMException('missing','NotFoundError');files.set(name,new Uint8Array());}
  return {async getFile(){return new Blob([files.get(name)]);},async createWritable(options={}){
   writes.push({name,keep:!!options.keepExistingData,bytes:0});const entry=writes.at(-1);let bytes=options.keepExistingData?files.get(name).slice():new Uint8Array();let cursor=0;
   return {async write(input){const at=input?.type==='write'?input.position:cursor,data=new Uint8Array(input?.type==='write'?input.data:input);const next=new Uint8Array(Math.max(bytes.length,at+data.length));next.set(bytes);next.set(data,at);bytes=next;cursor=at+data.length;entry.bytes+=data.length;},async close(){files.set(name,bytes);},async abort(){}};
  }};
 },async removeEntry(name){files.delete(name);}};return dir;
}
test('large file metadata above 10 GiB and 1 TiB retains exact byte positions',()=>{
 for(const size of [10*1024**3+123,2*1024**4+321,Number.MAX_SAFE_INTEGER])assert.equal(manifestFor([{name:'large.bin',size}])[0].size,size);
 assert.throws(()=>manifestFor([{name:'bad.bin',size:Number.MAX_SAFE_INTEGER+1}]));
 assert.throws(()=>manifestFor([{name:'a',size:Number.MAX_SAFE_INTEGER},{name:'b',size:1}]),/Total/);
 const id=crypto.randomUUID(),block=Math.floor((2*1024**4)/BLOCK_SIZE),frame=decodeChunk(encodeChunk(id,0,block,7,new Uint8Array([9])),id);assert.equal(frame.block*BLOCK_SIZE+frame.offset,2*1024**4+7);
});
test('new block staging writes every payload byte once then assembles once without copying growing files',async()=>{
 const parts=[new Uint8Array([1,2,3]),new Uint8Array([4,5,6]),new Uint8Array([7,8,9])],staging=directory();
 const record={transferId:'test',storage:'opfs',layout:'blocks-v2',manifest:[{name:'large.bin',size:9}],files:[{next:3,hashes:await Promise.all(parts.map(blockHash)),complete:false}]};
 const storage=new BlockStorage(record,{},staging);for(let i=0;i<parts.length;i++)await storage.write(0,i,parts[i]);
 const original=records.put;records.put=async()=>{};
 try{const result=await storage.finalizeVerified(0,record.files[0],'verified-hash');assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())],[1,2,3,4,5,6,7,8,9]);assert.equal(staging.writes.reduce((sum,w)=>sum+w.bytes,0),18);assert.ok(staging.writes.every(w=>!w.keep));assert.deepEqual([...staging.files.keys()],['verified-0']);assert.equal(record.files[0].complete,true);}finally{records.put=original;}
});
test('corrupt staged block is rejected during disk assembly',async()=>{
 const staging=directory(),record={transferId:'test',storage:'opfs',layout:'blocks-v2',manifest:[{name:'bad.bin',size:1}],files:[{next:1,hashes:[await blockHash(new Uint8Array([1]))],complete:false}]};
 const storage=new BlockStorage(record,{},staging);await storage.write(0,0,new Uint8Array([2]));await assert.rejects(()=>storage.finalizeVerified(0,record.files[0],'hash'),/temporary block changed/);assert.equal(record.files[0].complete,false);
});
