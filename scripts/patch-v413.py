from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def load(path): return (ROOT/path).read_text()
def save(path,text): (ROOT/path).write_text(text)
def replace_once(text,old,new,label):
    n=text.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 match, found {n}')
    return text.replace(old,new,1)

# ---------------- block-transfer.js ----------------
p='src/block-transfer.js';s=load(p)
s=replace_once(s,
"const VERSION=4,HEADER=36,MAX_FRAME=1024*1024,MAX_CONTROL=48*1024;\nconst MIN_SEND_BUFFER=8*1024*1024,MAX_SEND_BUFFER=32*1024*1024;\nconst MAX_LANES=4,PARALLEL_THRESHOLD=16*1024*1024;",
"const VERSION=5,HEADER=36,MAX_FRAME=1024*1024,MAX_CONTROL=48*1024;\nconst MIN_SEND_BUFFER=8*1024*1024,MAX_SEND_BUFFER=32*1024*1024;\nconst MAX_LANES=4,PARALLEL_THRESHOLD=16*1024*1024;\nconst DEFAULT_BLOCK_WINDOW=4,MAX_BLOCK_WINDOW=6,RANGE_BUCKET=64*1024;",
'protocol/window constants')

s=replace_once(s,
"    this.lanes=new Map();this.lanePlans=new Map();\n    this.attach(conn);",
"    this.lanes=new Map();this.lanePlans=new Map();this.blocks=new Map();this.commitQueue=Promise.resolve();this.receiveHashes=new Map();this.completedData=new Map();\n    this.attach(conn);",
'constructor pipeline state')

s=replace_once(s,
"    const old=this.conn,previousQueue=this.queue,oldLanes=[...(this.lanes?.values()||[])];this.epoch++;const epoch=this.epoch;this.conn=conn;this.queue=previousQueue?.catch(()=>{})||Promise.resolve();this.queuedBytes=0;this.block=null;this.helloSeen=false;this.transport=transportPlan(conn);",
"    const old=this.conn,previousQueue=this.queue,oldLanes=[...(this.lanes?.values()||[])];this.epoch++;const epoch=this.epoch;this.conn=conn;this.queue=previousQueue?.catch(()=>{})||Promise.resolve();this.queuedBytes=0;\n    for(const hash of this.receiveHashes?.values()||[])hash.close();this.receiveHashes=new Map();this.completedData=new Map();this.blocks=new Map();this.commitQueue=this.commitQueue?.catch(()=>{})||Promise.resolve();this.helloSeen=false;this.transport=transportPlan(conn);",
'attach pipeline reset')

s=s.replace("if(this.queuedBytes>BLOCK_SIZE+MAX_SEND_BUFFER*MAX_LANES)throw Error('Peer sent too much data without acknowledgement.');",
            "if(this.queuedBytes>BLOCK_SIZE*MAX_BLOCK_WINDOW+MAX_SEND_BUFFER*MAX_LANES)throw Error('Peer sent too much data without acknowledgement.');")
s=s.replace("if(this.queuedBytes>BLOCK_SIZE+MAX_SEND_BUFFER*MAX_LANES){this.handleError(Error('Peer sent too much parallel data without acknowledgement.'));conn.close();return;}",
            "if(this.queuedBytes>BLOCK_SIZE*MAX_BLOCK_WINDOW+MAX_SEND_BUFFER*MAX_LANES){this.handleError(Error('Peer sent too much parallel data without acknowledgement.'));conn.close();return;}")

s=replace_once(s,
"  planFor(conn){\n    for(const [index,lane] of this.lanes)if(lane===conn)return this.lanePlans.get(index)||transportPlan(conn);\n    return transportPlan(conn);\n  }",
"  planFor(conn){\n    for(const [index,lane] of this.lanes)if(lane===conn){\n      const cached=this.lanePlans.get(index)||transportPlan(conn),fresh=transportPlan(conn);\n      if(fresh.payload>cached.payload||fresh.high!==cached.high||fresh.low!==cached.low){this.lanePlans.set(index,fresh);return fresh;}\n      return cached;\n    }\n    return transportPlan(conn);\n  }",
'dynamic transport refresh')

