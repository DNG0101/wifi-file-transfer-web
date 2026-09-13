import test from 'node:test';
import {readFile} from 'node:fs/promises';
export async function checkDownloadCleanup(install){
 const rows=[{id:'receive:done',transferId:'done',direction:'receive',state:'complete'},{id:'receive:partial',transferId:'partial',direction:'receive',state:'transferring'},{id:'send:done',transferId:'sent',direction:'send',state:'complete'}];
 const removed=[],cleaned=[],revoked=[],nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const records={list:async()=>rows,remove:async id=>removed.push(id)};
 const downloads=[{transferId:'done',url:'blob:done',line:{remove(){}}},{transferId:'partial',url:'blob:partial',line:{remove(){}}}];
 const BlockStorage={open:async record=>({cleanup:async()=>cleaned.push(record.id)})};
 const deps={$,records,downloads,BlockStorage,URL:{revokeObjectURL:url=>revoked.push(url)},busy:()=>false,renderRecovery:async()=>{},number:String,notice:()=>{}};
 install(deps);await $('clear-downloads').onclick();
 if(JSON.stringify(removed)!==JSON.stringify(['receive:done'])||JSON.stringify(cleaned)!==JSON.stringify(removed))throw Error('Only completed receive copies may be cleared');
 if(downloads.length!==1||downloads[0].transferId!=='partial'||revoked[0]!=='blob:done')throw Error('Only completed links should be released');
 removed.length=0;deps.BlockStorage={open:async()=>({cleanup:async()=>{throw Error('disk failure');}})};
 install(deps);await $('clear-downloads').onclick();
 if(removed.length)throw Error('Do not remove recovery metadata if deletion failed');
 return 'Explicit cleanup clears completed copies and links, preserves unfinished transfers, and retains metadata on deletion failure';
}

test('download cleanup preserves incomplete data and does not discard failed deletions',async()=>{
 const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const implementation=source.slice(source.indexOf("$('clear-downloads').onclick"),source.indexOf('function track('));
 await checkDownloadCleanup(deps=>new Function('deps',"const {$,records,downloads,BlockStorage,URL,busy,renderRecovery,number,notice}=deps;\n"+implementation)(deps));
});
