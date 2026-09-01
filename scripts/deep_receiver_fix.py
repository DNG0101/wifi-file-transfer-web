from pathlib import Path

p = Path('src/app.js')
s = p.read_text()

def rep(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'missing replacement target: {label}')
    s = s.replace(old, new, 1)

rep("let selectedMember,preparedConnection,preparingDevice=false,prepareGeneration=0;\nconst pendingReceivers=new Map();",
    "let selectedMember;",
    'receiver selection state')

rep("  if(next!=='send')resetPrepared();\n  if(next!=='receive')for(const connection of pendingReceivers.values())connection.close();",
    "  if(next!=='send')resetPrepared();",
    'mode cleanup')

rep("  const ready=mode==='send'&&selectedMember&&preparedConnection?.open;",
    "  const ready=mode==='send'&&!!selectedMember&&!busy();",
    'ready state')

rep("    b.append(el('span','▣','device-icon'),el('strong',m.name),el('span',!receive?'Sender · choose Receive on this device to get files':selectedMember?.deviceId===m.deviceId&&ready?'Connected · choose files below':preparingDevice?'Connecting…':m.onlineDirectory?'Online · connect Peer 1 →':'Connect to this receiver →','muted'));\n    b.disabled=!receive||!!busy()||preparingDevice;b.onclick=()=>prepareReceiver(m);$('devices').append(b);",
    "    b.append(el('span','▣','device-icon'),el('strong',m.name),el('span',!receive?'Sender · choose Receive on this device to get files':selectedMember?.deviceId===m.deviceId&&ready?'Selected · choose files below':m.onlineDirectory?'Online · select this Peer 1 →':'Select this receiver →','muted'));\n    b.disabled=!receive||!!busy();b.onclick=()=>prepareReceiver(m);$('devices').append(b);",
    'device buttons')

rep("function allMembers(){\n const directory=onlineUsers.filter(u=>u.uuid!==deviceId&&u.peerId).map(directoryMember);\n const combined=[...(trust?.members()||[]),...members.map(m=>({...m,room})),...directory];\n return combined.filter((m,i)=>combined.findIndex(x=>x.deviceId===m.deviceId)===i);\n}",
    "function allMembers(){\n const directory=onlineUsers.filter(u=>u.uuid!==deviceId&&u.peerId).map(directoryMember);\n const byDevice=new Map();\n for(const m of [...(trust?.members()||[]),...members.map(m=>({...m,room}))])if(!byDevice.has(m.deviceId))byDevice.set(m.deviceId,m);\n // A fresh Peer 2 presence row is authoritative for the current Peer 1 route.\n // Preserve the remembered/trusted flag, but use the online Peer 1 id/room.\n for(const m of directory){const prior=byDevice.get(m.deviceId);byDevice.set(m.deviceId,{...prior,...m,trusted:!!prior?.trusted||!!m.trusted,onlineDirectory:true});}\n return [...byDevice.values()];\n}",
    'member route merge')

rep("function startSend(member,record) {\n  if(busy())return;\n  try {manifestFor(files);const id=record?.transferId||crypto.randomUUID();const connection=!record&&preparedConnection?.open&&selectedMember?.deviceId===member.deviceId?preparedConnection:member.room.connect(member.id,id);track(connection,member,true,record);debug('Files selected; transfer request sent without a separate upload.');notice(`Waiting for ${member.name} to accept. Sending starts immediately after acceptance.`);}\n  catch(e) {notice(e.message,true);}\n}\nfunction resetPrepared(){prepareGeneration++;const conn=preparedConnection;preparedConnection=null;selectedMember=null;preparingDevice=false;if(conn&&conn!==active?.conn)conn.close();}\nfunction prepareReceiver(member){\n  if(busy())return;if(preparedConnection?.open&&selectedMember?.deviceId===member.deviceId){$('send-panel').scrollIntoView({behavior:'smooth',block:'center'});return;}\n  if(mode!=='send')setMode('send');resetPrepared();const generation=prepareGeneration;preparingDevice=true;renderDevices();\n  try{const conn=member.room.connect(member.id,crypto.randomUUID());preparedConnection=conn;const timer=setTimeout(()=>{if(generation===prepareGeneration&&!conn.open){resetPrepared();notice('Could not connect to this receiver. Try again.',true);renderDevices();}},25000);\n    const opened=()=>{clearTimeout(timer);if(generation!==prepareGeneration){conn.close();return;}selectedMember=member;preparingDevice=false;debug(member.onlineDirectory?'Main Peer 1 connected from online directory.':'File channel ready before file selection.');notice(`Connected to ${member.name}. Choose files now; there is no separate upload step.`);renderDevices();};\n    conn.on('open',opened);if(conn.open)opened();conn.on('close',()=>{clearTimeout(timer);if(preparedConnection===conn){preparedConnection=null;preparingDevice=false;renderDevices();}});conn.on('error',()=>{clearTimeout(timer);if(generation===prepareGeneration&&!busy()){resetPrepared();notice('Receiver connection failed. Try connecting again.',true);renderDevices();}});\n  }catch(e){resetPrepared();notice(e.message,true);renderDevices();}\n}",
    "function startSend(member,record) {\n  if(busy())return;\n  try {\n    manifestFor(files);const id=record?.transferId||crypto.randomUUID();\n    // Do not open a file-v3 channel while merely selecting a receiver. The\n    // actual transfer channel is created only after files are selected.\n    const connection=member.room.connect(member.id,id);\n    track(connection,member,true,record);\n    debug('Files selected; transfer request channel opened.');\n    notice(`Waiting for ${member.name} to accept. Sending starts immediately after acceptance.`);\n  } catch(e) {notice(e.message,true);}\n}\nfunction resetPrepared(){selectedMember=null;}\nfunction prepareReceiver(member){\n  if(busy()){notice('A transfer is already active. Finish or cancel it before selecting another receiver.',true);return;}\n  if(!member||member.mode!=='receive'){notice('That device is not available to receive files.',true);return;}\n  if(mode!=='send')setMode('send');\n  selectedMember=member;\n  debug(member.onlineDirectory?'Selected current Peer 1 from online directory.':'Selected available receiver.');\n  notice(`Selected ${member.name}. Choose files to start the transfer.`);\n  renderDevices();\n  $('send-panel').scrollIntoView({behavior:'smooth',block:'center'});\n}",
    'receiver selection lifecycle')

