from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def load(path):
    return (ROOT/path).read_text()

def save(path,text):
    (ROOT/path).write_text(text)

def replace_once(text,old,new,label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old,new,1)

# --- block-transfer.js: protocol v4 + striped independent PeerConnections ---
p='src/block-transfer.js'
s=load(p)
s=replace_once(s,
"const VERSION=3,HEADER=36,MAX_FRAME=1024*1024,MAX_CONTROL=48*1024;\nconst MIN_SEND_BUFFER=8*1024*1024,MAX_SEND_BUFFER=32*1024*1024;",
"const VERSION=4,HEADER=36,MAX_FRAME=1024*1024,MAX_CONTROL=48*1024;\nconst MIN_SEND_BUFFER=8*1024*1024,MAX_SEND_BUFFER=32*1024*1024;\nconst MAX_LANES=4,PARALLEL_THRESHOLD=16*1024*1024;",
'protocol constants')

s=replace_once(s,
"    this.localPaused=false;this.peerPaused=false;this.lastActivity=Date.now();this.lastUI=0;this.samples=[];this.bytes=0;this.total=0;\n    this.attach(conn);",
"    this.localPaused=false;this.peerPaused=false;this.lastActivity=Date.now();this.lastUI=0;this.samples=[];this.bytes=0;this.total=0;\n    this.lanes=new Map();this.lanePlans=new Map();\n    this.attach(conn);",
'constructor lanes')

s=replace_once(s,
"    const old=this.conn,previousQueue=this.queue;this.epoch++;const epoch=this.epoch;this.conn=conn;this.queue=previousQueue?.catch(()=>{})||Promise.resolve();this.queuedBytes=0;this.block=null;this.helloSeen=false;this.transport=transportPlan(conn);\n    if(old&&old!==conn)old.close();this.rejectWaiters(new Interrupted('Reconnecting'));",
"    const old=this.conn,previousQueue=this.queue,oldLanes=[...(this.lanes?.values()||[])];this.epoch++;const epoch=this.epoch;this.conn=conn;this.queue=previousQueue?.catch(()=>{})||Promise.resolve();this.queuedBytes=0;this.block=null;this.helloSeen=false;this.transport=transportPlan(conn);\n    this.lanes=new Map([[0,conn]]);this.lanePlans=new Map([[0,this.transport]]);\n    for(const lane of oldLanes)if(lane!==old&&lane!==conn)lane.close();\n    if(old&&old!==conn)old.close();this.rejectWaiters(new Interrupted('Reconnecting'));",
'attach lane reset')

s=s.replace("if(this.queuedBytes>BLOCK_SIZE+MAX_SEND_BUFFER)throw Error('Peer sent too much data without acknowledgement.');",
            "if(this.queuedBytes>BLOCK_SIZE+MAX_SEND_BUFFER*MAX_LANES)throw Error('Peer sent too much data without acknowledgement.');")