s=s.replace("if(this.block&&!this.terminal())this.conn?.close();","if(this.blocks?.size&&!this.terminal())this.conn?.close();")
s=s.replace("const plan=this.lanePlans.get(index)||transportPlan(conn),dc=conn.dataChannel;","const plan=this.planFor(conn),dc=conn.dataChannel;")

s=replace_once(s,
"            const waiter=this.waiters.find(w=>w.types.includes(m.type));",
"            const waiter=this.waiters.find(w=>w.types.includes(m.type)&&(!w.match||w.match(m)));",
'ack matcher')

s=replace_once(s,
"  request(type,extra,types,epoch) {\n    this.guard(epoch);\n    return new Promise((resolve,reject)=>{\n      const timeout=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==waiter);reject(Error('The other device did not respond. Your progress is saved.'));},type==='file-finish'?3600000:180000);\n      const waiter={types:Array.isArray(types)?types:[types],resolve:m=>{clearTimeout(timeout);resolve(m);},reject:e=>{clearTimeout(timeout);reject(e);}};\n      this.waiters.push(waiter);try{this.send(type,extra);}catch(e){this.waiters.pop();waiter.reject(e);}\n    });\n  }",
"  request(type,extra,types,epoch,match) {\n    this.guard(epoch);\n    return new Promise((resolve,reject)=>{\n      const timeout=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==waiter);reject(Error('The other device did not respond. Your progress is saved.'));},type==='file-finish'?3600000:180000);\n      const waiter={types:Array.isArray(types)?types:[types],match,resolve:m=>{clearTimeout(timeout);resolve(m);},reject:e=>{clearTimeout(timeout);reject(e);}};\n      this.waiters.push(waiter);try{this.send(type,extra);}catch(e){this.waiters.pop();waiter.reject(e);}\n    });\n  }",
'matched requests')

