// A stored ZIP64 archive exposed as a sliceable file. Payloads stay in the
// original File objects; only requested transfer slices are materialized.
const encoder=new TextEncoder();
const CHUNK=8*1024*1024;
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crcUpdate(crc,bytes){for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return crc>>>0;}
function header(size,write){const bytes=new Uint8Array(size);write(new DataView(bytes.buffer));return bytes;}
function u64(view,offset,value){view.setBigUint64(offset,BigInt(value),true);}
function dateFields(ms){const d=new Date(ms||Date.UTC(1980,0,1)),year=Math.max(1980,Math.min(2107,d.getUTCFullYear()));return {time:d.getUTCHours()<<11|d.getUTCMinutes()<<5|d.getUTCSeconds()>>1,date:(year-1980)<<9|(d.getUTCMonth()+1)<<5|d.getUTCDate()};}
export async function folderArchive(files){
 if(!files.length)throw Error('Choose a folder containing files.');
 const key=file=>String(file.webkitRelativePath||file.path||file.name).normalize('NFC');
 files=[...files].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
 const names=new Set(),entries=[];let total=0;
 const add=length=>{const offset=total;total+=length;if(!Number.isSafeInteger(total))throw Error('Folder is too large.');return offset;};
 const parts=[];
 for(const file of files){
  const path=String(file.webkitRelativePath||file.path||file.name).normalize('NFC');
  const segments=path.split('/');
  if(segments.some(s=>!s||s==='.'||s==='..')||path.includes('\\')||/[\u0000-\u001f]/.test(path))throw Error('Unsafe folder path.');
  if(names.has(path))throw Error('Two files have the same archive path: '+path);
  names.add(path);
  const name=encoder.encode(path);
  if(name.length>65535||!Number.isSafeInteger(file.size)||file.size<0)throw Error('Invalid folder file metadata.');
  const entry={file,name,...dateFields(file.lastModified),crc:0xffffffff,hashed:0};
  entry.localOffset=total;
  const local=header(30+name.length+20,v=>{
   v.setUint32(0,0x04034b50,true);v.setUint16(4,45,true);v.setUint16(6,0x0808,true);
   v.setUint16(10,entry.time,true);v.setUint16(12,entry.date,true);
   v.setUint32(18,0xffffffff,true);v.setUint32(22,0xffffffff,true);
   v.setUint16(26,name.length,true);v.setUint16(28,20,true);
   new Uint8Array(v.buffer).set(name,30);const p=30+name.length;
   v.setUint16(p,1,true);v.setUint16(p+2,16,true);u64(v,p+4,file.size);u64(v,p+12,file.size);
  });
  parts.push({offset:add(local.length),length:local.length,bytes:local});
  parts.push({offset:add(file.size),length:file.size,entry,payload:true});
  parts.push({offset:add(24),length:24,entry,descriptor:true});
  entries.push(entry);
 }
 const centralOffset=total;
 for(const entry of entries)parts.push({offset:add(46+entry.name.length+28),length:46+entry.name.length+28,entry,central:true});
 const centralSize=total-centralOffset,zip64Offset=total;
 const end=header(98,v=>{
  v.setUint32(0,0x06064b50,true);u64(v,4,44);v.setUint16(12,45,true);v.setUint16(14,45,true);
  u64(v,24,entries.length);u64(v,32,entries.length);u64(v,40,centralSize);u64(v,48,centralOffset);
  v.setUint32(56,0x07064b50,true);u64(v,64,zip64Offset);v.setUint32(72,1,true);
  v.setUint32(76,0x06054b50,true);v.setUint16(84,65535,true);v.setUint16(86,65535,true);
  v.setUint32(88,0xffffffff,true);v.setUint32(92,0xffffffff,true);
 });
 parts.push({offset:add(end.length),length:end.length,bytes:end});
 async function crc(entry){
  while(entry.hashed<entry.file.size){
   const bytes=new Uint8Array(await entry.file.slice(entry.hashed,Math.min(entry.file.size,entry.hashed+CHUNK)).arrayBuffer());
   if(!bytes.length)throw Error('A source file changed while preparing the folder.');
   entry.crc=crcUpdate(entry.crc,bytes);entry.hashed+=bytes.length;
  }
  return (entry.crc^0xffffffff)>>>0;
 }
 async function metadata(part){
  if(part.bytes)return part.bytes;
  const e=part.entry,sum=await crc(e);
  if(part.descriptor)return header(24,v=>{v.setUint32(0,0x08074b50,true);v.setUint32(4,sum,true);u64(v,8,e.file.size);u64(v,16,e.file.size);});
  return header(part.length,v=>{
   v.setUint32(0,0x02014b50,true);v.setUint16(4,45,true);v.setUint16(6,45,true);v.setUint16(8,0x0808,true);
   v.setUint16(12,e.time,true);v.setUint16(14,e.date,true);v.setUint32(16,sum,true);
   v.setUint32(20,0xffffffff,true);v.setUint32(24,0xffffffff,true);v.setUint16(28,e.name.length,true);v.setUint16(30,28,true);
   v.setUint32(42,0xffffffff,true);new Uint8Array(v.buffer).set(e.name,46);
   const p=46+e.name.length;v.setUint16(p,1,true);v.setUint16(p+2,24,true);u64(v,p+4,e.file.size);u64(v,p+12,e.file.size);u64(v,p+20,e.localOffset);
  });
 }
 const base=(files[0].webkitRelativePath||files[0].path||'Shared folder').split('/')[0];
 const archive={archiveFolder:true,name:base+'.zip',size:total,type:'application/zip',lastModified:files.reduce((n,f)=>Math.max(n,f.lastModified||0),0),slice(start=0,end=total){
  start=Math.max(0,Math.min(total,start<0?total+start:start));end=Math.max(start,Math.min(total,end<0?total+end:end));
  return {size:end-start,async arrayBuffer(){
   if(end-start>CHUNK)throw Error('Read the archive in blocks of at most 8 MiB.');
   const output=new Uint8Array(end-start);
   let low=0,high=parts.length;
   while(low<high){const mid=(low+high)>>>1;if(parts[mid].offset+parts[mid].length<=start)low=mid+1;else high=mid;}
   for(let i=low;i<parts.length&&parts[i].offset<end;i++){
    const part=parts[i],from=Math.max(start,part.offset),to=Math.min(end,part.offset+part.length);
    if(to<=from)continue;
    let bytes;
    if(part.payload){
     bytes=new Uint8Array(await part.entry.file.slice(from-part.offset,to-part.offset).arrayBuffer());
     if(bytes.length!==to-from)throw Error('A source file changed while sending the folder.');
     if(part.entry.hashed===from-part.offset){part.entry.crc=crcUpdate(part.entry.crc,bytes);part.entry.hashed+=bytes.length;}
    }else bytes=(await metadata(part)).subarray(from-part.offset,to-part.offset);
    output.set(bytes,from-start);
   }
   return output.buffer;
  }};
 }};
 return archive;
}