marker="  trackTask(promise){this.tasks.add(promise);promise.then(()=>this.tasks.delete(promise),()=>this.tasks.delete(promise));return promise;}\n"
insert="""  trackTask(promise){this.tasks.add(promise);promise.then(()=>this.tasks.delete(promise),()=>this.tasks.delete(promise));return promise;}\n  planFor(conn){\n    for(const [index,lane] of this.lanes)if(lane===conn)return this.lanePlans.get(index)||transportPlan(conn);\n    return transportPlan(conn);\n  }\n  addLane(conn,index,epoch=this.epoch){\n    if(!conn||!Number.isInteger(index)||index<=0||index>=MAX_LANES){conn?.close?.();return false;}\n    const previous=this.lanes.get(index);if(previous&&previous!==conn)previous.close();\n    this.lanes.set(index,conn);this.lanePlans.set(index,transportPlan(conn));\n    conn.on('data',raw=>{\n      if(epoch!==this.epoch||this.terminal()||this.lanes.get(index)!==conn)return;\n      this.lastActivity=Date.now();\n      if(typeof raw==='string'){conn.close();return;}\n      const size=raw.byteLength||raw.size||0;this.queuedBytes+=size;\n      if(this.queuedBytes>BLOCK_SIZE+MAX_SEND_BUFFER*MAX_LANES){this.handleError(Error('Peer sent too much parallel data without acknowledgement.'));conn.close();return;}\n      const prior=conn._wftQueue||Promise.resolve();\n      conn._wftQueue=prior.then(async()=>{try{this.guard(epoch);const data=raw instanceof Blob?await raw.arrayBuffer():raw;this.guard(epoch);this.receiveBinary(data,epoch);}finally{if(epoch===this.epoch)this.queuedBytes-=size;}}).catch(e=>this.handleError(e));\n    });\n    const lost=()=>{\n      if(this.lanes.get(index)!==conn)return;\n      this.lanes.delete(index);this.lanePlans.delete(index);\n      // A lane disappearing with an incomplete block can strand bytes that were\n      // already queued on that SCTP association. Force the normal verified-block\n      // reconnect path instead of guessing which ranges arrived.\n      if(this.block&&!this.terminal())this.conn?.close();\n    };\n    conn.on('close',lost);conn.on('error',()=>{conn.close();lost();});\n    return true;\n  }\n  async openTurboLanes(epoch){\n    if(!this.options.openLane||this.total<PARALLEL_THRESHOLD)return;\n    const desired=Math.min(MAX_LANES,Math.max(2,Number(this.options.laneCount)||3));\n    for(let index=1;index<desired;index++){\n      this.guard(epoch);\n      try{this.addLane(this.options.openLane(index),index,epoch);}catch{}\n    }\n    // Let PeerJS start the extra ICE/SCTP handshakes without delaying the transfer.\n    await Promise.resolve();this.guard(epoch);\n  }\n  pickLane(){\n    let best={index:0,conn:this.conn,plan:this.transport||transportPlan(this.conn),score:Infinity};\n    for(const [index,conn] of this.lanes){\n      if(!conn?.open)continue;const plan=this.lanePlans.get(index)||transportPlan(conn),dc=conn.dataChannel;\n      const score=(dc?.bufferedAmount||0)/Math.max(1,plan.high);\n      if(score<best.score)best={index,conn,plan,score};\n    }\n    return best;\n  }\n"""
s=replace_once(s,marker,insert,'lane methods')

s=replace_once(s,
"  async writable(epoch) {\n    for(;;) {\n      while(this.localPaused||this.peerPaused){this.guard(epoch);await new Promise(r=>setTimeout(r,100));}\n      this.guard(epoch);const dc=this.conn.dataChannel,{high,low:lowWater}=this.transport||transportPlan(this.conn);",
"  async writable(epoch,conn=this.conn) {\n    for(;;) {\n      while(this.localPaused||this.peerPaused){this.guard(epoch);await new Promise(r=>setTimeout(r,100));}\n      this.guard(epoch);const dc=conn?.dataChannel,{high,low:lowWater}=this.planFor(conn);",
'writable per lane')

s=replace_once(s,
"    this.peerPaused=!!accepted.paused;this.transition(this.localPaused||this.peerPaused?'paused':'transferring');\n    const transport=this.transport?.payload||transportPlan(this.conn).payload;",
"    this.peerPaused=!!accepted.paused;this.transition(this.localPaused||this.peerPaused?'paused':'transferring');\n    await this.openTurboLanes(epoch);",
'open turbo lanes')