old_loop="""        const prepareBlock=b=>b<count?(async()=>{
          const bytes=await file.slice(b*BLOCK_SIZE,Math.min(file.size,(b+1)*BLOCK_SIZE)).arrayBuffer();
          return {bytes,digest:await blockHash(bytes)};
        })():null;
        let pendingBlock=prepareBlock(state.next);
        for(let b=state.next;b<count;b++) {
          await this.writable(epoch);
          const prepared=await pendingBlock;this.guard(epoch);
          pendingBlock=prepareBlock(b+1);
          const bytes=prepared.bytes,digest=prepared.digest,checkpoint=hash.update(bytes);checkpoint.catch(()=>{});
          let attempts=0,ack;
          do {
            await this.writable(epoch);
            await this.request('block-start',{file:f,block:b,size:bytes.byteLength,hash:digest},'ready',epoch);
            for(let offset=0;offset<bytes.byteLength;) {
              const selected=this.pickLane();
              await this.writable(epoch,selected.conn);this.guard(epoch);
              const length=Math.min(selected.plan.payload,bytes.byteLength-offset);
              try{selected.conn.send(encodeChunk(this.id,f,b,offset,new Uint8Array(bytes,offset,length)));}
              catch(error){if(selected.index){this.lanes.delete(selected.index);this.lanePlans.delete(selected.index);continue;}throw error;}
              offset+=length;
            }
            ack=await this.request('block-end',{file:f,block:b},['block-ack','block-nack'],epoch);
            if(ack.file!==f||ack.block!==b)throw Error('Acknowledgement belongs to another block.');
          }while(ack.type==='block-nack'&&++attempts<3);
          if(ack.type!=='block-ack'||ack.hash!==digest)throw Error('A block repeatedly failed integrity checks. Retry on a stable connection.');
          state.checkpoint=await checkpoint;this.guard(epoch);state.hashes[b]=digest;state.next=b+1;this.record.updated=Date.now();await this.store.put(this.record);this.emit();
        }
"""
new_loop="""        const prepareBlock=async b=>{
          const bytes=await file.slice(b*BLOCK_SIZE,Math.min(file.size,(b+1)*BLOCK_SIZE)).arrayBuffer();this.guard(epoch);
          const digestPromise=blockHash(bytes),checkpoint=hash.update(bytes);checkpoint.catch(()=>{});
          return {block:b,bytes,digest:await digestPromise,checkpoint};
        };
        const sendPrepared=async prepared=>{
          const b=prepared.block,bytes=prepared.bytes,digest=prepared.digest;let attempts=0,ack;
          do {
            await this.writable(epoch);
            await this.request('block-start',{file:f,block:b,size:bytes.byteLength,hash:digest},'ready',epoch,m=>m.file===f&&m.block===b);
            for(let offset=0;offset<bytes.byteLength;) {
              const selected=this.pickLane();
              await this.writable(epoch,selected.conn);this.guard(epoch);
              const length=Math.min(selected.plan.payload,bytes.byteLength-offset);
              try{selected.conn.send(encodeChunk(this.id,f,b,offset,new Uint8Array(bytes,offset,length)));}
              catch(error){if(selected.index){this.lanes.delete(selected.index);this.lanePlans.delete(selected.index);continue;}throw error;}
              offset+=length;
            }
            ack=await this.request('block-end',{file:f,block:b},['block-ack','block-nack'],epoch,m=>m.file===f&&m.block===b);
          }while(ack.type==='block-nack'&&++attempts<3);
          if(ack.type!=='block-ack'||ack.hash!==digest)throw Error('A block repeatedly failed integrity checks. Retry on a stable connection.');
          return prepared;
        };
        const active=new Map(),completed=new Map();let launch=state.next;
        const window=Math.min(MAX_BLOCK_WINDOW,Math.max(1,Math.min(DEFAULT_BLOCK_WINDOW,count-state.next)));
        while(state.next<count){
          while(launch<count&&launch<state.next+window){
            const b=launch++,prepared=await prepareBlock(b);this.guard(epoch);
            const task=sendPrepared(prepared).then(result=>{completed.set(b,result);return b;});active.set(b,task);task.then(()=>active.delete(b),()=>active.delete(b));
          }
          if(!completed.has(state.next)){
            if(!active.size)throw Error('Sliding transfer window stalled.');
            await Promise.race(active.values());this.guard(epoch);
          }
          let advanced=false;
          while(completed.has(state.next)){
            const b=state.next,result=completed.get(b);completed.delete(b);
            state.checkpoint=await result.checkpoint;this.guard(epoch);state.hashes[b]=result.digest;state.next=b+1;advanced=true;
          }
          if(advanced){this.record.updated=Date.now();await this.store.put(this.record);this.guard(epoch);this.emit();}
        }
"""
s=replace_once(s,old_loop,new_loop,'sliding window sender')

old_saved="""        for(let f=0;f<saved.files.length;f++)if(!saved.files[f].complete){const valid=await this.storage.verifyPrefix(f,saved.files[f]);if(valid!==saved.files[f].next){saved.files[f].next=valid;saved.files[f].hashes=saved.files[f].hashes.slice(0,valid);}}
"""
new_saved="""        for(let f=0;f<saved.files.length;f++)if(!saved.files[f].complete){
          const state=saved.files[f],prior=state.next,valid=await this.storage.verifyPrefix(f,state);state.next=valid;state.hashes=state.hashes.slice(0,valid);
          if(valid&&(valid!==prior||!state.checkpoint)){
            const rebuild=new Integrity();try{let checkpoint=null;for(let b=0;b<valid;b++){this.guard(epoch);checkpoint=await rebuild.update(await this.storage.read(f,b));}state.checkpoint=checkpoint;}finally{rebuild.close();}
          }else if(!valid)state.checkpoint=null;
        }
"""
s=replace_once(s,old_saved,new_saved,'receiver checkpoint recovery')

