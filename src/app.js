import {Room,newCode,parseRoom,probeNetwork,peerOptions} from './room.js';
import {BlockTransfer,manifestFor} from './block-transfer.js';
import {records,BlockStorage} from './storage.js';
import {TrustedDevices,identity,friendlyName} from './devices.js';
import {Scanner} from './qr.js';
import {configureNetwork} from './network.js';
import qrcode from 'qrcode-generator';

const $ = id => document.getElementById(id);
const fmt = n => n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1073741824?`${(n/1048576).toFixed(1)} MB`:`${(n/1073741824).toFixed(2)} GB`;
let room, mode=null, files=[], members=[], active, directory,trust,resumeRecord;
let selectedMember,preparedConnection,preparingDevice=false,prepareGeneration=0;
const pendingReceivers=new Map();
const deviceId=identity();let reconnectTimer,reconnectAttempts=0;
let connecting=false, attempt=0, lastAttempt, wakeLock, acquiringWake=false;
const downloads=[], cards=new Map();
let history=[];
try {
  const stored=JSON.parse(localStorage.getItem('wft-history-v2')||'[]');
  history=Array.isArray(stored)?stored.filter(x=>x&&typeof x.id==='string'&&Array.isArray(x.files)&&x.files.every(f=>f&&typeof f.name==='string')).slice(0,50):[];
} catch {}
for(const row of history) if(!['complete','failed','declined','cancelled'].includes(row.state)) {
  row.state='reconnecting'; row.detail='Check Saved progress to resume an interrupted transfer.';
}
function notice(text,error=false) { $('status').textContent=text; $('status').className=error?'status error':'status'; }
function debug(text){if(!$('debug-enabled').checked)return;const log=$('debug-log');log.textContent=(log.textContent+'\n'+new Date().toLocaleTimeString()+' '+text).split('\n').slice(-100).join('\n');}
const networkReady=configureNetwork().catch(e=>debug(e.message));
function save() { try {localStorage.setItem('wft-history-v2',JSON.stringify(history.slice(0,50)));} catch {} }
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
  c.label.textContent=`${stateLabel[row.state]||row.state} · ${fmt(row.bytes||0)} / ${fmt(row.total||0)}${row.speed?' · '+fmt(row.speed)+'/s':''}${row.eta?' · about '+Math.ceil(row.eta/60)+' min left':''}${row.state==='verifying'?' · '+fmt(row.verifiedBytes||0)+' checked':''}${row.detail?' · '+row.detail:''}`;
}
function setMode(next) {
  if(busy()) {notice('Finish or cancel this transfer before changing mode.',true);return;}
  mode=next;room?.setMode(mode);trust?.setMode(mode);
  if(next!=='send')resetPrepared();
  if(next!=='receive')for(const connection of pendingReceivers.values())connection.close();
  for(const name of ['send','receive']) {$(name).classList.toggle('selected',mode===name);$(name).setAttribute('aria-pressed',mode===name);}
  $('pairing-panel').hidden=!mode;$('receive-panel').hidden=mode!=='receive';
  $('setup-hint').textContent='Both devices have a QR and a scanner. Scan either QR, or enter the other device’s code. Connect before selecting files.';
  renderDevices();renderInvite();
}
function renderDevices() {
  $('devices').replaceChildren();
  const available=allMembers();
  const checking=[...(trust?.rooms.values()||[])].some(entry=>['connecting','reconnecting'].includes(entry.room.state));
  $('discovery-status').textContent=available.length?`${available.length} connected device${available.length===1?'':'s'} found. Choose a receiver before selecting files.`:checking?'Checking your remembered devices…':'No invited or remembered devices online yet. Scan a QR or enter a connection code.';
  if(selectedMember&&!busy()&&!available.some(m=>m.deviceId===selectedMember.deviceId&&m.mode==='receive'))resetPrepared();
  const ready=mode==='send'&&selectedMember&&preparedConnection?.open;
  $('send-panel').hidden=!ready&&!busy();
  if(mode!=='send')$('send-panel').hidden=true;
  $('file-picker').disabled=$('folder-picker').disabled=!ready||!!busy();
  $('target-name').textContent=selectedMember?`Connected to ${selectedMember.name}. Select files to request transfer immediately.`:'Connect to a receiver first.';
  for(const m of available) {
    const receive=m.mode==='receive'; const b=el('button',undefined,'device');
    b.append(el('span','▣','device-icon'),el('strong',m.name),el('span',!receive?'Sender · choose Receive on this device to get files':selectedMember?.deviceId===m.deviceId&&ready?'Connected · choose files below':preparingDevice?'Connecting…':'Connect to this receiver →','muted'));
    b.disabled=!receive||!!busy()||preparingDevice;b.onclick=()=>prepareReceiver(m);$('devices').append(b);
  }
  $('connected-panel').hidden=!available.length;$('connected-devices').replaceChildren();
  for(const m of available){const row=el('div',undefined,'download');row.append(el('span',m.name+(m.trusted?' · Remembered':'')));if(!m.trusted&&!trust?.contacts.some(c=>c.id===m.deviceId)){const remember=el('button','Remember device','secondary');remember.onclick=async()=>{remember.disabled=true;try{await trust.remember(m);notice('Device remembered. Next time, open this page on both devices.');}catch(e){notice(e.message,true);}finally{remember.disabled=false;}};row.append(remember);}$('connected-devices').append(row);}
}
function allMembers(){const combined=[...(trust?.members()||[]),...members.map(m=>({...m,room}))];return combined.filter((m,i)=>combined.findIndex(x=>x.deviceId===m.deviceId)===i);}
function inviteUrl() {
  const url=new URL(location.href);url.hash=new URLSearchParams({join:room.code,mode:mode==='send'?'receive':'send'}).toString();return url.href;
}
function renderInvite() {
  if(!room?.id||room.closed)return;
  const qr=qrcode(0,'M');qr.addData(inviteUrl());qr.make();$('room-qr').src=qr.createDataURL(4,8);
  $('current-room').textContent=room.code.match(/.{1,4}/g).join('-');
  const remaining=Math.ceil((room.expires-Date.now())/60000);$('room-note').textContent=remaining>0?`New devices can join for ${remaining} more minute${remaining===1?'':'s'}. Keep this page open.`:'Invitation expired for new devices. Tap New invitation. Connected devices can finish.';
  $('room-qr').hidden=remaining<=0;
}
function roomState(state,detail='') {
  debug('Connection: '+state);
  $('connection-state').textContent={idle:'Not connected',connecting:'Connecting…',connected:'Connected',reconnecting:'Reconnecting…',disconnected:'Disconnected',closed:'Not connected'}[state]||state;
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
  $('accept').disabled=!directory;
  $('request-note').textContent=directory?`Files will save directly to ${directory.name}. Allow about ${fmt(active.total*2)} free disk space during verification. No file contents are stored in browser storage.`:typeof window.showDirectoryPicker==='function'?'Choose a device folder below, then accept. File contents will not be kept in browser storage.':'This browser cannot write directly to a device folder. Receive using desktop Chrome or Edge. You can still send files from this browser.';
}
function receivedFile(file) {
  const line=el('div',undefined,'download');
  if(file.blob) {
    const url=URL.createObjectURL(file.blob),item={url,size:file.blob.size};downloads.push(item);
    const name=el('span',`${file.name} · ${fmt(file.size)}`),actions=el('div',undefined,'download-actions');
    const a=el('a','Save to device','save-file');a.href=url;a.download=file.name;
    const remove=el('button','Hide','secondary');
    remove.onclick=()=>{URL.revokeObjectURL(url);downloads.splice(downloads.indexOf(item),1);line.remove();void refreshAcceptance();$('download-memory').textContent=`${fmt(retainedBytes())} shown here. Use Saved progress to restore hidden files or remove stored data.`;};
    actions.append(a,remove);line.append(name,actions);
  } else line.append(el('span',`✓ Saved ${file.savedName} to your chosen folder`));
  $('downloads').append(line);$('received-section').hidden=false;
    $('download-memory').textContent=file.blob?`${fmt(retainedBytes())} from older browser-stored transfers.`:'Files are already saved in your chosen device folder.';
}
function track(conn,member,outgoing,record) {
  active?.conn.close();
  const row={id:record?.transferId||conn.metadata?.transferId||crypto.randomUUID(),peer:member.name,direction:outgoing?'send':'receive',state:'connecting',files:[],bytes:0,total:0,time:new Date().toISOString()};
  history.unshift(row);history=history.slice(0,50);drawHistory();save();
  $('history').closest('details').open=true;
  const t=new BlockTransfer(conn,{files:outgoing?[...files]:undefined,record,id:record?.transferId||conn.metadata?.transferId,senderId:outgoing?deviceId:member.deviceId,receiverId:outgoing?member.deviceId:deviceId,reselected:!!record,requireDirectory:!outgoing,onUpdate:update=>{
    const changed=row.state!==update.state,advanced=update.bytes>row.bytes;Object.assign(row,update);updateCard(row);if(changed){save();debug(`${update.direction} ${update.state}: ${fmt(update.bytes)} verified bytes`);}else if(advanced)debug(`${update.direction}: ${fmt(update.bytes)} acknowledged and saved`);
    const terminal=['complete','failed','cancelled','declined'].includes(update.state);
    if(terminal) {
      save();closeRequest();
      clearTimeout(reconnectTimer);reconnectAttempts=0;void renderRecovery();
      notice(update.state==='complete'?(outgoing?'Delivered. The receiver verified and saved all files.':'Received and saved directly to your device folder.'):update.detail,update.state!=='complete');
      if(!outgoing&&update.state==='complete')$('received-section').scrollIntoView({behavior:'smooth',block:'center'});
    } else if(update.state==='transferring')notice(`${outgoing?'Sending':'Receiving'}: ${fmt(update.bytes)} of ${fmt(update.total)}. Keep both pages open.`);
    controls();
  },onInterrupted:transfer=>scheduleReconnect(transfer,member),onOffer:manifest=>{
    $('request-title').textContent=`${member.name} wants to send ${manifest.length} file${manifest.length===1?'':'s'}`;
    $('request-files').textContent=manifest.map(f=>`${f.name} (${fmt(f.size)})`).join('\n');
    void refreshAcceptance();$('incoming').showModal();$('decline').focus();
  },onFile:receivedFile});
  active=t;controls();return t;
}
function startSend(member,record) {
  if(busy())return;
  try {manifestFor(files);const id=record?.transferId||crypto.randomUUID();const connection=!record&&preparedConnection?.open&&selectedMember?.deviceId===member.deviceId?preparedConnection:member.room.connect(member.id,id);track(connection,member,true,record);debug('Files selected; transfer request sent without a separate upload.');notice(`Waiting for ${member.name} to accept. Sending starts immediately after acceptance.`);}
  catch(e) {notice(e.message,true);}
}
function resetPrepared(){prepareGeneration++;const conn=preparedConnection;preparedConnection=null;selectedMember=null;preparingDevice=false;if(conn&&conn!==active?.conn)conn.close();}
function prepareReceiver(member){
  if(busy())return;if(preparedConnection?.open&&selectedMember?.deviceId===member.deviceId){$('send-panel').scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(mode!=='send')setMode('send');resetPrepared();const generation=prepareGeneration;preparingDevice=true;renderDevices();
  try{const conn=member.room.connect(member.id,crypto.randomUUID());preparedConnection=conn;const timer=setTimeout(()=>{if(generation===prepareGeneration&&!conn.open){resetPrepared();notice('Could not connect to this receiver. Try again.',true);renderDevices();}},25000);
    const opened=()=>{clearTimeout(timer);if(generation!==prepareGeneration){conn.close();return;}selectedMember=member;preparingDevice=false;debug('File channel ready before file selection.');notice(`Connected to ${member.name}. Choose files now; there is no separate upload step.`);renderDevices();};
    conn.on('open',opened);if(conn.open)opened();conn.on('close',()=>{clearTimeout(timer);if(preparedConnection===conn){preparedConnection=null;preparingDevice=false;renderDevices();}});conn.on('error',()=>{clearTimeout(timer);if(generation===prepareGeneration&&!busy()){resetPrepared();notice('Receiver connection failed. Try connecting again.',true);renderDevices();}});
  }catch(e){resetPrepared();notice(e.message,true);renderDevices();}
}
function awaitTransfer(conn,member){
  // Establish the channel before opening the picker; consent is still required
  // when the actual manifest arrives. Never instantiate a transfer for idle peers.
  const existing=pendingReceivers.get(conn.peer);existing?.close();if(pendingReceivers.size>=4&&!existing){conn.close();return;}pendingReceivers.set(conn.peer,conn);
  const clean=()=>{clearTimeout(timer);if(pendingReceivers.get(conn.peer)===conn)pendingReceivers.delete(conn.peer);};
  const timer=setTimeout(()=>{clean();conn.close();},300000);conn.on('close',clean);conn.on('error',clean);
  conn.once('data',raw=>{clean();let message;try{message=typeof raw==='string'&&raw.length<49152?JSON.parse(raw):null;}catch{}if(message?.type!=='hello'){conn.close();return;}incoming(conn,member);conn.emit('data',raw);});
}
function scheduleReconnect(t,member){if(t!==active||t.terminal()||t.direction!=='send')return;clearTimeout(reconnectTimer);if(reconnectAttempts>=4){notice('Automatic retries stopped. Keep both pages open, reconnect if needed, then tap Resume.',true);return;}reconnectTimer=setTimeout(()=>{if(t!==active||t.terminal())return;reconnectAttempts++;const current=allMembers().find(m=>m.deviceId===member.deviceId&&m.mode==='receive');try{if(!current)throw Error('Receiver offline');debug('Reconnection attempt '+reconnectAttempts);t.attach(current.room.connect(current.id,t.id));setTimeout(()=>{if(t===active&&t.state==='connecting'){t.interrupted('Connection retry timed out.');}},25000);}catch{scheduleReconnect(t,member);}},[1000,3000,8000,15000][reconnectAttempts]);}
function incoming(conn,m){if(busy()){if(active.direction==='receive'&&conn.metadata?.transferId===active.id&&m.deviceId===active.record?.senderId){active.attach(conn);return;}if(conn.open)conn.close();else conn.on('open',()=>conn.close());return;}if(conn.metadata?.kind!=='file-v3'){conn.close();return;}track(conn,m,false);}
async function openRoom(host,codeOverride,collisions=0) {
  if(busy()&&active.state!=='reconnecting'||connecting)return;
  let code;try{code=host?(codeOverride||newCode()):parseRoom(codeOverride||$('room-code').value);}catch(e){notice(e.message,true);$('room-code').focus();return;}
  if(!mode)setMode('send');
  const token=++attempt;
  if(!busy())resetPrepared();room?.close();members=[];connecting=true;lastAttempt={host,code};controls();
  $('room-info').hidden=true;roomState('connecting','Connecting to the other device…');
  const candidate=new Room({
    onMembers:list=>{if(token!==attempt)return;members=list;renderDevices();},
    onError:msg=>{if(token===attempt)notice(msg,true);},
    onState:(state,detail)=>{if(token===attempt)roomState(state,detail);},
    onTransfer:(conn,m)=>{if(token!==attempt){conn.close();return;}awaitTransfer(conn,{...m,room:candidate});},
    onMessage:async(message,m,reply)=>{if(message?.type!=='remember'||busy()){reply({accepted:false});return;}if(!confirm(`Remember ${m.name}? They will be able to find this device when both pages are open. You still approve each file transfer.`)){reply({accepted:false});return;}try{await trust.add(m,message.secret);reply({accepted:true});notice('Device remembered.');}catch(e){reply({accepted:false});notice(e.message,true);}}
  },{deviceId});room=candidate;
  try {
    await networkReady;
    await candidate.open(code,host,$('device-name').value.trim()||'My device',mode);
    if(token!==attempt)return;
    $('room-code').value=code;$('room-info').hidden=false;renderInvite();
    notice(active?.state==='reconnecting'?'Reconnected. Tap Resume to continue your saved transfer.':mode==='receive'?'Ready. Scan this invitation on the sending device.':'Connected. Choose your files, then tap the receiver.');
  } catch(e) {
    if(token!==attempt)return;
    candidate.close();room=null;members=[];$('room-info').hidden=true;
    roomState('disconnected',e.message.replaceAll('room','invitation'));$('retry-room').hidden=false;
    if(host&&!codeOverride&&collisions<3&&e.message.includes('already open')){setTimeout(()=>openRoom(true,undefined,collisions+1),500);}
  } finally {if(token===attempt){connecting=false;controls();}}
}
function leaveRoom() {
  if(busy()){notice('Finish or cancel the file transfer before leaving.',true);return;}
  attempt++;resetPrepared();room?.close();room=null;members=[];connecting=false;
  $('room-info').hidden=true;roomState('closed');controls();notice('Disconnected. Receive Files creates a new invitation.');
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
    if(record.direction==='send'){const resume=el('button','Reselect files & resume','secondary');resume.onclick=()=>{if(busy()){notice('Finish or cancel the active transfer first.',true);return;}const peer=allMembers().find(m=>m.deviceId===record.receiverId&&m.mode==='receive');if(!peer){notice('Reconnect the original receiver first, using its invitation or remembered device.',true);return;}resumeRecord=record;const folder=record.manifest.some(f=>f.path.includes('/'));$(folder?'resume-folder-picker':'resume-picker').click();};row.append(resume);}
    else {
      if(record.storage==='directory'){const allow=el('button','Allow destination access','secondary');allow.onclick=async()=>{try{if(await record.directory.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder permission was not granted.');notice('Folder ready. Resume from the sender.');}catch(e){notice(e.message,true);}};row.append(allow);}
      if(record.files.some(f=>f.complete)){const restore=el('button','Show received files','secondary');restore.onclick=async()=>{try{const storage=await BlockStorage.open(record);for(let f=0;f<record.files.length;f++)if(record.files[f].complete)receivedFile({...record.manifest[f],...await storage.completedFile(f)});notice('Verified files shown below.');}catch(e){notice(e.message,true);}};row.append(restore);}
    }
    const remove=el('button','Remove saved data','text-button');remove.onclick=async()=>{if(busy()){notice('Finish or cancel the active transfer first.',true);return;}if(!confirm('Remove this saved transfer and its temporary browser files? Copies already saved to your chosen folder remain.'))return;try{if(record.direction==='receive'){const storage=await BlockStorage.open(record);await storage.cleanup();}await records.remove(record.id);await renderRecovery();}catch(e){notice(e.message,true);}};row.append(remove);$('recoveries').append(row);
  }}catch(e){debug('Saved progress unavailable: '+e.message);}
}
function resumeSelected(event){if(!resumeRecord||!event.target.files.length)return;files=[...event.target.files];const record=resumeRecord;resumeRecord=null;const peer=allMembers().find(m=>m.deviceId===record.receiverId&&m.mode==='receive');if(!peer){notice('Receiver disconnected. Reconnect and try again.',true);return;}setMode('send');try{const manifest=manifestFor(files);files=record.manifest.map(meta=>{const index=manifest.findIndex(f=>JSON.stringify(f)===JSON.stringify(meta));if(index<0)throw Error('Choose the same original files or folder to resume.');return files[index];});startSend(peer,record);}catch(e){notice(e.message,true);}event.target.value='';}
$('resume-picker').onchange=$('resume-folder-picker').onchange=resumeSelected;
$('pause').onclick=()=>active?.pause();$('resume').onclick=()=>{reconnectAttempts=0;active?.resume();};
$('debug-enabled').onchange=()=>{$('debug-log').hidden=!$('debug-enabled').checked;};
const scanner=new Scanner($('scanner-video'),value=>{ $('scanner-dialog').close();try{const url=new URL(value);if(url.origin!==location.origin||url.pathname!==location.pathname)throw Error('That QR is not an invitation for this app.');applyInviteMode(url);$('room-code').value=parseRoom(value);void openRoom(false);}catch(e){notice(e.message||'Invalid invitation QR. Enter the code instead.',true);}},message=>{$('scanner-dialog').close();notice(message,true);});
$('scan-qr').onclick=()=>{if(!navigator.mediaDevices?.getUserMedia){notice('Camera unavailable. Enter the invitation code or paste its link.',true);return;}$('scanner-dialog').showModal();void scanner.start();};
$('stop-scan').onclick=()=>{scanner.stop();$('scanner-dialog').close();$('room-code').focus();};
$('scanner-dialog').addEventListener('close',()=>scanner.stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('scanner-dialog').open){scanner.stop();$('scanner-dialog').close();}});
$('send').onclick=()=>{if(busy())return;setMode('send');if(!room)void openRoom(true);};$('receive').onclick=()=>{if(busy())return;setMode('receive');if(!room)void openRoom(true);};
function selectFiles(e){
  if(!selectedMember||!preparedConnection?.open||busy()){e.target.value='';notice('Connect to a receiver before selecting files.',true);return;}
  files=[...e.target.files];
  try {if(files.length)manifestFor(files);}
  catch(error){files=[];e.target.value='';notice(error.message,true);}
  $('selection').textContent=files.length?`${files.length} file${files.length===1?'':'s'} · ${fmt(files.reduce((n,f)=>n+f.size,0))} · ${files.map(f=>f.name).join(', ')}`:'No files selected';renderDevices();if(files.length)startSend(selectedMember);
}
$('file-picker').onchange=$('folder-picker').onchange=selectFiles;
$('create-room').onclick=()=>openRoom(true);$('join-room').onclick=()=>{try{if(/^https?:/.test($('room-code').value.trim()))applyInviteMode(new URL($('room-code').value.trim()));}catch{}void openRoom(false);};
$('room-code').onkeydown=e=>{if(e.key==='Enter')$('join-room').click();};
$('retry-room').onclick=()=>{if(lastAttempt)openRoom(lastAttempt.host,lastAttempt.code);};
$('leave-room').onclick=$('cancel-connection').onclick=leaveRoom;
$('copy-room').onclick=async()=>{if(!room)return;try{await navigator.clipboard.writeText(room.code);notice('Code copied. Paste it on the sending device.');}catch{notice('Copy the displayed invitation code manually.');}};
$('copy-link').onclick=async()=>{if(!room)return;try{await navigator.clipboard.writeText(inviteUrl());notice('Invite link copied. Share it privately.');}catch{notice('Could not copy. Use the QR code or room code.');}};
$('share-room').hidden=!navigator.share;
$('share-room').onclick=async()=>{if(!room)return;try{await navigator.share({title:'Send files to my device',url:inviteUrl()});}catch(e){if(e.name!=='AbortError')notice('Use Copy link instead.');}};
$('cancel').onclick=()=>active?.cancel();$('decline').onclick=()=>active?.decline();
$('incoming').addEventListener('cancel',e=>{e.preventDefault();active?.decline();});
$('accept').onclick=async()=>{
  if(active?.state!=='offered')return;await refreshAcceptance();if($('accept').disabled)return;
  void active.accept({storage:'directory',directory});closeRequest();controls();notice('Receiving directly into your device folder…');
};
async function chooseFolder() {
  try {directory=await window.showDirectoryPicker({mode:'readwrite',startIn:'downloads',id:'wft-receive'});$('folder-status').textContent=`Saving directly to ${directory.name}. No second download step and no browser-stored file contents.`;debug('Device folder selected.');void refreshAcceptance();}
  catch(e){if(e.name!=='AbortError')notice('Could not access folder: '+e.message,true);}
}
for(const id of ['choose-folder','request-folder']) {$(id).hidden=typeof window.showDirectoryPicker!=='function';$(id).onclick=chooseFolder;}
$('direct-save-support').textContent=typeof window.showDirectoryPicker==='function'?'Browser permission is required once to choose a folder. Transfer progress metadata is stored locally for recovery; file contents stay in your selected folder.':'Direct device-folder saving is not supported by this browser. You can send here; to receive without browser storage, use desktop Chrome or Edge.';
$('clear-history').onclick=()=>{if(!busy()){history=[];save();drawHistory();}};
$('keep-awake').onchange=()=>void maintainWakeLock();
$('network-check').onclick=async()=>{
  $('network-check').disabled=true;$('network-result').textContent='Checking connection routes (up to 12 seconds)…';
  try {const result=await probeNetwork(),configured=peerOptions().config.iceServers.some(s=>[s.urls].flat().some(u=>/^turns?:/.test(u)));$('network-result').textContent=`Local connection: ${result.local?'available':'not found'}. Internet connection setup: ${result.stun?'available':'not found'}. Encrypted relay: ${result.relay?'available':configured?'not reachable on this check':'not configured'}. ${result.relay?'Relay fallback can help if direct transfer is blocked.':'If direct pairing fails, try private Wi-Fi without VPN, or ask the site owner to configure a working relay. The former free PeerJS relay is retired.'} This check cannot guarantee connectivity to another device.`;}
  catch(e){$('network-result').textContent='Network check failed: '+e.message;}
  finally{$('network-check').disabled=false;}
};
try {$('device-name').value=localStorage.getItem('wft-device-name')||friendlyName();}catch{$('device-name').value=friendlyName();}
$('device-name').onchange=()=>{const name=$('device-name').value.trim().slice(0,48)||friendlyName();$('device-name').value=name;try{localStorage.setItem('wft-device-name',name);}catch{}if(room){room.name=name;room.setMode(mode);}if(trust){trust.name=name;for(const {room:r} of trust.rooms.values()){r.name=name;r.setMode(mode||'send');}}};
trust=new TrustedDevices({id:deviceId,name:$('device-name').value,mode:'send',onChange:()=>{renderDevices();renderTrusted();},onTransfer:awaitTransfer});
debug('Startup: checking private remembered-device connections.');
void networkReady.then(()=>trust.load()).then(()=>{if(!mode)notice('Choose Send Files or Receive Files. Remembered devices appear automatically when online.');}).catch(()=>notice('Recovery metadata storage is unavailable. Enable site storage to transfer files.',true));
function applyInviteMode(url){const requested=new URLSearchParams(url.hash.slice(1)).get('mode');if(['send','receive'].includes(requested))setMode(requested);else if(!mode)setMode('send');}
function consumeInvitation(){const params=new URLSearchParams(location.hash.slice(1));if(!(params.get('join')||params.get('room')))return;if(busy()&&active.state!=='reconnecting'){notice('Finish or cancel the active transfer before opening another invitation.',true);return;}$('room-code').value=params.get('join')||params.get('room');applyInviteMode(new URL(location.href));window.history.replaceState(null,'',location.pathname+location.search);void openRoom(false);}
$('refresh-devices').onclick=async()=>{$('refresh-devices').disabled=true;debug('Checking remembered devices again.');try{await networkReady;await trust.load();renderDevices();}catch(e){notice(e.message,true);}finally{$('refresh-devices').disabled=false;}};
consumeInvitation();window.addEventListener('hashchange',consumeInvitation);
window.addEventListener('beforeunload',event=>{if(busy()){event.preventDefault();event.returnValue='';}});
window.addEventListener('offline',()=>notice('Internet connection lost. Existing transfers may continue; new pairing needs internet.',true));
window.addEventListener('online',()=>{if(!busy())notice('Internet is back. Use Retry connection if your room is disconnected.');});
document.addEventListener('visibilitychange',()=>{void maintainWakeLock();});
if(!window.isSecureContext||!window.RTCPeerConnection) {
  notice('Use this app in a modern browser over HTTPS. This browser cannot establish secure file transfers.',true);
  $('create-room').disabled=$('join-room').disabled=true;
}
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
drawHistory();renderDevices();void renderRecovery();setInterval(()=>{if(room?.host)renderInvite();},30000);
