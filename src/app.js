import {Room,newCode,parseRoom} from './room.js';
import {BlockTransfer,manifestFor} from './block-transfer.js';
import {records,BlockStorage,cleanupApplicationStorage} from './storage.js';
import {TrustedDevices,identity,friendlyName} from './devices.js';
import {Scanner} from './qr.js';
import {readInvitation,invitationUrl} from './invitation.js';
import {PresencePeerManager} from './presence-peer.js';
import {MainPeerManager} from './main-peer.js';
import {configureNetwork} from './network.js';
import {connectionDiagnosis,failedChannelMessage} from './connection-health.js';
import qrcode from 'qrcode-generator';

const $ = id => document.getElementById(id);
const fmt = n => n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1073741824?`${(n/1048576).toFixed(1)} MB`:`${(n/1073741824).toFixed(2)} GB`;
let room, mode=null, files=[], members=[], active, directory,trust,resumeRecord;
let selectedMember,preparedConnection,preparingDevice=false,prepareGeneration=0,latestDiagnosis;
const deviceId=identity();let reconnectTimer,reconnectAttempts=0,presence,mainPeer,onlineUsers=[];
let connecting=false, attempt=0, lastAttempt, wakeLock, acquiringWake=false;
const downloads=[], cards=new Map();
let history=[];
function notice(text,error=false) { $('status').textContent=text; $('status').className=error?'status error':'status'; }
function debug(text){if(!$('debug-enabled').checked)return;const log=$('debug-log');log.textContent=(log.textContent+'\n'+new Date().toLocaleTimeString()+' '+text).split('\n').slice(-100).join('\n');}
const directoryRoom={connect:(id,transferId)=>mainPeer.connect(id,transferId),probe:(id,timeout)=>mainPeer.probe(id,timeout)};
function directoryMember(user){return {id:user.peerId,deviceId:user.uuid,name:user.name,mode:'receive',onlineDirectory:true,room:directoryRoom};}
function renderOnlineUsers(users=[]){
 onlineUsers=users.filter((u,i)=>users.findIndex(x=>x.uuid===u.uuid)===i);
 $('online-users').replaceChildren();
 if(!onlineUsers.length){$('online-users').append(el('p',$('online-toggle').checked?'No online users found yet. Keep this page open.':'Turn Online on to see available users.','muted'));renderDevices();return;}
 for(const user of onlineUsers){
  const row=el('div',undefined,'online-user'),identity=el('div');identity.append(el('strong',user.name),el('small',user.uuid===deviceId?'This device':user.peerId?`Peer 1: ${user.peerId}`:'Peer 1 starting…'));
  row.append(identity);
  if(user.uuid!==deviceId&&user.peerId){const connect=el('button','Connect','secondary');connect.onclick=()=>prepareReceiver(directoryMember(user));row.append(connect);}
  $('online-users').append(row);
 }
 renderDevices();
}
function presenceState(state,detail){$('online-state').textContent=detail||state;debug('Online presence: '+state);}
async function ensureMainPeer(){
 await networkReady;
 if(!mainPeer)mainPeer=new MainPeerManager({uuid:deviceId,name:$('device-name').value,onIncoming:(conn,m)=>awaitTransfer(conn,{...m,room:directoryRoom}),onState:(state,detail)=>debug(`Main Peer 1 ${state}${detail?' · '+detail:''}`)});
 return await mainPeer.start();
}
async function setOnline(enabled){
 $('online-toggle').checked=enabled;try{localStorage.setItem('wft-online-enabled',enabled?'1':'0');}catch{}
 if(enabled){
  try{
   const peer1Id=await ensureMainPeer();
   if(!presence)presence=new PresencePeerManager({uuid:deviceId,name:$('device-name').value,peer1Id,onChange:renderOnlineUsers,onState:presenceState});
   else await presence.setIdentity({name:$('device-name').value,peer1Id});
   await presence.start();
  }catch(e){presenceState('failed',e.message);}
 } else {await presence?.stop();onlineUsers=[];renderOnlineUsers([]);}
}
const networkReady=configureNetwork().catch(e=>debug(e.message));
function save() {}
function el(tag,text,className) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
const busy = () => active&&!active.terminal();
const retainedBytes = () => downloads.reduce((n,d)=>n+d.size,0);
function drawHistory() {
  $('history').replaceChildren(); cards.clear();
  if(!history.length) {$('history').append(el('p','No transfers yet.','muted'));return;}
  for(const row of history) {
    const card=el('article',undefined,'history-card'), title=el('strong'), detail=el('p',undefined,'muted'), progress=el('progress'), label=el('span');
    progress.max=100;card.append(title,detail,progress,label);$('history').append(card);
    cards.set(row.id,{title,detail,progress,label});updateCard(row);
  }
}
const stateLabel={connecting:'Connecting',waiting:'Waiting for receiver to accept',offered:'Waiting for your approval',preparing:'Preparing storage',transferring:'Transferring',paused:'Paused',reconnecting:'Connection interrupted — progress saved',verifying:'Verifying saved file',complete:'Verified complete ✓',failed:'Stopped — check saved progress',declined:'Declined',cancelled:'Cancelled'};
function updateCard(row) {
  const c=cards.get(row.id);if(!c)return;
  c.title.textContent=`${row.direction==='send'?'↑ To':'↓ From'} ${row.peer} · ${row.files.length} file${row.files.length===1?'':'s'}`;
  c.detail.textContent=row.files.map(f=>f.name).join(', ');
  c.progress.value=row.total?Math.min(100,row.bytes/row.total*100):row.state==='complete'?100:0;
  c.progress.setAttribute('aria-label',`Transfer to or from ${row.peer}`);
  const percent=row.total?Math.min(100,row.bytes/row.total*100):row.state==='complete'?100:0;c.label.textContent=`${stateLabel[row.state]||row.state} · ${percent.toFixed(percent<10?1:0)}% · ${fmt(row.bytes||0)} / ${fmt(row.total||0)}${row.speed?' · '+fmt(row.speed)+'/s':''}${row.eta?' · about '+Math.ceil(row.eta/60)+' min left':''}${row.state==='verifying'?' · '+fmt(row.verifiedBytes||0)+' checked':''}${row.detail?' · '+row.detail:''}`;
}
function setMode(next) {
  if(busy()) {notice('Finish or cancel this transfer before changing mode.',true);return;}
  mode=next;room?.setMode(mode);trust?.setMode(mode);
  if(next!=='send')resetPrepared();
  for(const name of ['send','receive']) {$(name).classList.toggle('selected',mode===name);$(name).setAttribute('aria-pressed',mode===name);}
  $('pairing-panel').hidden=!mode;$('receive-panel').hidden=mode!=='receive';
  $('setup-hint').textContent='After devices connect, either device can initiate the next file transfer. Every incoming transfer still requires receiver approval.';
  renderDevices();renderInvite();
}
function renderDevices() {
  $('devices').replaceChildren();
  const available=allMembers();
  const checking=[...(trust?.rooms.values()||[])].some(entry=>['connecting','reconnecting'].includes(entry.room.state));
  $('discovery-status').textContent=available.length?`${available.length} available device${available.length===1?'':'s'} found. Choose a receiver before selecting files.`:checking?'Checking your remembered devices…':'No devices available yet. Use Online discovery, scan a QR, or enter a connection code.';
  if(selectedMember&&!busy()&&!available.some(m=>m.deviceId===selectedMember.deviceId))resetPrepared();
  const ready=mode==='send'&&!!selectedMember&&(preparedConnection===true||!!preparedConnection?.open)&&!busy();
  $('send-panel').hidden=!ready&&!busy();
  if(mode!=='send')$('send-panel').hidden=true;
  $('file-picker').disabled=$('folder-picker').disabled=!ready||!!busy();
  $('target-name').textContent=selectedMember?`Connected to ${selectedMember.name}. Select files to request transfer immediately.`:'Connect to a receiver first.';
  for(const m of available) {
    const b=el('button',undefined,'device');
    b.append(el('span','▣','device-icon'),el('strong',m.name),el('span',selectedMember?.deviceId===m.deviceId&&ready?'File connection ready · choose files below':preparingDevice&&selectedMember?.deviceId===m.deviceId?'Opening file connection…':m.onlineDirectory?'Online · connect securely →':'Paired · test file connection →','muted'));
    b.disabled=!!busy()||preparingDevice;b.onclick=()=>prepareReceiver(m);$('devices').append(b);
  }
  $('connected-panel').hidden=!available.length;$('connected-devices').replaceChildren();
  for(const m of available){const row=el('div',undefined,'download');row.append(el('span',m.name+(m.trusted?' · Remembered':m.onlineDirectory?' · Online directory':'')));if(!m.onlineDirectory&&!m.trusted&&!trust?.contacts.some(c=>c.id===m.deviceId)){const remember=el('button','Remember device','secondary');remember.onclick=async()=>{remember.disabled=true;try{await trust.remember(m);notice('Device remembered. Next time, open this page on both devices.');}catch(e){notice(e.message,true);}finally{remember.disabled=false;}};row.append(remember);}$('connected-devices').append(row);}
}
function allMembers(){
 const directory=onlineUsers.filter(u=>u.uuid!==deviceId&&u.peerId).map(directoryMember);
 const byDevice=new Map();
 for(const m of [...(trust?.members()||[]),...members.map(m=>({...m,room}))])if(!byDevice.has(m.deviceId))byDevice.set(m.deviceId,m);
 for(const m of directory){const prior=byDevice.get(m.deviceId);byDevice.set(m.deviceId,{...prior,...m,trusted:!!prior?.trusted||!!m.trusted,onlineDirectory:true});}
 return [...byDevice.values()];
}
function inviteUrl() {return invitationUrl(location.href,room.code,mode);}
function renderInvite() {
  if(!room?.id||room.closed)return;
  const qr=qrcode(0,'M');qr.addData(inviteUrl());qr.make();$('room-qr').src=qr.createDataURL(6,24);
  $('current-room').textContent=room.code.match(/.{1,4}/g).join('-');
  const remaining=Math.ceil((room.expires-Date.now())/60000);$('room-note').textContent=remaining>0?`New devices can join for ${remaining} more minute${remaining===1?'':'s'}. Keep this page open.`:'Invitation expired for new devices. Tap New invitation. Connected devices can finish.';
  $('room-qr').hidden=remaining<=0;
}
function roomState(state,detail='') {
  debug('Connection: '+state);
  $('connection-state').textContent=state==='connected'?(members.length?`${members.length} device connected`:room?.host?'Invitation ready':'Connected'):{idle:'Not connected',connecting:'Contacting service…',reconnecting:'Reconnecting…',disconnected:'Disconnected',closed:'Not connected'}[state]||state;
  $('retry-room').hidden=!['disconnected','reconnecting'].includes(state);
  if(detail)notice(detail,state==='disconnected');renderDevices();
}
function controls() {
  const locked=!!busy();
  $('create-room').disabled=$('join-room').disabled=connecting||(locked&&active.state!=='reconnecting');
  $('send').disabled=$('receive').disabled=locked;
  $('cancel-connection').hidden=!connecting; $('cancel').hidden=!locked;
  $('clear-history').disabled=locked;
  $('pause').hidden=!active||!['transferring','paused'].includes(active.state)||active.localPaused;
  $('resume').hidden=!active||!(active.localPaused||active.state==='reconnecting');
  $('active-summary').textContent=locked?`${stateLabel[active.state]} · ${fmt(active.bytes)} / ${fmt(active.total)}`:'';
  $('leave-room').hidden=!room||connecting;
  renderDevices();void maintainWakeLock();
}
async function maintainWakeLock() {
  const wanted=!!busy()&&$('keep-awake').checked&&document.visibilityState==='visible';
  if(!wanted) {if(wakeLock){await wakeLock.release().catch(()=>{});wakeLock=null;}$('awake-status').textContent='Keep both pages visible during transfer.';return;}
  if(!navigator.wakeLock||wakeLock||acquiringWake)return;
  acquiringWake=true;
  try {
    const lock=await navigator.wakeLock.request('screen');
    if(!busy()||!$('keep-awake').checked) {await lock.release();return;}
    wakeLock=lock;$('awake-status').textContent='Screen kept awake while transferring.';
    lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});
  } catch {$('awake-status').textContent='Screen wake lock unavailable. Keep the device awake manually.';}
  finally {acquiringWake=false;}
}
function closeRequest() {if($('incoming').open)$('incoming').close();}
async function refreshAcceptance() {
  if(active?.state!=='offered')return;
  const canTemp=!!navigator.storage?.getDirectory;
  $('accept').disabled=!directory&&!canTemp;
  $('request-note').textContent=directory?`The verified file will be saved automatically to ${directory.name}.`:canTemp?'Accept to receive. Temporary transfer data uses browser private storage only until verification, then the file download starts automatically.':'Choose a download folder before accepting this file.';
}
function receivedFile(file) {
  const line=el('div',undefined,'download');
  if(file.blob) {
    const url=URL.createObjectURL(file.blob),item={url,size:file.blob.size};downloads.push(item);
    const name=el('span',`${file.name} · ${fmt(file.size)}`),actions=el('div',undefined,'download-actions');
    const a=el('a','Save to device','save-file');a.href=url;a.download=file.name;
    const remove=el('button','Hide','secondary');
    remove.onclick=()=>{URL.revokeObjectURL(url);downloads.splice(downloads.indexOf(item),1);line.remove();void refreshAcceptance();$('download-memory').textContent=`${fmt(retainedBytes())} shown here. Use Saved progress to restore hidden files or remove stored data.`;};
    actions.append(a,remove);line.append(name,actions);document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);const i=downloads.indexOf(item);if(i>=0)downloads.splice(i,1);},60000);
  } else line.append(el('span',`✓ Saved ${file.savedName} automatically to your chosen folder`));
  $('downloads').append(line);$('received-section').hidden=false;
  $('download-memory').textContent=file.blob?`${fmt(retainedBytes())} from older browser-stored transfers.`:'Files are already saved in your chosen device folder.';
}
function track(conn,member,outgoing,record) {
  active?.conn.close();
  const row={id:record?.transferId||conn.metadata?.transferId||crypto.randomUUID(),peer:member.name,direction:outgoing?'send':'receive',state:'connecting',files:[],bytes:0,total:0,time:new Date().toISOString()};
  history.unshift(row);history=history.slice(0,50);drawHistory();save();
  $('history').closest('details').open=true;
  const t=new BlockTransfer(conn,{files:outgoing?[...files]:undefined,record,id:record?.transferId||conn.metadata?.transferId,senderId:outgoing?deviceId:member.deviceId,receiverId:outgoing?member.deviceId:deviceId,reselected:!!record,requireDirectory:false,onUpdate:update=>{
    const changed=row.state!==update.state,advanced=update.bytes>row.bytes;Object.assign(row,update);updateCard(row);if(changed){save();debug(`${update.direction} ${update.state}: ${fmt(update.bytes)} verified bytes`);}else if(advanced)debug(`${update.direction}: ${fmt(update.bytes)} acknowledged and saved`);
    const terminal=['complete','failed','cancelled','declined'].includes(update.state);
    if(terminal) {
      save();closeRequest();clearTimeout(reconnectTimer);reconnectAttempts=0;
      if(['complete','cancelled','declined'].includes(update.state)&&!t.cleanupStarted){t.cleanupStarted=true;void (async()=>{try{if(update.state==='complete')await t.storage?.cleanup();if(t.record?.id)await records.remove(t.record.id);}catch(e){debug('Terminal cleanup: '+e.message);}finally{void renderRecovery();}})();}else void renderRecovery();
      if(active===t)active=null;
      notice(update.state==='complete'?(outgoing?'Delivered. The receiver verified and saved all files.':'Received and saved directly to your device folder.'):update.detail,update.state!=='complete');
      if(!outgoing&&update.state==='complete')$('received-section').scrollIntoView({behavior:'smooth',block:'center'});
    } else if(update.state==='transferring')notice(`${outgoing?'Sending':'Receiving'}: ${fmt(update.bytes)} of ${fmt(update.total)}. Keep both pages open.`);
    controls();
  },onInterrupted:transfer=>{if(transfer.direction==='send')scheduleReconnect(transfer,member);else if(!transfer.record)transfer.fail('The sender disconnected before the transfer was accepted.','failed',false);},onOffer:manifest=>{
    $('request-title').textContent=`${member.name} wants to send ${manifest.length} file${manifest.length===1?'':'s'}`;
    $('request-files').textContent=manifest.map(f=>`${f.name} (${fmt(f.size)})`).join('\n');
    void refreshAcceptance();$('incoming').showModal();$('decline').focus();
  },onFile:receivedFile});
  active=t;controls();return t;
}
function startSend(member,record) {
  if(busy())return;
  try {manifestFor(files);const id=record?.transferId||crypto.randomUUID();const connection=!record&&preparedConnection?.open?preparedConnection:member.room.connect(member.id,id);preparedConnection=null;track(connection,member,true,record);debug('Files selected; transfer channel opened to the selected device.');notice(`Waiting for ${member.name} to accept. Sending starts immediately after acceptance.`);}
  catch(e) {notice(e.message,true);}
}
function resetPrepared(){prepareGeneration++;const conn=preparedConnection;preparedConnection=null;selectedMember=null;preparingDevice=false;if(conn?.close&&conn!==active?.conn)conn.close();}
function prepareReceiver(member){
  if(busy()){notice('A transfer is already active. Finish or cancel it before selecting another receiver.',true);return;}
  if(!member){notice('That connected device is unavailable.',true);return;}
  if((preparedConnection===true||preparedConnection?.open)&&selectedMember?.deviceId===member.deviceId){$('send-panel').scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(mode!=='send')setMode('send');resetPrepared();const generation=prepareGeneration;selectedMember=member;preparingDevice=true;renderDevices();notice(`Opening a secure file connection to ${member.name}…`);
  if(member.onlineDirectory){preparedConnection=true;preparingDevice=false;debug('Selected the current advertised Peer 1 endpoint.');notice(`Online route ready with ${member.name}. Choose files now.`);renderDevices();$('send-panel').scrollIntoView({behavior:'smooth',block:'center'});return;}
  Promise.resolve().then(()=>member.room.probe(member.id)).then(conn=>{if(generation!==prepareGeneration){conn.close();return;}preparedConnection=conn;preparingDevice=false;debug('A file data channel was opened and verified before file selection.');notice(`File connection ready with ${member.name}. Choose files now.`);renderDevices();$('send-panel').scrollIntoView({behavior:'smooth',block:'center'});}).catch(()=>void failPrepared(member,generation));
}
async function failPrepared(member,generation){if(generation!==prepareGeneration||busy())return;preparedConnection=null;preparingDevice=false;latestDiagnosis=await connectionDiagnosis();if(generation!==prepareGeneration)return;notice(failedChannelMessage(member.name,latestDiagnosis),true);$('network-result').textContent=latestDiagnosis.summary;renderDevices();}
function awaitTransfer(conn,member){
  incoming(conn,member);
}
function scheduleReconnect(t,member){if(t!==active||t.terminal()||t.direction!=='send')return;clearTimeout(reconnectTimer);if(reconnectAttempts>=4){notice('Automatic retries stopped. Keep both pages open, reconnect if needed, then tap Resume.',true);return;}reconnectTimer=setTimeout(()=>{if(t!==active||t.terminal())return;reconnectAttempts++;const current=allMembers().find(m=>m.deviceId===member.deviceId);try{if(!current)throw Error('Receiver offline');debug('Reconnection attempt '+reconnectAttempts);t.attach(current.room.connect(current.id,t.id));setTimeout(()=>{if(t===active&&t.state==='connecting'){t.interrupted('Connection retry timed out.');}},25000);}catch{scheduleReconnect(t,member);}},[1000,3000,8000,15000][reconnectAttempts]);}
function incoming(conn,m){if(busy()){const senderId=active?.record?.senderId||active?.options?.senderId;if(active?.direction==='receive'&&conn.metadata?.transferId===active.id&&m.deviceId===senderId){active.attach(conn);return;}if(conn.open)conn.close();else conn.on('open',()=>conn.close());return;}if(!['file-v3','connection-probe'].includes(conn.metadata?.kind)){conn.close();return;}track(conn,m,false);}
async function openRoom(host,codeOverride,collisions=0) {
  if(busy()&&active.state!=='reconnecting')return;
  let code;try{code=host?(codeOverride||newCode()):parseRoom(codeOverride||$('room-code').value);}catch(e){notice(e.message,true);$('room-code').focus();return;}
  if(!mode)setMode('send');
  const token=++attempt;
  if(!busy())resetPrepared();room?.close();members=[];connecting=true;lastAttempt={host,code};controls();
  $('room-info').hidden=true;roomState('connecting','Connecting to the other device…');
  const candidate=new Room({
    onMembers:list=>{if(token!==attempt)return;members=list;roomState(candidate.state);if(list.length)notice(`${list[0].name} paired. Choose that device to verify the file connection.`);renderDevices();},
    onError:msg=>{if(token===attempt)notice(msg,true);},
    onState:(state,detail)=>{if(token===attempt)roomState(state,detail);},
    onTransfer:(conn,m)=>{if(token!==attempt){conn.close();return;}awaitTransfer(conn,{...m,room:candidate});},
    onMessage:async(message,m,reply)=>{if(message?.type!=='remember'||busy()){reply({accepted:false});return;}if(!confirm(`Remember ${m.name}? They will be able to find this device when both pages are open. You still approve each file transfer.`)){reply({accepted:false});return;}try{await trust.add(m,message.secret);reply({accepted:true});notice('Device remembered.');}catch(e){reply({accepted:false});notice(e.message,true);}}
  },{deviceId});room=candidate;
  try {
    await networkReady;if(token!==attempt)return;
    await candidate.open(code,host,$('device-name').value.trim()||'My device',mode);if(token!==attempt)return;
    $('room-code').value=code;$('room-info').hidden=false;renderInvite();
    notice(active?.state==='reconnecting'?'Reconnected. Tap Resume to continue your saved transfer.':members.length?'Devices paired. On the sender, choose the receiver to enable file selection.':mode==='receive'?'Ready. Scan this invitation on the sending device.':'Ready. Scan the other device’s QR, or let it scan yours.');
  } catch(e) {
    if(token!==attempt)return;candidate.close();room=null;members=[];$('room-info').hidden=true;
    roomState('disconnected',e.message.replaceAll('room','invitation'));$('retry-room').hidden=false;
    if(host&&!codeOverride&&collisions<3&&e.message.includes('already open')){setTimeout(()=>openRoom(true,undefined,collisions+1),500);}
  } finally {if(token===attempt){connecting=false;controls();}}
}
function leaveRoom() {
  if(busy()){notice('Finish or cancel the file transfer before leaving.',true);return;}
  attempt++;resetPrepared();room?.close();room=null;members=[];connecting=false;
  $('room-info').hidden=true;roomState('closed');controls();notice('Disconnected from invitation. Main Peer 1 remains available while this page is open.');
}
function renderTrusted(){
  $('trusted-devices').replaceChildren();
  if(!trust?.contacts.length){$('trusted-devices').append(el('p','Connect once, then choose Remember device.','muted'));return;}
  for(const contact of trust.contacts){const online=trust.members().some(m=>m.deviceId===contact.id);const row=el('div',undefined,'download');const name=el('input');name.value=contact.name;name.maxLength=48;name.setAttribute('aria-label','Remembered device name');const rename=el('button','Rename','secondary'),forget=el('button','Forget','text-button');rename.onclick=()=>void trust.rename(contact.id,name.value).catch(e=>notice(e.message,true));forget.onclick=()=>{if(busy()){notice('Finish or cancel your current transfer first.',true);return;}if(confirm(`Forget ${contact.name}? You will need a new invitation to pair again.`))void trust.forget(contact.id).catch(e=>notice(e.message,true));};row.append(name,el('span',online?'● Online':'Offline','muted'),rename,forget);$('trusted-devices').append(row);}
}
let recoveryGeneration=0;
async function renderRecovery(){
  const generation=++recoveryGeneration;
  try{const list=await records.list();if(generation!==recoveryGeneration)return;$('recoveries').replaceChildren();
  const saved=list.filter(r=>!['cancelled','declined'].includes(r.state)&&!(r.direction==='send'&&r.state==='complete'));
  $('recovery-section').hidden=!saved.length;
  for(const record of saved){const row=el('article',undefined,'history-card');row.append(el('strong',record.manifest.map(f=>f.name).join(', ')),el('p',`${record.direction==='send'?'Sending':'Receiving'} · ${record.state==='complete'?'Verified files saved': 'Verified blocks preserved'}`,'muted'));
    if(record.direction==='send'){const resume=el('button','Reselect files & resume','secondary');resume.onclick=()=>{if(busy()){notice('Finish or cancel the active transfer first.',true);return;}const peer=allMembers().find(m=>m.deviceId===record.receiverId);if(!peer){notice('Reconnect the original receiver first, using Online discovery, its invitation, or remembered device.',true);return;}resumeRecord=record;const folder=record.manifest.some(f=>f.path.includes('/'));$(folder?'resume-folder-picker':'resume-picker').click();};row.append(resume);}
    else {
      if(record.storage==='directory'){const allow=el('button','Allow destination access','secondary');allow.onclick=async()=>{try{if(await record.directory.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder permission was not granted.');notice('Folder ready. Resume from the sender.');}catch(e){notice(e.message,true);}};row.append(allow);}
      if(record.files.some(f=>f.complete)){const restore=el('button','Show received files','secondary');restore.onclick=async()=>{try{const storage=await BlockStorage.open(record);for(let f=0;f<record.files.length;f++)if(record.files[f].complete)receivedFile({...record.manifest[f],...await storage.completedFile(f)});notice('Verified files shown below.');}catch(e){notice(e.message,true);}};row.append(restore);}
    }
    const remove=el('button','Remove saved data','text-button');remove.onclick=async()=>{if(busy()){notice('Finish or cancel the active transfer first.',true);return;}if(!confirm('Remove this saved transfer and its temporary browser files? Copies already saved to your chosen folder remain.'))return;try{if(record.direction==='receive'){const storage=await BlockStorage.open(record);await storage.cleanup();}await records.remove(record.id);await renderRecovery();}catch(e){notice(e.message,true);}};row.append(remove);$('recoveries').append(row);
  }}catch(e){debug('Saved progress unavailable: '+e.message);}
}
function resumeSelected(event){if(!resumeRecord||!event.target.files.length)return;files=[...event.target.files];const record=resumeRecord;resumeRecord=null;const peer=allMembers().find(m=>m.deviceId===record.receiverId);if(!peer){notice('Receiver disconnected. Reconnect and try again.',true);return;}setMode('send');try{const manifest=manifestFor(files);files=record.manifest.map(meta=>{const index=manifest.findIndex(f=>JSON.stringify(f)===JSON.stringify(meta));if(index<0)throw Error('Choose the same original files or folder to resume.');return files[index];});startSend(peer,record);}catch(e){notice(e.message,true);}event.target.value='';}
$('resume-picker').onchange=$('resume-folder-picker').onchange=resumeSelected;
$('pause').onclick=()=>active?.pause();$('resume').onclick=()=>{reconnectAttempts=0;active?.resume();};
$('debug-enabled').onchange=()=>{$('debug-log').hidden=!$('debug-enabled').checked;};
function joinInvitation(value,requireLink=false) {
  if(busy()){notice('Finish or cancel the active transfer before scanning another invitation.',true);return;}
  try {
    const invite=readInvitation(value,location.href,requireLink);
    if(room&&!room.closed&&room.code===invite.code&&(room.host||['connecting','connected','reconnecting'].includes(room.state))) {notice(room.host?'This is your current invitation. Scan the QR on the other device, or let that device scan yours.':'You already joined this invitation. Choose the receiver on the sending device.');return;}
    if(invite.mode)setMode(invite.mode);else if(!mode)setMode('send');
    $('room-code').value=invite.code;debug('Valid invitation read; connecting to its creator.');void openRoom(false,invite.code);
  } catch(e){notice(e.message||'Invalid invitation. Enter the code instead.',true);}
}
const scanner=new Scanner($('scanner-video'),value=>{ $('scanner-dialog').close();joinInvitation(value,true);},message=>{$('scanner-dialog').close();notice(message,true);});
$('scan-qr').onclick=()=>{if(busy()){notice('Finish or cancel the active transfer before scanning.',true);return;}if(!navigator.mediaDevices?.getUserMedia){notice('Camera unavailable. Enter the invitation code or paste its link.',true);return;}$('scanner-dialog').showModal();void scanner.start();};
$('stop-scan').onclick=()=>{scanner.stop();$('scanner-dialog').close();$('room-code').focus();};
$('scanner-dialog').addEventListener('close',()=>scanner.stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('scanner-dialog').open){scanner.stop();$('scanner-dialog').close();}});
$('send').onclick=()=>{if(busy())return;setMode('send');if(!room)void openRoom(true);};$('receive').onclick=()=>{if(busy())return;setMode('receive');if(!room)void openRoom(true);};
function selectFiles(e){
  if(!selectedMember||!(preparedConnection===true||preparedConnection?.open)||busy()){e.target.value='';notice('Wait until the file connection says ready before choosing files.',true);return;}
  files=[...e.target.files];
  try {if(files.length)manifestFor(files);}catch(error){files=[];e.target.value='';notice(error.message,true);}
  $('selection').textContent=files.length?`${files.length} file${files.length===1?'':'s'} · ${fmt(files.reduce((n,f)=>n+f.size,0))} · ${files.map(f=>f.name).join(', ')}`:'No files selected';renderDevices();if(files.length)startSend(selectedMember);
}
$('file-picker').onchange=$('folder-picker').onchange=selectFiles;
$('create-room').onclick=()=>openRoom(true);$('join-room').onclick=()=>joinInvitation($('room-code').value);
$('room-code').onkeydown=e=>{if(e.key==='Enter')$('join-room').click();};
$('retry-room').onclick=()=>{if(lastAttempt)openRoom(lastAttempt.host,lastAttempt.code);};
$('leave-room').onclick=$('cancel-connection').onclick=leaveRoom;
$('copy-room').onclick=async()=>{if(!room)return;try{await navigator.clipboard.writeText(room.code);notice('Code copied. Paste it on the sending device.');}catch{notice('Copy the displayed invitation code manually.');}};
$('copy-link').onclick=async()=>{if(!room)return;try{await navigator.clipboard.writeText(inviteUrl());notice('Invite link copied. Share it privately.');}catch{notice('Could not copy. Use the QR code or room code.');}};
$('share-room').hidden=!navigator.share;
$('share-room').onclick=async()=>{if(!room)return;try{await navigator.share({title:'Send files to my device',url:inviteUrl()});}catch(e){if(e.name!=='AbortError')notice('Use Copy link instead.');}};
$('cancel').onclick=()=>active?.cancel();$('decline').onclick=()=>active?.decline();
$('incoming').addEventListener('cancel',e=>{e.preventDefault();active?.decline();});
$('accept').onclick=async()=>{if(active?.state!=='offered')return;await refreshAcceptance();if($('accept').disabled)return;const destination=directory?{storage:'directory',directory}:navigator.storage?.getDirectory?{storage:'opfs'}:null;if(!destination)return;const transfer=active;await transfer.accept(destination);if(transfer.state==='failed')return;closeRequest();controls();notice(directory?'Receiving and saving automatically into your chosen folder…':'Receiving securely. Download starts automatically after verification…');};
async function chooseFolder() {
  try {directory=await window.showDirectoryPicker({mode:'readwrite',startIn:'downloads',id:'wft-receive'});$('folder-status').textContent=`Saving directly to ${directory.name}. No second download step and no browser-stored file contents.`;debug('Device folder selected.');void refreshAcceptance();}
  catch(e){if(e.name!=='AbortError')notice('Could not access folder: '+e.message,true);}
}
for(const id of ['choose-folder','request-folder']) {$(id).hidden=typeof window.showDirectoryPicker!=='function';$(id).onclick=chooseFolder;}
$('direct-save-support').textContent=typeof window.showDirectoryPicker==='function'?'Choose a folder for direct automatic saving. If you do not choose one, supported browsers use temporary private storage and trigger the verified file download automatically.':'This browser will use temporary private storage when available and trigger the verified file download automatically.';
$('clear-history').onclick=()=>{if(!busy()){history=[];save();drawHistory();}};
$('keep-awake').onchange=()=>void maintainWakeLock();
$('network-check').onclick=async()=>{
  $('network-check').disabled=true;$('network-result').textContent='Checking connection routes (up to 12 seconds)…';
  try {latestDiagnosis=await connectionDiagnosis(12000);$('network-result').textContent=latestDiagnosis.summary;}
  catch(e){$('network-result').textContent='Network check failed: '+e.message;}finally{$('network-check').disabled=false;}
};
try {$('device-name').value=localStorage.getItem('wft-device-name')||friendlyName();}catch{$('device-name').value=friendlyName();}
$('device-name').onchange=()=>{const name=$('device-name').value.trim().slice(0,48)||friendlyName();$('device-name').value=name;try{localStorage.setItem('wft-device-name',name);}catch{}if(room){room.name=name;room.setMode(mode);}if(trust){trust.name=name;for(const {room:r} of trust.rooms.values()){r.name=name;r.setMode(mode||'send');}}mainPeer?.setName(name);void presence?.setIdentity({name,peer1Id:mainPeer?.peer?.id||''}).catch(e=>debug(e.message));};
trust=new TrustedDevices({id:deviceId,name:$('device-name').value,mode:'send',onChange:()=>{renderDevices();renderTrusted();},onTransfer:awaitTransfer});
debug('Startup: preparing identity and remembered devices.');
void cleanupApplicationStorage().then(()=>networkReady).then(()=>trust.load()).then(()=>{if(!mode)notice('Choose Send Files or Receive Files. Turn Online on to discover current users.');void connectionDiagnosis().then(result=>{latestDiagnosis=result;$('network-result').textContent=result.summary;debug('Automatic connection check: '+result.summary);});}).catch(e=>notice('Application startup issue: '+e.message,true));
function consumeInvitation(){const params=new URLSearchParams(location.hash.slice(1));if(!(params.get('join')||params.get('room')))return;const value=location.href;window.history.replaceState(null,'',location.pathname+location.search);joinInvitation(value,true);}
$('refresh-devices').onclick=async()=>{$('refresh-devices').disabled=true;debug('Checking remembered devices again.');try{await networkReady;await trust.load();renderDevices();}catch(e){notice(e.message,true);}finally{$('refresh-devices').disabled=false;}};
consumeInvitation();window.addEventListener('hashchange',consumeInvitation);
$('online-toggle').onchange=()=>void setOnline($('online-toggle').checked);
window.addEventListener('storage',e=>{if(e.key==='wft-online-enabled')void setOnline(e.newValue==='1');});
window.addEventListener('beforeunload',event=>{if(busy()){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{void presence?.stop();void mainPeer?.stop();});
window.addEventListener('offline',()=>notice('Internet connection lost. Existing transfers may continue; new pairing needs internet.',true));
window.addEventListener('online',()=>{if(!busy())notice('Internet is back. Use Retry connection if your room is disconnected.');});
document.addEventListener('visibilitychange',()=>{void maintainWakeLock();});
if(!window.isSecureContext||!window.RTCPeerConnection) {
  notice('Use this app in a modern browser over HTTPS. This browser cannot establish secure file transfers.',true);
  $('create-room').disabled=$('join-room').disabled=true;
}
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
drawHistory();renderDevices();renderOnlineUsers();void renderRecovery();setInterval(()=>{if(room)renderInvite();},30000);
try{if(localStorage.getItem('wft-online-enabled')==='1')void setOnline(true);}catch{}