old_controls="""    if(m.type==='block-start') {
      if(!Number.isInteger(m.file)||m.file<0)throw Error('Invalid file index.');const file=this.manifest[m.file],state=this.record.files[m.file];
      if(this.block||!file||state.complete||!Number.isInteger(m.block)||m.block!==state.next||m.size!==Math.min(BLOCK_SIZE,file.size-m.block*BLOCK_SIZE)||m.size<=0||!HEX.test(m.hash))throw Error('Invalid block metadata.');
      this.block={file:m.file,index:m.block,hash:m.hash,data:new Uint8Array(m.size),received:0,ranges:[],endSeen:false,finalizing:null};this.send('ready',{file:m.file,block:m.block});return;
    }
    if(m.type==='block-end') {
      const block=this.block;if(!block||m.file!==block.file||m.block!==block.index)throw Error('Unexpected file block end.');
      block.endSeen=true;
      if(block.received===block.data.length)await this.finalizeBlock(block,epoch);
      return;
    }
"""
new_controls="""    if(m.type==='block-start') {
      if(!Number.isInteger(m.file)||m.file<0)throw Error('Invalid file index.');const file=this.manifest[m.file],state=this.record.files[m.file],count=file?Math.ceil(file.size/BLOCK_SIZE):0,key=`${m.file}:${m.block}`;
      if(!file||state.complete||!Number.isInteger(m.block)||m.block<state.next||m.block>=Math.min(count,state.next+MAX_BLOCK_WINDOW)||this.blocks.has(key)||m.size!==Math.min(BLOCK_SIZE,file.size-m.block*BLOCK_SIZE)||m.size<=0||!HEX.test(m.hash))throw Error('Invalid block metadata.');
      this.blocks.set(key,{file:m.file,index:m.block,hash:m.hash,data:new Uint8Array(m.size),received:0,buckets:new Map(),endSeen:false,finalizing:null});this.send('ready',{file:m.file,block:m.block});return;
    }
    if(m.type==='block-end') {
      const key=`${m.file}:${m.block}`,block=this.blocks.get(key);if(!block)throw Error('Unexpected file block end.');
      block.endSeen=true;
      if(block.received===block.data.length&&!block.finalizing)this.trackTask(this.finalizeBlock(block,epoch).catch(e=>this.handleError(e)));
      return;
    }
"""
s=replace_once(s,old_controls,new_controls,'multi-block receiver controls')

s=replace_once(s,
"if(!file||!state||state.next!==Math.ceil(file.size/BLOCK_SIZE)||!HEX.test(m.hash)||this.block)throw Error('Cannot verify an incomplete file.');",
"if(!file||!state||state.next!==Math.ceil(file.size/BLOCK_SIZE)||!HEX.test(m.hash)||this.blocks.size)throw Error('Cannot verify an incomplete file.');",
'file finish window check')

