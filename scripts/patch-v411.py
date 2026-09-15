from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Patch target not found in {path}: {old[:120]!r}')
    updated = text.replace(old, new, count)
    p.write_text(updated, encoding='utf-8')


def replace_all(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Patch target not found in {path}: {old!r}')
    p.write_text(text.replace(old, new), encoding='utf-8')


# ---- Faster browser-only WebRTC transport ---------------------------------
replace('src/block-transfer.js',
'''const VERSION=3,HEADER=36,MAX_FRAME=64*1024,MAX_CONTROL=48*1024;''',
'''const VERSION=3,HEADER=36,MAX_FRAME=1024*1024,MAX_CONTROL=48*1024;
const MIN_SEND_BUFFER=8*1024*1024,MAX_SEND_BUFFER=32*1024*1024;
export function transportPlan(conn={}) {
  const maxMessage=conn.peerConnection?.sctp?.maxMessageSize;
  const frame=Math.min(MAX_FRAME,Number.isFinite(maxMessage)&&maxMessage>HEADER?maxMessage:16*1024);
  const payload=Math.max(1024,frame-HEADER);
  const high=Math.min(MAX_SEND_BUFFER,Math.max(MIN_SEND_BUFFER,payload*128));
  const low=Math.min(high/2,Math.max(2*1024*1024,payload*32));
  return {payload,high,low};
}''')

replace('src/block-transfer.js',
'''this.conn=conn;this.queue=previousQueue?.catch(()=>{})||Promise.resolve();this.queuedBytes=0;this.block=null;this.helloSeen=false;''',
'''this.conn=conn;this.queue=previousQueue?.catch(()=>{})||Promise.resolve();this.queuedBytes=0;this.block=null;this.helloSeen=false;this.transport=transportPlan(conn);''')

replace('src/block-transfer.js',
'''this.queuedBytes+=size;if(this.queuedBytes>BLOCK_SIZE+2*1024*1024)throw Error('Peer sent too much data without acknowledgement.');''',
'''this.queuedBytes+=size;if(this.queuedBytes>BLOCK_SIZE+MAX_SEND_BUFFER)throw Error('Peer sent too much data without acknowledgement.');''')

replace('src/block-transfer.js',
'''  async writable(epoch) {
    while(this.localPaused||this.peerPaused){this.guard(epoch);await new Promise(r=>setTimeout(r,100));}
    this.guard(epoch);const dc=this.conn.dataChannel;
    if(!dc||dc.bufferedAmount<1024*1024)return;
    dc.bufferedAmountLowThreshold=256*1024;
    await new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);dc.removeEventListener('bufferedamountlow',low);dc.removeEventListener('close',closed);resolve();};
      const low=()=>{if(dc.bufferedAmount<=dc.bufferedAmountLowThreshold)finish();};
      const closed=()=>{finish();reject(new Interrupted('Connection closed'));};
      const timer=setTimeout(finish,1000);dc.addEventListener('bufferedamountlow',low);dc.addEventListener('close',closed);low();
    });
    return this.writable(epoch);
  }''',
'''  async writable(epoch) {
    for(;;) {
      while(this.localPaused||this.peerPaused){this.guard(epoch);await new Promise(r=>setTimeout(r,100));}
      this.guard(epoch);const dc=this.conn.dataChannel,{high,low:lowWater}=this.transport||transportPlan(this.conn);
      if(!dc||dc.bufferedAmount<high)return;
      dc.bufferedAmountLowThreshold=lowWater;
      await new Promise((resolve,reject)=>{
        let settled=false;
        const cleanup=()=>{clearTimeout(timer);dc.removeEventListener('bufferedamountlow',lowEnough);dc.removeEventListener('close',closed);};
        const finish=()=>{if(settled)return;settled=true;cleanup();resolve();};
        const lowEnough=()=>{if(dc.bufferedAmount<=dc.bufferedAmountLowThreshold)finish();};
        const closed=()=>{if(settled)return;settled=true;cleanup();reject(new Interrupted('Connection closed'));};
        const timer=setTimeout(finish,1000);dc.addEventListener('bufferedamountlow',lowEnough);dc.addEventListener('close',closed);lowEnough();
      });
    }
  }''')

replace('src/block-transfer.js',
'''    const maxMessage=this.conn.peerConnection?.sctp?.maxMessageSize;
    const transport=Math.min(MAX_FRAME,Number.isFinite(maxMessage)&&maxMessage>HEADER?maxMessage:16*1024)-HEADER;''',
'''    const transport=this.transport?.payload||transportPlan(this.conn).payload;''')

replace('src/block-transfer.js',
'''        for(let b=state.next;b<count;b++) {
          await this.writable(epoch);
          const bytes=await file.slice(b*BLOCK_SIZE,Math.min(file.size,(b+1)*BLOCK_SIZE)).arrayBuffer();this.guard(epoch);''',
'''        let pendingRead=state.next<count?file.slice(state.next*BLOCK_SIZE,Math.min(file.size,(state.next+1)*BLOCK_SIZE)).arrayBuffer():null;
        for(let b=state.next;b<count;b++) {
          await this.writable(epoch);
          const bytes=await pendingRead;this.guard(epoch);
          pendingRead=b+1<count?file.slice((b+1)*BLOCK_SIZE,Math.min(file.size,(b+2)*BLOCK_SIZE)).arrayBuffer():null;''')

replace('src/block-transfer.js',
'''if(this.localPaused||this.peerPaused||(this.conn.dataChannel?.bufferedAmount||0)>=1024*1024)await this.writable(epoch);''',
'''if(this.localPaused||this.peerPaused||(this.conn.dataChannel?.bufferedAmount||0)>=(this.transport?.high||MIN_SEND_BUFFER))await this.writable(epoch);''')

# ---- Explicit per-device disconnect ---------------------------------------
replace('src/main-peer.js',
'''  conn.on('data',message=>{
    if(message?.type!=='transfer-cancel'||typeof message.id!=='string'||message.id.length>64)return;
    const cancelled=this.onCancel(message.id,member)===true;
    if(conn.open)conn.send({type:'transfer-cancelled',id:message.id,cancelled});
  });''',
'''  conn.on('data',message=>{
    if(message?.type==='disconnect'){conn.close();return;}
    if(message?.type!=='transfer-cancel'||typeof message.id!=='string'||message.id.length>64)return;
    const cancelled=this.onCancel(message.id,member)===true;
    if(conn.open)conn.send({type:'transfer-cancelled',id:message.id,cancelled});
  });''')

replace('src/main-peer.js',
''' setName(name){this.name=name;}''',
''' disconnect(deviceId){
  const id=safe(deviceId),conn=this.connections.get(id),member=this.authorized.get(id);
  if(!conn&&!member)return false;
  if(conn?.open)try{conn.send({type:'disconnect'});}catch{}
  conn?.close();
  if(this.connections.get(id)===conn){this.connections.delete(id);this.authorized.delete(id);if(member)this.onDisconnected(member);}
  else if(!conn&&member){this.authorized.delete(id);this.onDisconnected(member);}
  return true;
 }
 setName(name){this.name=name;}''')

replace('src/room.js',
'''  connect(id,transferId) {''',
'''  disconnect(id) {
    if(this.closed||!id||id===this.id||!this.members.has(id))return false;
    if(!this.host){if(id!==this.hostId)return false;this.close();return true;}
    this.admitted.delete(id);const conn=this.links.get(id);
    if(conn){conn.close();if(this.links.get(id)===conn){this.links.delete(id);this.members.delete(id);this.broadcast();}}
    else {this.members.delete(id);this.broadcast();}
    return true;
  }
  connect(id,transferId) {''')

replace('src/devices.js',
''' async rename(id,name){const record=await deviceRecords.get(id);if(!record)return;record.name=name.trim().slice(0,48)||record.name;await deviceRecords.put(record);this.rooms.get(id)?.room.close();await this.load();}''',
''' disconnect(id){const entry=this.rooms.get(id);if(!entry)return false;entry.room.close();entry.members=[];this.onChange?.();return true;}
 async rename(id,name){const record=await deviceRecords.get(id);if(!record)return;record.name=name.trim().slice(0,48)||record.name;await deviceRecords.put(record);this.rooms.get(id)?.room.close();await this.load();}''')

replace('src/app.js',
'''if(user.uuid!==deviceId&&user.peerId){const connected=connectedOnline.has(user.uuid),connect=el('button',connected?'Connected':'Connect','secondary');connect.disabled=connected;connect.onclick=async()=>{connect.disabled=true;connect.textContent='Waiting for approval…';try{await ensureMainPeer();const member=directoryMember(user);await mainPeer.requestConnection(user.peerId,member);connectedOnline.set(user.uuid,member);notice(`${user.name} accepted the connection. Either device can now send.`);renderOnlineUsers(onlineUsers);renderDevices();}catch(e){notice(e.message,true);connect.disabled=false;connect.textContent='Connect';}};row.append(connect);}''',
'''if(user.uuid!==deviceId&&user.peerId){const connected=connectedOnline.has(user.uuid),connect=el('button',connected?'Disconnect':'Connect','secondary');connect.onclick=async()=>{if(connected){disconnectDevice(connectedOnline.get(user.uuid)||directoryMember(user));return;}connect.disabled=true;connect.textContent='Waiting for approval…';try{await ensureMainPeer();const member=directoryMember(user);await mainPeer.requestConnection(user.peerId,member);connectedOnline.set(user.uuid,member);notice(`${user.name} accepted the connection. Either device can now send.`);renderOnlineUsers(onlineUsers);renderDevices();}catch(e){notice(e.message,true);connect.disabled=false;connect.textContent='Connect';}};row.append(connect);}''')

replace('src/app.js',
'''  for(const m of available){const row=el('div',undefined,'download');row.append(el('span',m.name+(m.trusted?' · Remembered':m.onlineDirectory?' · Online directory':'')));if(!m.onlineDirectory&&!m.trusted&&!trust?.contacts.some(c=>c.id===m.deviceId)){const remember=el('button','Remember device','secondary');remember.onclick=async()=>{remember.disabled=true;try{await trust.remember(m);notice('Device remembered. Next time, open this page on both devices.');}catch(e){notice(e.message,true);}finally{remember.disabled=false;}};row.append(remember);}$('connected-devices').append(row);}''',
'''  for(const m of available){const row=el('div',undefined,'download');row.append(el('span',m.name+(m.trusted?' · Remembered':m.onlineDirectory?' · Online directory':'')));if(!m.onlineDirectory&&!m.trusted&&!trust?.contacts.some(c=>c.id===m.deviceId)){const remember=el('button','Remember device','secondary');remember.onclick=async()=>{remember.disabled=true;try{await trust.remember(m);notice('Device remembered. Next time, open this page on both devices.');}catch(e){notice(e.message,true);}finally{remember.disabled=false;}};row.append(remember);}const disconnect=el('button','Disconnect','secondary');disconnect.type='button';disconnect.setAttribute('aria-label','Disconnect '+m.name);disconnect.onclick=()=>disconnectDevice(m);row.append(disconnect);$('connected-devices').append(row);}''')

replace('src/app.js',
'''function allMembers(){''',
'''function disconnectDevice(member){
 const id=member?.deviceId;if(!id)return;
 if(selectedMember?.deviceId===id)resetPrepared();
 let disconnected=false;
 if(mainPeer?.authorized.has(id)||mainPeer?.connections.has(id))disconnected=mainPeer.disconnect(id)||disconnected;
 const roomMember=[...(room?.members?.values()||[])].find(m=>m.deviceId===id&&m.id!==room?.id);
 if(roomMember)disconnected=room.disconnect(roomMember.id)||disconnected;
 if(trust?.rooms?.has(id))disconnected=trust.disconnect(id)||disconnected;
 connectedOnline.delete(id);
 for(const entry of transfers.values())if(entry.member.deviceId===id&&!entry.transfer.terminal()){entry.transfer.reconnectAttempts=4;entry.transfer.conn?.close();}
 renderOnlineUsers(onlineUsers);renderDevices();
 notice(disconnected?`${member.name} disconnected. You can connect again later.`:`${member.name} is already disconnected.`);
}
function allMembers(){''')

# ---- Regression checks -----------------------------------------------------
replace('tests/main-peer.test.mjs',
'''  a.connections.get('b').close();
  assert(!a.authorized.size&&!b.authorized.size,'Closed control link must remove both authorizations');''',
'''  assert(a.disconnect('b'),'Explicit disconnect should close the selected device');await tick();
  assert(!a.authorized.size&&!b.authorized.size,'Explicit disconnect must remove both authorizations');''')

replace('tests/block-transfer.test.mjs',
'''import {BlockTransfer,decodeChunk,encodeChunk,manifestFor} from '../src/block-transfer.js';''',
'''import {BlockTransfer,decodeChunk,encodeChunk,manifestFor,transportPlan} from '../src/block-transfer.js';''')

replace('tests/block-transfer.test.mjs',
'''test('10 GB metadata and bound binary frames do not truncate file sizes',()=>{
  assert.equal(manifestFor([{name:'10gb.bin',size:10*1024**3,lastModified:1}])[0].size,10*1024**3);
  const id=crypto.randomUUID(),raw=encodeChunk(id,3,1279,42,new Uint8Array([1,2]).buffer);assert.equal(decodeChunk(raw,id).block,1279);assert.throws(()=>decodeChunk(raw,crypto.randomUUID()));
});''',
'''test('10 GB metadata and bound binary frames do not truncate file sizes',()=>{
  assert.equal(manifestFor([{name:'10gb.bin',size:10*1024**3,lastModified:1}])[0].size,10*1024**3);
  const id=crypto.randomUUID(),raw=encodeChunk(id,3,1279,42,new Uint8Array([1,2]).buffer);assert.equal(decodeChunk(raw,id).block,1279);assert.throws(()=>decodeChunk(raw,crypto.randomUUID()));
});
test('turbo transport uses negotiated large frames and a deep bounded send window',()=>{
  const plan=transportPlan({peerConnection:{sctp:{maxMessageSize:262144}}});
  assert.equal(plan.payload,262144-36);assert.ok(plan.high>=8*1024*1024&&plan.high<=32*1024*1024);assert.ok(plan.low>=2*1024*1024&&plan.low<plan.high);
});
test('turbo transport reduces frame count when SCTP permits larger messages',async()=>{
  let frames=0;const[a,b]=pair(raw=>{if(raw instanceof ArrayBuffer)frames++;return raw;});a.peerConnection.sctp.maxMessageSize=262144;
  const store=new Store(),Storage=storageClass(),receiver=new BlockTransfer(b,{store,Storage,onOffer:(_,t)=>t.accept({storage:'test'})});
  const sender=new BlockTransfer(a,{store,files:[makeFile(600000)]});await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(receiver.state,'complete');assert.ok(frames<=3,`Expected at most 3 binary frames, got ${frames}`);
});''')

replace('tests/block-transfer.test.mjs',
'''channel.bufferedAmount=2*1024*1024;''',
'''channel.bufferedAmount=40*1024*1024;''')

# ---- Release/cache bust ----------------------------------------------------
replace_all('index.html','4.10.0','4.11.0')
replace_all('sw.js','4.10.0','4.11.0')
replace('sw.js',"const CACHE='wft-shell-v22';","const CACHE='wft-shell-v23';")
replace_all('package.json','"version": "4.10.0"','"version": "4.11.0"')
replace_all('package-lock.json','"version": "4.10.0"','"version": "4.11.0"')

print('Applied v4.11 disconnect + turbo transport patch.')