old_send="""        let pendingRead=state.next<count?file.slice(state.next*BLOCK_SIZE,Math.min(file.size,(state.next+1)*BLOCK_SIZE)).arrayBuffer():null;\n        for(let b=state.next;b<count;b++) {\n          await this.writable(epoch);\n          const bytes=await pendingRead;this.guard(epoch);\n          pendingRead=b+1<count?file.slice((b+1)*BLOCK_SIZE,Math.min(file.size,(b+2)*BLOCK_SIZE)).arrayBuffer():null;\n          const checkpoint=hash.update(bytes);checkpoint.catch(()=>{});\n          const digest=await blockHash(bytes);this.guard(epoch);let attempts=0,ack;\n          do {\n            await this.writable(epoch);\n            await this.request('block-start',{file:f,block:b,size:bytes.byteLength,hash:digest},'ready',epoch);\n            for(let offset=0;offset<bytes.byteLength;offset+=transport) {\n              if(this.localPaused||this.peerPaused||(this.conn.dataChannel?.bufferedAmount||0)>=(this.transport?.high||MIN_SEND_BUFFER))await this.writable(epoch);\n              this.guard(epoch);this.conn.send(encodeChunk(this.id,f,b,offset,new Uint8Array(bytes,offset,Math.min(transport,bytes.byteLength-offset))));\n            }\n            ack=await this.request('block-end',{file:f,block:b},['block-ack','block-nack'],epoch);\n            if(ack.file!==f||ack.block!==b)throw Error('Acknowledgement belongs to another block.');\n          }while(ack.type==='block-nack'&&++attempts<3);\n"""
new_send="""        const prepareBlock=b=>b<count?(async()=>{\n          const bytes=await file.slice(b*BLOCK_SIZE,Math.min(file.size,(b+1)*BLOCK_SIZE)).arrayBuffer();\n          return {bytes,digest:await blockHash(bytes)};\n        })():null;\n        let pendingBlock=prepareBlock(state.next);\n        for(let b=state.next;b<count;b++) {\n          await this.writable(epoch);\n          const prepared=await pendingBlock;this.guard(epoch);\n          pendingBlock=prepareBlock(b+1);\n          const bytes=prepared.bytes,digest=prepared.digest,checkpoint=hash.update(bytes);checkpoint.catch(()=>{});\n          let attempts=0,ack;\n          do {\n            await this.writable(epoch);\n            await this.request('block-start',{file:f,block:b,size:bytes.byteLength,hash:digest},'ready',epoch);\n            for(let offset=0;offset<bytes.byteLength;) {\n              const selected=this.pickLane();\n              await this.writable(epoch,selected.conn);this.guard(epoch);\n              const length=Math.min(selected.plan.payload,bytes.byteLength-offset);\n              try{selected.conn.send(encodeChunk(this.id,f,b,offset,new Uint8Array(bytes,offset,length)));}\n              catch(error){if(selected.index){this.lanes.delete(selected.index);this.lanePlans.delete(selected.index);continue;}throw error;}\n              offset+=length;\n            }\n            ack=await this.request('block-end',{file:f,block:b},['block-ack','block-nack'],epoch);\n            if(ack.file!==f||ack.block!==b)throw Error('Acknowledgement belongs to another block.');\n          }while(ack.type==='block-nack'&&++attempts<3);\n"""
s=replace_once(s,old_send,new_send,'striped send loop')

s=replace_once(s,
"      this.block={file:m.file,index:m.block,hash:m.hash,data:new Uint8Array(m.size),received:0};this.send('ready',{file:m.file,block:m.block});return;",
"      this.block={file:m.file,index:m.block,hash:m.hash,data:new Uint8Array(m.size),received:0,ranges:[],endSeen:false,finalizing:null};this.send('ready',{file:m.file,block:m.block});return;",
'block-start ranges')

old_end="""    if(m.type==='block-end') {\n      const block=this.block;if(!block||m.file!==block.file||m.block!==block.index||block.received!==block.data.length)throw Error('Incomplete file block.');\n      this.block=null;const digest=await blockHash(block.data);this.guard(epoch);\n      if(digest!==block.hash){this.send('block-nack',{file:m.file,block:m.block});return;}\n      await this.storage.write(m.file,m.block,block.data);this.guard(epoch);\n      const state=this.record.files[m.file];state.hashes[m.block]=digest;state.next=m.block+1;this.record.updated=Date.now();await this.store.put(this.record);this.guard(epoch);\n      this.send('block-ack',{file:m.file,block:m.block,hash:digest});this.emit();return;\n    }\n"""
new_end="""    if(m.type==='block-end') {\n      const block=this.block;if(!block||m.file!==block.file||m.block!==block.index)throw Error('Unexpected file block end.');\n      block.endSeen=true;\n      if(block.received===block.data.length)await this.finalizeBlock(block,epoch);\n      return;\n    }\n"""
s=replace_once(s,old_end,new_end,'deferred block end')

