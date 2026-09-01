from pathlib import Path


def replace(path, old, new, label):
    p=Path(path); s=p.read_text()
    if old not in s: raise SystemExit(f'missing target: {label}')
    p.write_text(s.replace(old,new,1))

# Connected peers are transport peers, not permanently sender/receiver peers.
# A transfer itself determines direction and still requires receiver consent.
replace('src/room.js',
"    if (['file-v2','file-v3'].includes(conn.metadata?.kind) && member && this.mode === 'receive') this.cb.onTransfer?.(conn,member);\n    else conn.on('open', () => { conn.send(JSON.stringify({type:'decline',reason:'Receiver is not in Receive mode. Ask them to choose Receive.'})); this.later(() => conn.close(),300); });",
"    if (['file-v2','file-v3'].includes(conn.metadata?.kind) && member) this.cb.onTransfer?.(conn,member);\n    else conn.on('open', () => { conn.send(JSON.stringify({type:'decline',reason:'This transfer channel is not authorized for the connected device.'})); this.later(() => conn.close(),300); });",
'room incoming transfer role gate')

replace('src/app.js',
"  if(selectedMember&&!busy()&&!available.some(m=>m.deviceId===selectedMember.deviceId&&m.mode==='receive'))resetPrepared();",
"  if(selectedMember&&!busy()&&!available.some(m=>m.deviceId===selectedMember.deviceId))resetPrepared();",
'selected connected peer availability')
replace('src/app.js',
"    const receive=m.mode==='receive'; const b=el('button',undefined,'device');\n    b.append(el('span','▣','device-icon'),el('strong',m.name),el('span',!receive?'Sender · choose Receive on this device to get files':selectedMember?.deviceId===m.deviceId&&ready?'Selected · choose files below':m.onlineDirectory?'Online · select this Peer 1 →':'Select this receiver →','muted'));\n    b.disabled=!receive||!!busy();b.onclick=()=>prepareReceiver(m);$('devices').append(b);",
"    const b=el('button',undefined,'device');\n    b.append(el('span','▣','device-icon'),el('strong',m.name),el('span',selectedMember?.deviceId===m.deviceId&&ready?'Selected · choose files below':m.onlineDirectory?'Online · can send or receive →':'Connected · can send or receive →','muted'));\n    b.disabled=!!busy();b.onclick=()=>prepareReceiver(m);$('devices').append(b);",
'connected device buttons')
replace('src/app.js',
"  if(!member||member.mode!=='receive'){notice('That device is not available to receive files.',true);return;}\n",
"  if(!member){notice('That connected device is unavailable.',true);return;}\n",
'prepare receiver role gate')
replace('src/app.js',
"const current=allMembers().find(m=>m.deviceId===member.deviceId&&m.mode==='receive');",
"const current=allMembers().find(m=>m.deviceId===member.deviceId);",
'reconnect role gate')
replace('src/app.js',
"const peer=allMembers().find(m=>m.deviceId===record.receiverId&&m.mode==='receive');",
"const peer=allMembers().find(m=>m.deviceId===record.receiverId);",
'recovery role gate')
replace('src/app.js',
"const peer=allMembers().find(m=>m.deviceId===record.receiverId&&m.mode==='receive');",
"const peer=allMembers().find(m=>m.deviceId===record.receiverId);",
'resume role gate')
replace('src/app.js',
"$('setup-hint').textContent='Scan once on either device; leave the other device’s QR open. Online users can also connect directly using Peer 1.';",
"$('setup-hint').textContent='After devices connect, either device can initiate the next file transfer. Every incoming transfer still requires receiver approval.';",
'bidirectional hint')

# Real browser regression: reverse direction without changing either room's original mode.
p=Path('tests/browser-integration.mjs'); s=p.read_text()
old="""  console.log('PASS: two real Chromium peers joined through PeerJS Cloud, discovered receiver, waited for consent, and transferred binary + empty files over WebRTC.');
  if(process.env.RELAY_ONLY==='1')console.log('PASS: both peers forced to relay-only ICE; transfer required TURN.');
  await b.evaluate(()=>room.close());await a.waitForFunction(()=>members.length===0);console.log('PASS: disconnected receiver removed from room.');
"""
new="""  console.log('PASS: A → B transfer completed with receiver consent.');
  // Reverse direction on the same established room without changing modes:
  // A is still mode=send and B is still mode=receive. Connected peers must be bidirectional.
  await a.evaluate(()=>{room.cb.onTransfer=conn=>{window.reverseReceived=[];window.reverseTransfer=new testApi.Transfer(conn,{onOffer:()=>window.reverseOffered=true,onFile:async f=>window.reverseReceived.push({name:f.name,bytes:Array.from(new Uint8Array(await f.blob.arrayBuffer()))})});};});
  await b.evaluate(()=>{window.reverseSender=new testApi.Transfer(room.connect(members[0].id),{files:[new File([Uint8Array.from([9,8,7,6,5])],'reverse.bin')]});});
  await a.waitForFunction(()=>window.reverseOffered,{timeout:30000});
  await a.evaluate(()=>reverseTransfer.accept(()=>testApi.memorySink()));
  await b.waitForFunction(()=>reverseSender.terminal(),{timeout:30000});assert.equal(await b.evaluate(()=>reverseSender.state),'complete');
  await a.waitForFunction(()=>reverseReceived?.length===1,{timeout:30000});assert.deepEqual(await a.evaluate(()=>reverseReceived[0].bytes),[9,8,7,6,5]);
  console.log('PASS: B → A reverse transfer completed on the same connection state while A remained Send mode and B remained Receive mode.');
  if(process.env.RELAY_ONLY==='1')console.log('PASS: both peers forced to relay-only ICE; transfer required TURN.');
  await b.evaluate(()=>room.close());await a.waitForFunction(()=>members.length===0);console.log('PASS: disconnected receiver removed from room.');
"""
if old not in s: raise SystemExit('missing browser reverse insertion target')
p.write_text(s.replace(old,new,1))

# Unit regression for room transport authorization independent of UI mode.
p=Path('tests/room.test.mjs'); s=p.read_text()
append="""
test('connected room peers can receive file channels regardless of their current UI mode',async()=>{
  let transfers=0;const room=new Room({onTransfer:()=>transfers++},{PeerClass:FakePeer});
  const opening=room.open('abcdefgh2345',true,'Host','send');room.peer.emit('open');await opening;
  room.members.set('guest',{id:'guest',name:'Guest',mode:'receive',deviceId:'guest-device'});
  const incoming=new FakeConn('guest');incoming.metadata={kind:'file-v3',transferId:crypto.randomUUID()};room.incoming(incoming);
  assert.equal(room.mode,'send');assert.equal(transfers,1,'Send-mode peer must still accept an incoming transfer offer from a connected member');room.close();
});
"""
if "connected room peers can receive file channels regardless" not in s:p.write_text(s+append)
