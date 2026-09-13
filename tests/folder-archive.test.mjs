import test from 'node:test';
import {folderArchive} from '../src/folder-archive.js';
export async function checkFolderArchive(folderArchive){
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const file=(path,values)=>({name:path.split('/').at(-1),webkitRelativePath:path,lastModified:1700000000000,size:values.length,slice:(s,e)=>({arrayBuffer:async()=>Uint8Array.from(values.slice(s,e)).buffer})});
 const sources=[file('共有/empty.txt',[]),file('共有/عربي/ملف.txt',[0,128,255,13,10]),file('共有/digits.txt',[49,50,51,52,53,54,55,56,57])];
 const archive=await folderArchive(sources),data=new Uint8Array(await archive.slice().arrayBuffer()),view=new DataView(data.buffer);
 const footer=data.length-98;
 assert(view.getUint32(footer,true)===0x06064b50,'ZIP64 footer signature');
 assert(Number(view.getBigUint64(footer+32,true))===3,'Entry count');
 assert(view.getUint32(footer+56,true)===0x07064b50&&Number(view.getBigUint64(footer+64,true))===footer,'ZIP64 locator');
 assert(view.getUint32(footer+76,true)===0x06054b50,'Legacy footer');
 let offset=Number(view.getBigUint64(footer+48,true));
 const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;}return (value^0xffffffff)>>>0;};
 for(let index=0;index<3;index++){
  assert(view.getUint32(offset,true)===0x02014b50,'Central directory signature');
  const nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true);
  const name=new TextDecoder().decode(data.slice(offset+46,offset+46+nameLength));
  const expected=sources.find(f=>f.webkitRelativePath===name);assert(!!expected,'Unicode path preserved');
  const extra=offset+46+nameLength;
  const size=Number(view.getBigUint64(extra+4,true)),local=Number(view.getBigUint64(extra+20,true));
  assert(size===expected.size,'64-bit entry size');
  const payload=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
  const bytes=data.slice(payload,payload+size),original=new Uint8Array(await expected.slice(0,size).arrayBuffer());
  assert(bytes.every((b,i)=>b===original[i])&&bytes.length===original.length,'Extracted bytes match');
  assert(view.getUint32(offset+16,true)===crc(bytes),'Independent CRC32 check');
  assert(view.getUint32(payload+size,true)===0x08074b50,'Descriptor signature');
  assert(view.getUint32(payload+size+4,true)===crc(bytes),'Descriptor CRC32');
  offset+=46+nameLength+extraLength;
 }
 assert(offset===footer,'Central directory length');
 const shuffled=await folderArchive([...sources].reverse());
 for(let start=0;start<data.length;start+=17){
  const chunk=new Uint8Array(await shuffled.slice(start,Math.min(data.length,start+17)).arrayBuffer());
  assert(chunk.every((b,i)=>b===data[start+i]),'Deterministic sliced archive and resume');
 }
 const huge=await folderArchive([{name:'huge.bin',webkitRelativePath:'Folder/huge.bin',size:5*1024**3,lastModified:0,slice(){throw Error('Should not read payload during metadata preparation');}}]);
 const local=new DataView(await huge.slice(0,64).arrayBuffer());
 assert(local.getBigUint64(30+new TextEncoder().encode('Folder/huge.bin').length+4,true)===5n*1024n**3n,'File size larger than 4 GiB stays intact');
 assert(huge.size>5*1024**3,'Archive retains a safe 64-bit total');
 let rejected=false;try{await folderArchive([file('../unsafe.txt',[])]);}catch{rejected=true;}assert(rejected,'Unsafe paths rejected');
 return 'ZIP64 structure, independent CRC32, Unicode paths, empty and binary files, deterministic resume slices, and >4 GiB metadata passed';
}

test('folder ZIP64 preserves large-file sizes, content and international paths',()=>checkFolderArchive(folderArchive));