old_receive="""  receiveBinary(raw) {\n    const frame=decodeChunk(raw,this.id),block=this.block;\n    if(!block||frame.file!==block.file||frame.block!==block.index||frame.offset!==block.received||frame.offset+frame.bytes.length>block.data.length)throw Error('Out-of-order or unexpected file data.');\n    block.data.set(frame.bytes,frame.offset);block.received+=frame.bytes.length;\n  }\n"""
new_receive="""  async finalizeBlock(block,epoch){\n    if(block.finalizing)return block.finalizing;\n    if(!block.endSeen||block.received!==block.data.length)return;\n    block.finalizing=(async()=>{\n      const digest=await blockHash(block.data);this.guard(epoch);\n      if(digest!==block.hash){if(this.block===block)this.block=null;this.send('block-nack',{file:block.file,block:block.index});return;}\n      await this.storage.write(block.file,block.index,block.data);this.guard(epoch);\n      const state=this.record.files[block.file];state.hashes[block.index]=digest;state.next=block.index+1;this.record.updated=Date.now();await this.store.put(this.record);this.guard(epoch);\n      if(this.block===block)this.block=null;this.send('block-ack',{file:block.file,block:block.index,hash:digest});this.emit();\n    })();\n    return block.finalizing;\n  }\n  receiveBinary(raw,epoch=this.epoch) {\n    const frame=decodeChunk(raw,this.id),block=this.block;\n    if(!block||frame.file!==block.file||frame.block!==block.index)throw Error('Unexpected file data.');\n    const start=frame.offset,end=start+frame.bytes.length;\n    if(start<0||end>block.data.length||!frame.bytes.length)throw Error('File frame is outside its block.');\n    for(const [left,right] of block.ranges)if(start<right&&end>left)throw Error('Duplicate or overlapping file frame.');\n    block.data.set(frame.bytes,start);block.ranges.push([start,end]);block.received+=frame.bytes.length;\n    if(block.endSeen&&block.received===block.data.length&&!block.finalizing)this.trackTask(this.finalizeBlock(block,epoch).catch(e=>this.handleError(e)));\n  }\n"""
s=replace_once(s,old_receive,new_receive,'out-of-order receive')

s=replace_once(s,
"    if(this.terminal()||this.state==='reconnecting')return;\n    this.epoch++;this.block=null;",
"    if(this.terminal()||this.state==='reconnecting')return;\n    for(const [index,lane] of this.lanes||[])if(index)lane.close();\n    this.epoch++;this.block=null;",
'interrupt lanes')

s=s.replace("setTimeout(()=>this.conn.close(),500);","setTimeout(()=>{for(const lane of this.lanes.values())lane.close();},500);")
s=s.replace("this.emit(true);conn?.close();","this.emit(true);for(const lane of this.lanes.values())lane.close();")
s=s.replace("if(state!=='cancelled'||!notify){const conn=this.conn;setTimeout(()=>conn.close(),state==='cancelled'?5000:1000);}",
            "if(state!=='cancelled'||!notify){const lanes=[...this.lanes.values()];setTimeout(()=>{for(const lane of lanes)lane.close();},state==='cancelled'?5000:1000);}")
save(p,s)

# --- Main Peer: authorize and create extra independent transfer PeerConnections ---
p='src/main-peer.js';s=load(p)
s=replace_once(s,
"  if(meta.kind!=='file-v3'){conn.on('open',()=>conn.close());return;}\n  this.onIncoming(conn,member);",
"  if(!['file-v3','file-v4'].includes(meta.kind)){conn.on('open',()=>conn.close());return;}\n  this.onIncoming(conn,{...member,lane:Number.isInteger(meta.lane)?meta.lane:0});",
'main incoming v4')
s=replace_once(s,
"  return peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v3',transferId,deviceId:this.uuid,name:this.name.slice(0,48)}});\n }\n requestConnection",
"  return peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v4',transferId,lane:0,deviceId:this.uuid,name:this.name.slice(0,48)}});\n }\n connectLane(remoteId,transferId,lane){\n  const peer=shared.peer||this.peer,id=safe(remoteId);\n  if(!peer||peer.disconnected)throw Error('Main peer is not ready in this tab.');\n  if(!id||id===peer.id||!Number.isInteger(lane)||lane<=0||lane>=4)throw Error('Invalid parallel transfer lane.');\n  if(![...this.authorized.values()].some(member=>member.id===id))throw Error('Connect to this device and wait for approval first.');\n  return peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v4',transferId,lane,deviceId:this.uuid,name:this.name.slice(0,48)}});\n }\n requestConnection",
'main connectLane')
save(p,s)