old_finish="""      if(state.complete){if(state.digest!==m.hash)throw Error('Saved file hash does not match.');this.options.onFile?.({...file,...await this.storage.completedFile(m.file)});}
      else {
        const result=await this.storage.finalize(m.file,state,m.hash,bytes=>{this.verifiedBytes=bytes;this.emit();if(epoch===this.epoch&&this.conn.open)this.send('verify-progress',{bytes});},()=>this.terminal());
        this.guard(epoch);this.options.onFile?.({...file,...result});
      }
      this.send('file-complete',{file:m.file,hash:m.hash});this.transition(this.localPaused||this.peerPaused?'paused':'transferring');return;
"""
new_finish="""      if(state.complete){if(state.digest!==m.hash)throw Error('Saved file hash does not match.');this.options.onFile?.({...file,...await this.storage.completedFile(m.file)});}
      else {
        let hasher=this.receiveHashes.get(m.file),temporary=false;if(!hasher){hasher=new Integrity(state.checkpoint);temporary=true;}
        const actual=await hasher.digest();if(temporary)hasher.close();if(actual!==m.hash)throw Error('Final file integrity failed. Nothing has been marked complete.');
        const progress=bytes=>{this.verifiedBytes=bytes;this.emit();if(epoch===this.epoch&&this.conn.open)this.send('verify-progress',{bytes});};
        const result=this.storage.finalizeVerified?await this.storage.finalizeVerified(m.file,state,m.hash,progress,()=>this.terminal()):await this.storage.finalize(m.file,state,m.hash,progress,()=>this.terminal());
        this.guard(epoch);this.receiveHashes.get(m.file)?.close();this.receiveHashes.delete(m.file);this.options.onFile?.({...file,...result});
      }
      this.send('file-complete',{file:m.file,hash:m.hash});this.transition(this.localPaused||this.peerPaused?'paused':'transferring');return;
"""
s=replace_once(s,old_finish,new_finish,'checkpoint final verification')

old_finalize="""  async finalizeBlock(block,epoch){
    if(block.finalizing)return block.finalizing;
    if(!block.endSeen||block.received!==block.data.length)return;
    block.finalizing=(async()=>{
      const digest=await blockHash(block.data);this.guard(epoch);
      if(digest!==block.hash){if(this.block===block)this.block=null;this.send('block-nack',{file:block.file,block:block.index});return;}
      await this.storage.write(block.file,block.index,block.data);this.guard(epoch);
      const state=this.record.files[block.file];state.hashes[block.index]=digest;state.next=block.index+1;this.record.updated=Date.now();await this.store.put(this.record);this.guard(epoch);
      if(this.block===block)this.block=null;this.send('block-ack',{file:block.file,block:block.index,hash:digest});this.emit();
    })();
    return block.finalizing;
  }
  receiveBinary(raw,epoch=this.epoch) {
    const frame=decodeChunk(raw,this.id),block=this.block;
    if(!block||frame.file!==block.file||frame.block!==block.index)throw Error('Unexpected file data.');
    const start=frame.offset,end=start+frame.bytes.length;
    if(start<0||end>block.data.length||!frame.bytes.length)throw Error('File frame is outside its block.');
    for(const [left,right] of block.ranges)if(start<right&&end>left)throw Error('Duplicate or overlapping file frame.');
    block.data.set(frame.bytes,start);block.ranges.push([start,end]);block.received+=frame.bytes.length;
    if(block.endSeen&&block.received===block.data.length&&!block.finalizing)this.trackTask(this.finalizeBlock(block,epoch).catch(e=>this.handleError(e)));
  }
"""
new_finalize="""  async finalizeBlock(block,epoch){
    if(block.finalizing)return block.finalizing;
    if(!block.endSeen||block.received!==block.data.length)return;
    block.finalizing=(async()=>{
      const key=`${block.file}:${block.index}`,digest=await blockHash(block.data);this.guard(epoch);
      if(digest!==block.hash){this.blocks.delete(key);this.send('block-nack',{file:block.file,block:block.index});return;}
      await this.storage.write(block.file,block.index,block.data);this.guard(epoch);this.completedData.set(key,block.data);
      const commit=this.commitQueue.catch(()=>{}).then(async()=>{
        const state=this.record.files[block.file];state.hashes[block.index]=digest;
        let hasher=this.receiveHashes.get(block.file);if(!hasher){hasher=new Integrity(state.checkpoint);this.receiveHashes.set(block.file,hasher);}
        while(this.completedData.has(`${block.file}:${state.next}`)){
          const nextKey=`${block.file}:${state.next}`,bytes=this.completedData.get(nextKey);state.checkpoint=await hasher.update(bytes);this.completedData.delete(nextKey);state.next++;
        }
        this.record.updated=Date.now();await this.store.put(this.record);this.guard(epoch);
      });this.commitQueue=commit;await commit;this.blocks.delete(key);this.send('block-ack',{file:block.file,block:block.index,hash:digest});this.emit();
    })();
    return block.finalizing;
  }
  receiveBinary(raw,epoch=this.epoch) {
    const frame=decodeChunk(raw,this.id),key=`${frame.file}:${frame.block}`,block=this.blocks.get(key);
    if(!block)throw Error('Unexpected file data.');
    const start=frame.offset,end=start+frame.bytes.length;
    if(start<0||end>block.data.length||!frame.bytes.length)throw Error('File frame is outside its block.');
    const first=Math.floor(start/RANGE_BUCKET),last=Math.floor((end-1)/RANGE_BUCKET);
    for(let bucket=first;bucket<=last;bucket++)for(const [left,right] of block.buckets.get(bucket)||[])if(start<right&&end>left)throw Error('Duplicate or overlapping file frame.');
    block.data.set(frame.bytes,start);for(let bucket=first;bucket<=last;bucket++){const ranges=block.buckets.get(bucket)||[];ranges.push([start,end]);block.buckets.set(bucket,ranges);}block.received+=frame.bytes.length;
    if(block.endSeen&&block.received===block.data.length&&!block.finalizing)this.trackTask(this.finalizeBlock(block,epoch).catch(e=>this.handleError(e)));
  }
"""
s=replace_once(s,old_finalize,new_finalize,'parallel receiver assembly')