rep("  if(!selectedMember||!preparedConnection?.open||busy()){e.target.value='';notice('Connect to a receiver before selecting files.',true);return;}",
    "  if(!selectedMember||busy()){e.target.value='';notice('Select an available receiver before choosing files.',true);return;}",
    'file selection gate')

rep("  },onInterrupted:transfer=>scheduleReconnect(transfer,member),onOffer:manifest=>{",
    "  },onInterrupted:transfer=>{\n    if(transfer.direction==='send')scheduleReconnect(transfer,member);\n    else if(!transfer.record)transfer.fail('The sender disconnected before the transfer was accepted.','failed',false);\n  },onOffer:manifest=>{",
    'receiver pre-accept disconnect')

rep("function incoming(conn,m){if(busy()){if(active.direction==='receive'&&conn.metadata?.transferId===active.id&&m.deviceId===active.record?.senderId){active.attach(conn);return;}if(conn.open)conn.close();else conn.on('open',()=>conn.close());return;}if(conn.metadata?.kind!=='file-v3'){conn.close();return;}track(conn,m,false);}",
    "function incoming(conn,m){if(busy()){const senderId=active?.record?.senderId||active?.options?.senderId;if(active?.direction==='receive'&&conn.metadata?.transferId===active.id&&m.deviceId===senderId){active.attach(conn);return;}if(conn.open)conn.close();else conn.on('open',()=>conn.close());return;}if(conn.metadata?.kind!=='file-v3'){conn.close();return;}track(conn,m,false);}",
    'receiver reconnect match')

rep("  const t=new BlockTransfer(conn,{files:outgoing?[...files]:undefined,record,id:record?.transferId||conn.metadata?.transferId,senderId:outgoing?deviceId:member.deviceId,receiverId:outgoing?member.deviceId:deviceId,reselected:!!record,requireDirectory:false,onUpdate:update=>{\n    const changed=row.state!==update.state,advanced=update.bytes>row.bytes;Object.assign(row,update);updateCard(row);if(changed){save();debug(`${update.direction} ${update.state}: ${fmt(update.bytes)} verified bytes`);}else if(advanced)debug(`${update.direction}: ${fmt(update.bytes)} acknowledged and saved`);\n    const terminal=['complete','failed','cancelled','declined'].includes(update.state);\n    if(terminal) {\n      save();closeRequest();clearTimeout(reconnectTimer);reconnectAttempts=0;void renderRecovery();",
    "  const t=new BlockTransfer(conn,{files:outgoing?[...files]:undefined,record,id:record?.transferId||conn.metadata?.transferId,senderId:outgoing?deviceId:member.deviceId,receiverId:outgoing?member.deviceId:deviceId,reselected:!!record,requireDirectory:false,onUpdate:update=>{\n    const changed=row.state!==update.state,advanced=update.bytes>row.bytes;Object.assign(row,update);updateCard(row);if(changed){save();debug(`${update.direction} ${update.state}: ${fmt(update.bytes)} verified bytes`);}else if(advanced)debug(`${update.direction}: ${fmt(update.bytes)} acknowledged and saved`);\n    const terminal=['complete','failed','cancelled','declined'].includes(update.state);\n    if(terminal) {\n      save();closeRequest();clearTimeout(reconnectTimer);reconnectAttempts=0;\n      if(['complete','cancelled','declined'].includes(update.state)&&!t.cleanupStarted){t.cleanupStarted=true;void (async()=>{try{if(update.state==='complete')await t.storage?.cleanup();if(t.record?.id)await records.remove(t.record.id);}catch(e){debug('Terminal cleanup: '+e.message);}finally{void renderRecovery();}})();}else void renderRecovery();\n      if(active===t)active=null;",
    'terminal unlock and cleanup')

rep("function leaveRoom() {\n  if(busy()){notice('Finish or cancel the file transfer before leaving.',true);return;}\n  attempt++;resetPrepared();room?.close();room=null;members=[];connecting=false;\n  $('room-info').hidden=true;roomState('closed');controls();notice('Disconnected from invitation. Online Peer 1 remains available while Online is on.');\n}",
    "function leaveRoom() {\n  if(busy()){notice('Finish or cancel the file transfer before leaving.',true);return;}\n  attempt++;resetPrepared();room?.close();room=null;members=[];connecting=false;\n  $('room-info').hidden=true;roomState('closed');controls();notice('Disconnected from invitation. Main Peer 1 remains available while this page is open.');\n}",
    'leave room message')

p.write_text(s)

# Main Peer 1 has a deterministic UUID-derived id. A non-owner tab can still
# advertise that deterministic id even though the Web Lock owner hosts it.
p = Path('src/main-peer.js')
s = p.read_text()
old = "   await ready;\n   return shared.id||'';"
new = "   await ready;\n   return shared.id||this.id;"
if old not in s:
    raise SystemExit('missing main peer standby return target')
p.write_text(s.replace(old,new,1))