# --- Room: same capability for QR and remembered/private-room paths ---
p='src/room.js';s=load(p)
s=replace_once(s,
"    if (['file-v2','file-v3'].includes(conn.metadata?.kind) && member) this.cb.onTransfer?.(conn,member);",
"    if (['file-v2','file-v3','file-v4'].includes(conn.metadata?.kind) && member) this.cb.onTransfer?.(conn,member);",
'room incoming v4')
s=replace_once(s,
"    return this.peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:transferId?'file-v3':'file-v2',transferId}});\n  }\n  probe(id,timeout=20000){",
"    return this.peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:transferId?'file-v4':'file-v2',transferId,lane:0}});\n  }\n  connectLane(id,transferId,lane){\n    if(this.closed||this.state!=='connected'||this.peer.disconnected||!this.members.has(id))throw Error('Device is no longer connected.');\n    if(!transferId||!Number.isInteger(lane)||lane<=0||lane>=4)throw Error('Invalid parallel transfer lane.');\n    return this.peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v4',transferId,lane}});\n  }\n  probe(id,timeout=20000){",
'room connectLane')
save(p,s)

# --- App: expose lane factory and attach secondary lanes to the current receive transfer ---
p='src/app.js';s=load(p)
s=replace_once(s,
"const directoryRoom={cancelTransfer:(peer,id)=>mainPeer.cancelTransfer(peer,id),connect:(id,transferId)=>mainPeer.connect(id,transferId),probe:(id,timeout)=>mainPeer.probe(id,timeout)};",
"const directoryRoom={cancelTransfer:(peer,id)=>mainPeer.cancelTransfer(peer,id),connect:(id,transferId)=>mainPeer.connect(id,transferId),connectLane:(id,transferId,lane)=>mainPeer.connectLane(id,transferId,lane),probe:(id,timeout)=>mainPeer.probe(id,timeout)};",
'directory lane')
s=replace_once(s,
" const t=new BlockTransfer(conn,{files:outgoing?[...batch]:undefined,record,id:row.id,senderId:outgoing?deviceId:member.deviceId,receiverId:outgoing?member.deviceId:deviceId,reselected:!!record,requireDirectory:false,\n onCancel:id=>notifyCancellation(id,member),",
" const t=new BlockTransfer(conn,{files:outgoing?[...batch]:undefined,record,id:row.id,senderId:outgoing?deviceId:member.deviceId,receiverId:outgoing?member.deviceId:deviceId,reselected:!!record,requireDirectory:false,\n openLane:outgoing&&member.room.connectLane?lane=>member.room.connectLane(member.id,row.id,lane):undefined,laneCount:3,\n onCancel:id=>notifyCancellation(id,member),",
'app block transfer options')
old_incoming="""function incoming(conn,member){\n if(conn.metadata?.kind!=='file-v3'){conn.close();return;}\n if(cancelledTransfers.has(conn.metadata.transferId)){conn.close();return;}\n const existing=transfers.get(conn.metadata.transferId);\n if(existing){\n  if(existing.transfer.direction==='receive'&&existing.member.deviceId===member.deviceId)existing.transfer.attach(conn);else conn.close();\n  return;\n }\n track(conn,member,false);\n}\n"""
new_incoming="""function incoming(conn,member){\n if(!['file-v3','file-v4'].includes(conn.metadata?.kind)){conn.close();return;}\n if(cancelledTransfers.has(conn.metadata.transferId)){conn.close();return;}\n const lane=Number.isInteger(conn.metadata?.lane)?conn.metadata.lane:0;\n const existing=transfers.get(conn.metadata.transferId);\n if(existing){\n  if(existing.transfer.direction==='receive'&&existing.member.deviceId===member.deviceId){if(lane>0)existing.transfer.addLane(conn,lane);else existing.transfer.attach(conn);}else conn.close();\n  return;\n }\n // Turbo lanes are opened only after the primary transfer has been accepted, so\n // an orphaned secondary lane is never allowed to create a transfer by itself.\n if(lane>0){conn.close();return;}\n track(conn,member,false);\n}\n"""
s=replace_once(s,old_incoming,new_incoming,'app incoming lanes')
save(p,s)