s=s.replace("this.epoch++;this.block=null;\n    this.rejectWaiters", "this.epoch++;this.blocks.clear();this.completedData.clear();for(const hash of this.receiveHashes.values())hash.close();this.receiveHashes.clear();\n    this.rejectWaiters")
s=s.replace("this.epoch++;this.block=null;this.rejectWaiters", "this.epoch++;this.blocks.clear();this.completedData.clear();for(const hash of this.receiveHashes.values())hash.close();this.receiveHashes.clear();this.rejectWaiters")

# new receives use packed storage layout
s=replace_once(s,
"created:Date.now(),state:'transferring',storage:destination.storage,directory:destination.directory};",
"created:Date.now(),state:'transferring',storage:destination.storage,directory:destination.directory,layout:'packed-v1'};",
'packed receive layout')
save(p,s)

# ---------------- storage.js ----------------
p='src/storage.js';s=load(p)
s=replace_once(s,
"  return {opfs:!!navigator.storage?.getDirectory,indexedDB:typeof indexedDB!=='undefined',directory:typeof window.showDirectoryPicker==='function',available,enough:available===null||available>bytes*2+16*1024*1024};",
"  const reserve=Math.max(64*1024*1024,Math.ceil(bytes*0.1));\n  return {opfs:!!navigator.storage?.getDirectory,indexedDB:typeof indexedDB!=='undefined',directory:typeof window.showDirectoryPicker==='function',available,enough:available===null||available>bytes+reserve};",
'packed quota estimate')

old_storage="""  async write(file,block,bytes) {
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
"""
new_storage="""  async write(file,block,bytes) {
    if(this.staging&&this.record.layout==='packed-v1'){
      const h=await this.staging.getFileHandle(`f${file}.part`,{create:true}),w=await h.createWritable({keepExistingData:true});
      try{await w.write({type:'write',position:block*BLOCK_SIZE,data:bytes});await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}
    }else if(this.staging){const h=await this.staging.getFileHandle(`f${file}-b${block}.part`,{create:true});const w=await h.createWritable();try{await w.write(bytes);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
    else await transact('blocks',s=>s.put({id:this.key(file,block),data:new Blob([bytes])}),true);
  }
  async read(file,block) {
    if(this.staging&&this.record.layout==='packed-v1'){
      const blob=await (await this.staging.getFileHandle(`f${file}.part`)).getFile(),start=block*BLOCK_SIZE,end=Math.min(blob.size,start+BLOCK_SIZE);if(end<=start)throw Error('A temporary transfer block is missing. Retry the transfer.');return blob.slice(start,end).arrayBuffer();
    }
    if(this.staging)return (await (await this.staging.getFileHandle(`f${file}-b${block}.part`)).getFile()).arrayBuffer();
    const item=await transact('blocks',s=>s.get(this.key(file,block)));if(!item)throw Error('A temporary transfer block is missing. Retry the transfer.');return item.data.arrayBuffer();
  }
  async removeBlock(file,block) {
    if(this.staging&&this.record.layout==='packed-v1')return;
    if(this.staging)await this.staging.removeEntry(`f${file}-b${block}.part`).catch(()=>{});
    else await transact('blocks',s=>s.delete(this.key(file,block)),true);
  }
"""
s=replace_once(s,old_storage,new_storage,'packed block storage')

