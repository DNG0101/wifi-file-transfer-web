import {CheckpointHash} from './integrity.js';
let hash;
self.onmessage=({data})=>{
  try {
    let value;
    if(data.op==='reset'){hash=new CheckpointHash(data.value);value=true;}
    else if(data.op==='update')value=hash.update(data.value);
    else if(data.op==='digest')value=hash.digest();
    else throw Error('Unknown integrity operation');
    self.postMessage({id:data.id,value});
  }catch(e){self.postMessage({id:data.id,error:e.message});}
};