# --- Regression tests for multi-lane striping and out-of-order receive assembly ---
p='tests/block-transfer.test.mjs';s=load(p)
append="""\n\ntest('parallel transfer lanes stripe a large file across independent connections',async()=>{\n  let primaryFrames=0,laneFrames=0;\n  const[a,b]=pair(raw=>{if(raw instanceof ArrayBuffer)primaryFrames++;return raw;});\n  const store=new Store(),Storage=storageClass();\n  const receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});\n  const sender=new BlockTransfer(a,{store,Storage,files:[makeFile(BLOCK_SIZE*2+12345)],laneCount:3,openLane:index=>{\n    const[out,inc]=pair(raw=>{if(raw instanceof ArrayBuffer)laneFrames++;return raw;});receiver.addLane(inc,index);return out;\n  }});\n  await until(()=>sender.terminal());\n  assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');\n  assert.ok(primaryFrames>0,'primary lane should carry file frames');assert.ok(laneFrames>0,'extra PeerConnections should carry file frames');\n});\n\ntest('receiver assembles non-overlapping frames that arrive out of order',()=>{\n  const[a,b]=pair(),store=new Store(),Storage=storageClass(),receiver=new BlockTransfer(b,{store,Storage});\n  const id=crypto.randomUUID();receiver.id=id;receiver.block={file:0,index:0,hash:'0'.repeat(64),data:new Uint8Array(6),received:0,ranges:[],endSeen:false,finalizing:null};\n  receiver.receiveBinary(encodeChunk(id,0,0,3,new Uint8Array([4,5,6]).buffer));\n  receiver.receiveBinary(encodeChunk(id,0,0,0,new Uint8Array([1,2,3]).buffer));\n  assert.deepEqual([...receiver.block.data],[1,2,3,4,5,6]);assert.equal(receiver.block.received,6);\n  clearInterval(receiver.heartbeat);a.close();\n});\n"""
if "parallel transfer lanes stripe a large file" not in s:s+=append
save(p,s)

# --- Version/cache/docs ---
for p in ['package.json','package-lock.json','README.md','index.html']:
    s=load(p).replace('4.11.0','4.12.0')
    save(p,s)
p='sw.js';s=load(p).replace('wft-shell-v23','wft-shell-v24');save(p,s)

validation=ROOT/'docs/validation-4.12.md'
validation.write_text("""# Validation 4.12\n\n## Scope\n\nVersion 4.12 adds an optional multi-lane WebRTC fast path for large transfers without adding runtime dependencies. The existing primary PeerJS DataConnection remains the control lane. Files of at least 16 MiB may open two additional independent PeerConnections (three total lanes by default). Binary frames are assigned to the currently least-buffered open lane.\n\nThe receiver now accepts non-overlapping frame ranges arriving out of order across those independent SCTP associations. `block-end` may arrive before the final secondary-lane frame; block verification is deferred until every byte in the block has arrived. SHA-256 verification, durable 8 MiB block checkpoints, block ACK/NACK retry, pause/resume, cancellation, and verified-block reconnect behavior remain mandatory.\n\nIf a secondary lane fails while a receive block is incomplete, the primary connection is closed deliberately so the existing reconnect logic resumes from the last verified block rather than guessing whether queued secondary-lane bytes arrived. Small transfers stay on one connection to avoid setup overhead.\n\n## Performance work\n\n- Up to 3 independent PeerConnections by default for large files (hard maximum 4).\n- Least-buffered-lane scheduling using each lane's negotiated SCTP `maxMessageSize` and adaptive buffer plan.\n- Next-block disk read and SHA-256 block digest preparation overlap the current block's network transmission.\n- Out-of-order, overlap-protected receiver assembly for striped frames.\n- No external service or runtime dependency added.\n\n## Safety expectations\n\nThe multi-lane path is an optimization, not a fixed speed multiplier. Multiple connections still share the same physical Wi-Fi/Internet link and may be slower on constrained devices. The code therefore keeps the normal single primary lane, uses only a small bounded lane count, and preserves the previous resumable integrity protocol.\n\n## Automated checks\n\nThe release workflow runs `npm ci`, the complete Node test suite, `npm run build`, and `node --check assets/app.js`. New regression tests verify that a large transfer actually uses secondary lanes and that the receiver correctly assembles non-overlapping frames received out of order.\n""")

print('v4.12 multi-lane patch applied')