marker="""  async finalize(file,state,digest,onProgress=()=>{},isCancelled=()=>false) {
"""
method="""  async finalizeVerified(file,state,digest,onProgress=()=>{},isCancelled=()=>false) {
    const meta=this.record.manifest[file];let output,writer;const fallback=[];
    try {
      if(this.record.storage==='directory') {
        let dir=this.root;const parts=cleanPath(meta.path||meta.name).split('/');for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});
        output=await uniqueFile(dir,parts.at(-1));writer=await output.handle.createWritable();
      }else if(this.staging&&this.record.layout==='packed-v1'){
        output={name:meta.name,handle:await this.staging.getFileHandle(`f${file}.part`)};const blob=await output.handle.getFile();if(blob.size!==meta.size)throw Error('The received file size does not match. Retry the transfer.');onProgress(meta.size);
      }else if(this.staging){output={name:meta.name,handle:await this.staging.getFileHandle(`verified-${file}`,{create:true})};writer=await output.handle.createWritable();}
      else if(meta.size>256*1024*1024)throw Error('This browser needs a download folder or OPFS for large files.');
      if(writer||!output){for(let b=0;b<state.next;b++){if(isCancelled())throw Error('Verification cancelled.');const bytes=await this.read(file,b);if(writer)await writer.write(bytes);else fallback.push(bytes);onProgress(Math.min(meta.size,(b+1)*BLOCK_SIZE));}}
      if(isCancelled())throw Error('Verification cancelled.');if(writer)await writer.close();if(isCancelled())throw Error('Verification cancelled before completion was acknowledged.');
      state.digest=digest;state.complete=true;state.outputName=output?.name;state.outputHandle=output?.handle;await records.put(this.record);
      return this.record.storage==='directory'?{savedName:output.name}:{blob:output?await output.handle.getFile():new Blob(fallback,{type:'application/octet-stream'})};
    }catch(e){await writer?.abort().catch(()=>{});throw e;}
  }
  async finalize(file,state,digest,onProgress=()=>{},isCancelled=()=>false) {
"""
s=replace_once(s,marker,method,'finalize verified fast path')
save(p,s)

# ---------------- protocol metadata kinds ----------------
for p in ['src/main-peer.js','src/room.js','src/app.js']:
    s=load(p).replace("file-v4","file-v5")
    save(p,s)

