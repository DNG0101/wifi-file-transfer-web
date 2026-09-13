import test from 'node:test';
import {transferBatches} from '../src/send-queue.js';
import {manifestFor} from '../src/block-transfer.js';
export function checkTransferQueue(transferBatches,manifestFor){
 const files=Array.from({length:1003},(_,i)=>({name:'国際-'+i+'.txt',size:i,lastModified:1,type:'text/plain'}));
 const batches=transferBatches(files);
 if(batches.length<6||batches.flat().length!==files.length)throw Error('Large file selection was truncated');
 if(!batches.flat().every((f,i)=>f===files[i]))throw Error('Queue must preserve selection order');
 for(const batch of batches)manifestFor(batch);
 const long=Array.from({length:300},(_,i)=>({name:'名'.repeat(150)+i+'.txt',size:0,lastModified:0}));
 const smaller=transferBatches(long);
 if(smaller.length<=2)throw Error('UTF-8 metadata must constrain batches');
 for(const batch of smaller)manifestFor(batch);
 let failed=false;try{transferBatches([{name:'bad',size:-1}]);}catch{failed=true;}
 if(!failed)throw Error('Invalid files must not be silently omitted');
 return '1,003 files queued without loss; UTF-8 metadata bounded; invalid file rejected';
}

test('large selections split into bounded batches without losing files',()=>checkTransferQueue(transferBatches,manifestFor));
