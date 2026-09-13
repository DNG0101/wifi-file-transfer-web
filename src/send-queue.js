import {manifestFor} from './block-transfer.js';
// Bound each protocol greeting, not the total selection. Queue File references.
export function transferBatches(files){
 if(!files.length)throw Error('Choose at least one file.');
 const batches=[];let current=[];
 for(const file of files){
  // Validate the file independently so invalid files are never silently skipped.
  manifestFor([file]);
  const candidate=[...current,file];
  let fits=true;
  try{manifestFor(candidate);}catch{fits=false;}
  if(!fits){if(current.length)batches.push(current);current=[file];}
  else current=candidate;
 }
 if(current.length)batches.push(current);
 return batches;
}