# ---------------- tests ----------------
p='tests/block-transfer.test.mjs';s=load(p)
s=s.replace("assert.equal(receiver.block,null);","assert.equal(receiver.blocks.size,0);")
old_test="""test('receiver assembles non-overlapping frames that arrive out of order',()=>{
  const[a,b]=pair(),store=new Store(),Storage=storageClass(),receiver=new BlockTransfer(b,{store,Storage});
  const id=crypto.randomUUID();receiver.id=id;receiver.block={file:0,index:0,hash:'0'.repeat(64),data:new Uint8Array(6),received:0,ranges:[],endSeen:false,finalizing:null};
  receiver.receiveBinary(encodeChunk(id,0,0,3,new Uint8Array([4,5,6]).buffer));
  receiver.receiveBinary(encodeChunk(id,0,0,0,new Uint8Array([1,2,3]).buffer));
  assert.deepEqual([...receiver.block.data],[1,2,3,4,5,6]);assert.equal(receiver.block.received,6);
  clearInterval(receiver.heartbeat);a.close();
});
"""
new_test="""test('receiver assembles non-overlapping frames that arrive out of order',()=>{
  const[a,b]=pair(),store=new Store(),Storage=storageClass(),receiver=new BlockTransfer(b,{store,Storage});
  const id=crypto.randomUUID(),block={file:0,index:0,hash:'0'.repeat(64),data:new Uint8Array(6),received:0,buckets:new Map(),endSeen:false,finalizing:null};receiver.id=id;receiver.blocks.set('0:0',block);
  receiver.receiveBinary(encodeChunk(id,0,0,3,new Uint8Array([4,5,6]).buffer));
  receiver.receiveBinary(encodeChunk(id,0,0,0,new Uint8Array([1,2,3]).buffer));
  assert.deepEqual([...block.data],[1,2,3,4,5,6]);assert.equal(block.received,6);
  clearInterval(receiver.heartbeat);a.close();
});

test('sliding window keeps multiple durable blocks in flight before earlier ACKs',async()=>{
  let outstanding=0,maxOutstanding=0;const[a,b]=pair(raw=>{if(typeof raw==='string'){const m=JSON.parse(raw);if(m.type==='block-start'){outstanding++;maxOutstanding=Math.max(maxOutstanding,outstanding);}if(m.type==='block-ack')outstanding=Math.max(0,outstanding-1);}return raw;});
  const store=new Store(),Storage=storageClass(),receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});
  const sender=new BlockTransfer(a,{store,files:[makeFile(BLOCK_SIZE*4+777)]});await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.ok(maxOutstanding>=2,`expected pipelined blocks, saw ${maxOutstanding}`);
});
"""
s=replace_once(s,old_test,new_test,'window tests')
save(p,s)

# ---------------- release metadata ----------------
for p in ['package.json','package-lock.json','README.md','index.html']:
    s=load(p).replace('4.12.0','4.13.0');save(p,s)
p='sw.js';s=load(p).replace("wft-shell-v24","wft-shell-v25").replace('app.css?v=4.11.0','app.css?v=4.13.0').replace('app.js?v=4.11.0','app.js?v=4.13.0');save(p,s)

save('docs/validation-4.13.md',"""# v4.13.0 validation\n\n## Performance architecture\n\n- Protocol v5 keeps up to four 8 MiB blocks in flight instead of stop-and-wait per block.\n- Block acknowledgements are matched by file/block so out-of-order ACKs cannot complete the wrong request.\n- Receiver accepts a bounded six-block horizon and assembles frames with 64 KiB range buckets rather than scanning every prior range.\n- Transport plans refresh after SCTP opens, so an early 16 KiB fallback does not permanently cap frame size.\n- New OPFS/directory staging uses one packed file per source file with positioned writes; legacy saved transfers retain the old block-file layout.\n- Receiver maintains an incremental whole-file SHA-256 checkpoint from verified durable blocks. New packed transfers can verify the final digest without rereading and rehashing the entire file.\n- Packed OPFS downloads expose the already-verified staging file instead of rewriting a second complete copy.\n- Multi-lane WebRTC, pause/resume, cancellation, per-block SHA-256, NACK retry, reconnect from verified progress, and final whole-file integrity remain enabled.\n\n## Required validation\n\nThe release workflow runs `npm ci`, the full Node test suite, `npm run build`, and `node --check assets/app.js`. It also adds a regression proving that multiple blocks are simultaneously in flight and keeps the existing corruption, interruption, pause, quota, multi-lane, and out-of-order tests.\n""")
print('v4.13 sliding-window patch applied')
