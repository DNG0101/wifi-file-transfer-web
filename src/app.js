import {folderArchive} from './folder-archive.js';
import {transferBatches} from './send-queue.js';
import {Room,newCode,parseRoom} from './room.js';
import {BlockTransfer,manifestFor} from './block-transfer.js';
import {records,BlockStorage,storageAvailability} from './storage.js';
import {TrustedDevices,identity,friendlyName} from './devices.js';
import {Scanner} from './qr.js';
import {readInvitation,invitationUrl} from './invitation.js';
import {PresencePeerManager} from './presence-peer.js';
import {MainPeerManager} from './main-peer.js';
import {configureNetwork} from './network.js';
import {connectionDiagnosis,failedChannelMessage} from './connection-health.js';
import qrcode from 'qrcode-generator';

const $ = id => document.getElementById(id);
const number=(n,digits=0)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:digits}).format(n);
const fmt = n => n<1024?`${number(n)} B`:n<1048576?`${number(n/1024,1)} KB`:n<1073741824?`${number(n/1048576,1)} MB`:`${number(n/1073741824,2)} GB`;
const transfers=new Map(),peerQueues=new Map(),cancelBarriers=new Map(),cancelledTransfers=new Map();
let offeredTransfer=null,preparingSelection=false;
let room, mode=null, files=[], members=[], active, directory,trust,resumeRecord;
let selectedMember,preparedConnection,preparingDevice=false,prepareGeneration=0,latestDiagnosis;
const deviceId=identity();let presence,mainPeer,onlineUsers=[];const connectedOnline=new Map();
let onlineRetryTimer;
let connecting=false, attempt=0, lastAttempt, wakeLock, acquiringWake=false, pendingConnectionDecision;
const connectionRequests=[];
const downloads=[], cards=new Map();
let history=[];
function notice(text,error=false) { $('status').textContent=text; $('status').className=error?'status error':'status'; }
function debug(text){if(!$('debug-enabled').checked)return;const log=$('debug-log');log.textContent=(log.textContent+'\n'+new Date().toLocaleTimeString()+' '+text).split('\n').slice(-100).join('\n');}
function requestConnectionApproval(member){
 return new Promise(resolve=>{connectionRequests.push({member,resolve});showConnectionRequest();});
}
function showConnectionRequest(){
 if(pendingConnectionDecision||!connectionRequests.length)return;
 const {member,resolve}=connectionRequests.shift();
 $('connection-request-note').textContent=`${member.name} wants to connect. Accepting permits either device to request file transfers; every transfer will still need separate approval.`;
 $('connection-request').showModal();$('reject-connection').focus();notice(`Connection request from ${member.name}. Accept or reject it.`);
 pendingConnectionDecision=accepted=>{pendingConnectionDecision=null;if($('connection-request').open)$('connection-request').close();resolve(accepted);setTimeout(showConnectionRequest,0);};
}
$('accept-connection').onclick=()=>pendingConnectionDecision?.(true);
$('reject-connection').onclick=()=>pendingConnectionDecision?.(false);
$('connection-request').addEventListener('cancel',event=>{event.preventDefault();pendingConnectionDecision?.(false);});
const directoryRoom={cancelTransfer:(peer,id)=>mainPeer.cancelTransfer(peer,id),connect:(id,transferId)=>mainPeer.connect(id,transferId),probe:(id,timeout)=>mainPeer.probe(id,timeout)};
function directoryMember(user){return {id:user.peerId,deviceId:user.uuid,name:user.name,mode:'receive',onlineDirectory:true,room:directoryRoom};}
function renderOnlineUsers(users=[]){
 onlineUsers=users.filter((u,i)=>u.uuid!==deviceId&&users.findIndex(x=>x.uuid===u.uuid)===i);
 $('online-users').replaceChildren();
 if(!onlineUsers.length){$('online-users').append(el('p',$('online-toggle').checked?'No online users found yet. Keep this page open.':'Turn Online on to see available users.','muted'));renderDevices();return;}
 for(const user of onlineUsers){
  const row=el('div',undefined,'online-user'),identity=el('div');identity.append(el('strong',user.name),el('small',connectedOnline.has(user.uuid)?'Connected · send or receive':user.peerId?'Available to connect':'Starting…'));
  row.append(identity);
  if(user.uuid!==deviceId&&user.peerId){const connected=connectedOnline.has(user.uuid),connect=el('button',connected?'Disconnect':'Connect','secondary');connect.onclick=async()=>{if(connected){disconnectDevice(connectedOnline.get(user.uuid)||directoryMember(user));return;}connect.disabled=true;connect.textContent='Waiting for approval…';try{await ensureMainPeer();const member=directoryMember(user);await mainPeer.requestConnection(user.peerId,member);connectedOnline.set(user.uuid,member);notice(`${user.name} accepted the connection. Either device can now send.`);renderOnlineUsers(onlineUsers);renderDevices();}catch(e){notice(e.message,true);connect.disabled=false;connect.textContent='Connect';}};row.append(connect);}
  $('online-users').append(row);
 }
 renderDevices();
}
function presenceState(state,detail){$('online-state').textContent=detail||state;debug('Online presence: '+state);}
async function ensureMainPeer(){
 await nameReady;await startupStorageReady;await networkReady;
 if(!mainPeer)mainPeer=new MainPeerManager({uuid:deviceId,name:$('device-name').value,onIncoming:(conn,m)=>awaitTransfer(conn,{...m,room:directoryRoom}),onConnectionRequest:requestConnectionApproval,onCancel:remoteCancel,onConnected:member=>{connectedOnline.set(member.deviceId,{...member,room:directoryRoom});notice(`${member.name} connected. Either device can send or receive files.`);$('connection-state').textContent='Connected · send or receive';renderOnlineUsers(onlineUsers);},onDisconnected:member=>{connectedOnline.delete(member.deviceId);$('connection-state').textContent=allMembers().length?'Connected · send or receive':'Disconnected';renderOnlineUsers(onlineUsers);},onState:(state,detail)=>debug(`Main Peer 1 ${state}${detail?' · '+detail:''}`)});
 const id=await mainPeer.start();
 if(!mainPeer.leader||!mainPeer.peer)throw Error('Online connection is active in another tab. Use that tab, or close it and retry here.');
 return id;
}
async function setOnline(enabled){
 clearTimeout(onlineRetryTimer);
 $('online-toggle').checked=enabled;
 if(enabled){
  try{
   const peer1Id=await ensureMainPeer();
   if(!presence)presence=new PresencePeerManager({uuid:deviceId,name:$('device-name').value,peer1Id,onChange:renderOnlineUsers,onState:presenceState});
   else await presence.setIdentity({name:$('device-name').value,peer1Id});
   await presence.start();
  }catch(e){presenceState('failed',e.message+' Tap Check again to retry.');onlineUsers=[];renderOnlineUsers([]);}
 } else {await presence?.stop();onlineUsers=[];renderOnlineUsers([]);}
}
const networkReady=configureNetwork().catch(e=>debug(e.message));
function save() {}
function el(tag,text,className) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;e.dir='auto';if(className)e.className=className;return e;}
const busy = () => [...transfers.values()].some(entry=>!entry.transfer.terminal());
const sendingTo=id=>[...transfers.values()].some(e=>e.member.deviceId===id&&e.transfer.direction==='send'&&!e.transfer.terminal());
function remoteCancel(id,member){
 const entry=transfers.get(id);
 if(entry&&entry.member.deviceId===member.deviceId){entry.transfer.cancel(false);return true;}
 return cancelledTransfers.get(id)===member.deviceId;
}
async function notifyCancellation(id,member){
 if(member.room.cancelTransfer)return member.room.cancelTransfer(member.id,id);
 return (await member.room.message(member.id,{type:'transfer-cancel',id}))?.cancelled===true;
}
const retainedBytes = () => downloads.reduce((n,d)=>n+d.size,0);
function drawHistory() {
  $('history').replaceChildren(); cards.clear();
  if(!history.length) {$('history').append(el('p','No transfers yet.','muted'));return;}
  for(const row of history) {
    const card=el('article',undefined,'history-card'), title=el('strong'), detail=el('p',undefined,'muted'), progress=el('progress'), label=el('span');
    const actions=el('div',undefined,'actions'),pause=el('button','Pause','secondary'),resume=el('button','Resume','secondary'),cancel=el('button','Cancel','secondary');
    for(const button of [pause,resume,cancel])button.type='button';
    pause.onclick=()=>transfers.get(row.id)?.transfer.pause();
    resume.onclick=()=>{const t=transfers.get(row.id)?.transfer;if(t){t.reconnectAttempts=0;t.resume();}};
    cancel.onclick=()=>transfers.get(row.id)?.transfer.cancel();
    actions.append(pause,resume,cancel);
    progress.max=100;card.append(title,detail,progress,label,actions);$('history').append(card);
    cards.set(row.id,{title,detail,progress,label,actions,pause,resume,cancel});updateCard(row);
  }
}
const stateLabel={connecting:'Connecting',waiting:'Waiting for receiver to accept',offered:'Waiting for your approval',preparing:'Preparing storage',transferring:'Transferring',paused:'Paused',reconnecting:'Connection interrupted — progress saved',verifying:'Verifying saved file',complete:'Verified complete ✓',failed:'Stopped — check saved progress',declined:'Declined',cancelled:'Cancelled'};
function updateCard(row) {
  const c=cards.get(row.id);if(!c)return;
  const terminal=['complete','failed','declined','cancelled'].includes(row.state);
  c.actions.hidden=terminal;c.pause.hidden=!['transferring','paused'].includes(row.state)||!!row.localPaused;
  c.resume.hidden=!(row.localPaused||row.state==='reconnecting');
  c.cancel.setAttribute('aria-label',`Cancel transfer ${row.direction==='send'?'to':'from'} ${row.peer}`);
  c.title.textContent=`${row.direction==='send'?'↑ To':'↓ From'} ${row.peer} · ${row.files.length} file${row.files.length===1?'':'s'}`;
  c.detail.textContent=row.files.map(f=>f.name).join(', ');
  c.progress.value=row.total?Math.min(100,row.bytes/row.total*100):row.state==='complete'?100:0;
  c.progress.setAttribute('aria-label',`Transfer to or from ${row.peer}`);
  const percent=row.total?Math.min(100,row.bytes/row.total*100):row.state==='complete'?100:0;c.label.textContent=`${stateLabel[row.state]||row.state} · ${number(percent,percent<10?1:0)}% · ${fmt(row.bytes||0)} / ${fmt(row.total||0)}${row.speed?' · '+fmt(row.speed)+'/s':''}${row.eta?' · about '+Math.ceil(row.eta/60)+' min left':''}${row.state==='verifying'?' · '+fmt(row.verifiedBytes||0)+' checked':''}${row.detail?' · '+row.detail:''}`;
}
function setMode(next) {
  mode=next;room?.setMode(mode);trust?.setMode(mode);
  if(next!=='send')resetPrepared();
  $('transfer').classList.toggle('selected',!!mode);$('transfer').setAttribute('aria-pressed',String(!!mode));
  $('pairing-panel').hidden=!mode;$('receive-panel').hidden=!mode;
  $('setup-hint').textContent='After devices connect, either device can initiate the next file transfer. Every incoming transfer still requires receiver approval.';
  renderDevices();renderInvite();
}
function renderDevices() {
  $('devices').replaceChildren();
  const available=allMembers();
  const checking=[...(trust?.rooms.values()||[])].some(entry=>['connecting','reconnecting'].includes(entry.room.state));
  $('discovery-status').textContent=available.length?`${available.length} available device${available.length===1?'':'s'} found. Choose Send beside the device you want to send files to.`:checking?'Checking your remembered devices…':'No devices available yet. Use Online discovery, scan a QR, or enter a connection code.';
  if(selectedMember&&!available.some(m=>m.deviceId===selectedMember.deviceId))resetPrepared();
  const ready=mode==='send'&&!!selectedMember&&(preparedConnection===true||!!preparedConnection?.open);
  $('send-panel').hidden=!ready;
  if(mode!=='send')$('send-panel').hidden=true;
  $('file-picker').disabled=$('folder-picker').disabled=!ready||preparingSelection;
  $('target-name').textContent=selectedMember?`Connected to ${selectedMember.name}. Select files to request transfer immediately.`:'Connect to a receiver first.';
  for(const m of available) {
    const row=el('div',undefined,'device'),identity=el('div',undefined,'device-details');
    identity.append(el('strong',m.name),el('span',preparingDevice&&selectedMember?.deviceId===m.deviceId?'Checking connection…':'Connected · ready to send or receive','muted'));
    const send=el('button','Send','secondary');
    send.setAttribute('aria-label','Send files to '+m.name);
    send.disabled=preparingDevice;send.onclick=()=>prepareReceiver(m);
    row.append(el('span','▣','device-icon'),identity,send);$('devices').append(row);
  }
  $('connected-panel').hidden=!available.length;$('connected-devices').replaceChildren();
  for(const m of available){const row=el('div',undefined,'download');row.append(el('span',m.name+(m.trusted?' · Remembered':m.onlineDirectory?' · Online directory':'')));if(!m.onlineDirectory&&!m.trusted&&!trust?.contacts.some(c=>c.id===m.deviceId)){const remember=el('button','Remember device','secondary');remember.onclick=async()=>{remember.disabled=true;try{await trust.remember(m);notice('Device remembered. Next time, open this page on both devices.');}catch(e){notice(e.message,true);}finally{remember.disabled=false;}};row.append(remember);}const disconnect=el('button','Disconnect','secondary');disconnect.type='button';disconnect.setAttribute('aria-label','Disconnect '+m.name);disconnect.onclick=()=>disconnectDevice(m);row.append(disconnect);$('connected-devices').append(row);}
}
function disconnectDevice(member){
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
function allMembers(){
 const directory=[...connectedOnline.values()].filter(m=>mainPeer?.authorized.get(m.deviceId)?.id===m.id);
 const byDevice=new Map();
 // Prefer the currently accepted QR/room path over a parallel remembered path.
 // Both represent the same UUID, but the active room has the freshest peer ID.
 for(const m of [...members.map(m=>({...m,room})),...(trust?.members()||[])])if(!byDevice.has(m.deviceId))byDevice.set(m.deviceId,m);
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
function renderQueue(){
 const pending=[...peerQueues.values()].filter(q=>q.batches.length);
 $('send-queue').textContent=pending.map(q=>`${q.member.name}: ${number(q.batches.reduce((n,b)=>n+b.length,0))} files queued${q.paused?' (paused)':''}`).join(' · ');
 $('continue-queue').hidden=!pending.some(q=>q.paused);$('continue-queue').disabled=false;
 $('clear-queue').hidden=!pending.length;
}
function nextBatch(peerId){
 const queue=peerQueues.get(peerId);
 if(!queue||queue.paused||!queue.batches.length||sendingTo(peerId)||cancelBarriers.has(peerId))return;
 const current=allMembers().find(m=>m.deviceId===peerId);
 if(!current){queue.paused=true;notice('Reconnect '+queue.member.name+', then choose Continue queue.',true);renderQueue();return;}
 const batch=queue.batches[0];
 if(startSend(current,undefined,batch))queue.batches.shift();else queue.paused=true;
 if(!queue.batches.length)peerQueues.delete(peerId);
 renderQueue();
}
$('continue-queue').onclick=()=>{for(const [id,q] of peerQueues){q.paused=false;nextBatch(id);}};
$('clear-queue').onclick=()=>{peerQueues.clear();renderQueue();notice('Remaining queued files cleared. Active transfers continue.');};
function controls() {
  const locked=!!busy();if(!active||active.terminal())active=[...transfers.values()].find(e=>!e.transfer.terminal())?.transfer;
  $('create-room').disabled=$('join-room').disabled=connecting||(locked&&active?.state!=='reconnecting');
  $('transfer').disabled=locked;
  $('cancel-connection').hidden=!connecting; $('cancel').hidden=true;
  $('clear-history').disabled=locked;
  $('pause').hidden=true;
  $('resume').hidden=true;
  const live=[...transfers.values()].filter(e=>!e.transfer.terminal());
  $('active-summary').textContent=locked?`${number(live.length)} active transfers · Controls are on each transfer card below.`:'';
  const total=live.reduce((n,e)=>n+e.transfer.total,0),bytes=live.reduce((n,e)=>n+e.transfer.bytes,0);
  $('transfer-percent').textContent=locked&&total?number(Math.min(100,bytes/total*100),1)+'%':'';
  $('leave-room').hidden=!room||connecting;
  renderDevices();renderQueue();$('clear-downloads').disabled=locked;void maintainWakeLock();
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
function closeRequest() {if($('incoming').open)$('incoming').close();offeredTransfer=null;}
function showNextOffer(){
 if(offeredTransfer?.state==='offered')return;
 const entry=[...transfers.values()].find(e=>e.transfer.state==='offered');
 if(!entry)return;offeredTransfer=entry.transfer;
 $('request-title').textContent=`${entry.member.name} wants to send ${offeredTransfer.manifest.length} files`;
 $('request-files').textContent=offeredTransfer.manifest.map(f=>`${f.name} (${fmt(f.size)})`).join('\n');
 void refreshAcceptance();if(!$('incoming').open)$('incoming').showModal();$('decline').focus();
}
let acceptanceGeneration=0;
async function refreshAcceptance() {
  if(offeredTransfer?.state!=='offered')return;
  const transfer=offeredTransfer,generation=++acceptanceGeneration;
  $('accept').disabled=true;
  $('request-note').textContent='Checking space for the download…';
  try {
    const availability=await storageAvailability(transfer.total);
    if(offeredTransfer!==transfer||generation!==acceptanceGeneration)return;
    const supported=availability.opfs||availability.indexedDB&&transfer.total<=256*1024*1024;
    $('accept').disabled=!supported||!availability.enough;
    $('request-note').textContent=!supported?'This browser needs persistent file storage for downloads larger than 256 MB. Try a current browser.':!availability.enough?'Not enough browser storage to prepare these files. Free space or send a smaller batch.':'Accept to receive verified files in your browser Downloads. Allow multiple downloads if asked. A Download button remains available if your browser blocks automatic downloads.';
  }catch(error){if(offeredTransfer===transfer)$('request-note').textContent='Could not check download storage: '+error.message;}
}
function receivedFile(file) {
  const line=el('div',undefined,'download');
  if(file.blob) {
    const url=URL.createObjectURL(file.blob),item={url,size:file.blob.size,transferId:file.transferId,line};downloads.push(item);
    const name=el('span',file.name+' · '+fmt(file.size)),actions=el('div',undefined,'download-actions');
    const a=el('a','Download','save-file');a.href=url;a.download=file.name;
    const remove=el('button','Hide','secondary');
    remove.onclick=()=>{URL.revokeObjectURL(url);const i=downloads.indexOf(item);if(i>=0)downloads.splice(i,1);line.remove();$('download-memory').textContent='After saving downloads, use Downloads saved — clear temporary copies.';};
    actions.append(a,remove);line.append(name,actions);
    $('downloads').append(line);a.click();
  } else {line.append(el('span','✓ Saved '+file.savedName+' to your previously chosen folder'));$('downloads').append(line);}
  $('received-section').hidden=false;
  $('download-memory').textContent='Check your browser Downloads. If a file did not appear, tap Download. Completed temporary copies are cleared when you refresh. You can also clear them now after checking your downloads.';
}
async function clearCompletedDownloads(silent=false){
  if(busy()){notice('Wait for the active transfer to finish before clearing downloads.',true);return;}
  $('clear-downloads').disabled=true;
  let cleared=0;
  try{
    for(const record of await records.list()){
      if(record.direction!=='receive'||record.state!=='complete')continue;
      const storage=await BlockStorage.open(record);
      await storage.cleanup();await records.remove(record.id);
      for(let i=downloads.length-1;i>=0;i--)if(downloads[i].transferId===record.transferId){URL.revokeObjectURL(downloads[i].url);downloads[i].line.remove();downloads.splice(i,1);}
      cleared++;
    }
    await renderRecovery();
    $('download-memory').textContent='Completed temporary copies cleared. Files in your device Downloads are unchanged.';
    if(!silent)notice(`${number(cleared)} completed transfer copies cleared. Incomplete transfers are preserved.`);
  }catch(error){notice('Could not clear every temporary copy: '+error.message,true);}
  finally{$('clear-downloads').disabled=!!busy();}
}
$('clear-downloads').onclick=()=>clearCompletedDownloads();
function track(conn,member,outgoing,record,batch=files) {
 const row={id:record?.transferId||conn.metadata?.transferId||crypto.randomUUID(),peer:member.name,direction:outgoing?'send':'receive',state:'connecting',files:[],bytes:0,total:0,time:new Date().toISOString()};
 history.unshift(row);history=history.slice(0,Math.max(50,transfers.size+1));drawHistory();$('history').closest('details').open=true;
 const t=new BlockTransfer(conn,{files:outgoing?[...batch]:undefined,record,id:row.id,senderId:outgoing?deviceId:member.deviceId,receiverId:outgoing?member.deviceId:deviceId,reselected:!!record,requireDirectory:false,
 onCancel:id=>notifyCancellation(id,member),onCleanupError:error=>{debug('Cleanup needs retry: '+error.message);void renderRecovery();},
 onUpdate:update=>{
  const terminal=['complete','failed','cancelled','declined'].includes(update.state);
  Object.assign(row,update);updateCard(row);
  if(terminal){
   if(row.finished)return;row.finished=true;
   clearTimeout(t.reconnectTimer);clearTimeout(t.connectTimer);
   if(offeredTransfer===t)closeRequest();
   transfers.delete(t.id);if(active===t)active=null;
   if(update.state==='cancelled'){
    cancelledTransfers.set(t.id,member.deviceId);
    if(cancelledTransfers.size>100)cancelledTransfers.delete(cancelledTransfers.keys().next().value);
    if(outgoing)peerQueues.delete(member.deviceId);
    if(t.cancelAcknowledged){
     const barrier=t.cancelAcknowledged;cancelBarriers.set(member.deviceId,barrier);
     void barrier.finally(()=>{if(cancelBarriers.get(member.deviceId)===barrier)cancelBarriers.delete(member.deviceId);nextBatch(member.deviceId);});
    }
   }
   if(t.cleanupPromise)void t.cleanupPromise.catch(()=>{}).then(renderRecovery);
   else if(outgoing&&update.state==='complete')void records.remove(t.record.id).then(renderRecovery).catch(e=>debug(e.message));
   else void renderRecovery();
   if(outgoing&&peerQueues.has(member.deviceId)){
    if(update.state==='complete')setTimeout(()=>nextBatch(member.deviceId),0);
    else peerQueues.get(member.deviceId).paused=true;
   }
   notice(update.state==='complete'?`${member.name}: ${outgoing?'delivered and verified.':'received; check Downloads.'}`:member.name+': '+update.detail,update.state!=='complete');
   setTimeout(showNextOffer,0);
  }
  controls();
 },onInterrupted:transfer=>{if(transfer.direction==='send')scheduleReconnect(transfer,member);else if(!transfer.record)transfer.fail('The sender disconnected before acceptance.','failed',false);},
 onOffer:()=>showNextOffer(),
 onFile:file=>receivedFile({...file,transferId:t.id})});
 transfers.set(t.id,{transfer:t,member,row});active=t;controls();return t;
}
function startSend(member,record,batch=files) {
 if(sendingTo(member.deviceId)||cancelBarriers.has(member.deviceId)){notice('This device already has an outgoing transfer. Additional selections are queued.',true);return false;}
 try{
  manifestFor(batch);const id=record?.transferId||crypto.randomUUID();
  const connection=member.room.connect(member.id,id);
  track(connection,member,true,record,batch);
  notice('Waiting for '+member.name+' to accept. Other peer transfers can continue.');return true;
 }catch(error){notice(error.message,true);return false;}
}
function resetPrepared(){prepareGeneration++;const conn=preparedConnection;preparedConnection=null;selectedMember=null;preparingDevice=false;if(conn?.close&&conn!==active?.conn)conn.close();}
async function prepareReceiver(member){
  if(!member){notice('That connected device is unavailable.',true);return;}
  if((preparedConnection===true||preparedConnection?.open)&&selectedMember?.deviceId===member.deviceId){$('send-panel').scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(mode!=='send')setMode('send');resetPrepared();const generation=prepareGeneration;selectedMember=member;preparingDevice=true;renderDevices();notice(`Opening a secure file connection to ${member.name}…`);
  try{const probe=await member.room.probe(member.id,20000);probe.close();if(generation!==prepareGeneration)return;preparedConnection=true;preparingDevice=false;notice(`Connection confirmed with ${member.name}. Choose files to send; this device can also receive.`);renderDevices();$('send-panel').scrollIntoView({behavior:'smooth',block:'center'});}catch{await failPrepared(member,generation);}
}
async function failPrepared(member,generation){if(generation!==prepareGeneration)return;preparedConnection=null;preparingDevice=false;latestDiagnosis=await connectionDiagnosis();if(generation!==prepareGeneration)return;notice(failedChannelMessage(member.name,latestDiagnosis),true);$('network-result').textContent=latestDiagnosis.summary;renderDevices();}
function awaitTransfer(conn,member){
  incoming(conn,member);
}
function scheduleReconnect(t,member){
 if(t.terminal()||t.direction!=='send'||!transfers.has(t.id))return;
 clearTimeout(t.reconnectTimer);t.reconnectAttempts=t.reconnectAttempts||0;
 if(t.reconnectAttempts>=4){notice(member.name+': automatic retries stopped. Use Resume on its transfer card.',true);return;}
 t.reconnectTimer=setTimeout(()=>{
  if(t.terminal()||!transfers.has(t.id))return;t.reconnectAttempts++;
  const current=allMembers().find(m=>m.deviceId===member.deviceId);
  try{
   if(!current)throw Error('Peer offline');t.attach(current.room.connect(current.id,t.id));
   t.connectTimer=setTimeout(()=>{if(t.state==='connecting')t.interrupted('Connection retry timed out.');},25000);
  }catch{scheduleReconnect(t,member);}
 },[1000,3000,8000,15000][t.reconnectAttempts]);
}
function incoming(conn,member){
 if(conn.metadata?.kind!=='file-v3'){conn.close();return;}
 if(cancelledTransfers.has(conn.metadata.transferId)){conn.close();return;}
 const existing=transfers.get(conn.metadata.transferId);
 if(existing){
  if(existing.transfer.direction==='receive'&&existing.member.deviceId===member.deviceId)existing.transfer.attach(conn);else conn.close();
  return;
 }
 track(conn,member,false);
}
async function openRoom(host,codeOverride,collisions=0) {
  if(busy()&&active?.state!=='reconnecting')return;
  let code;try{code=host?(codeOverride||newCode()):parseRoom(codeOverride||$('room-code').value);}catch(e){notice(e.message,true);$('room-code').focus();return;}
  if(!mode)setMode('send');
  const token=++attempt;
  if(!busy())resetPrepared();room?.close();members=[];connecting=true;lastAttempt={host,code};controls();
  $('room-info').hidden=true;roomState('connecting','Connecting to the other device…');
  const candidate=new Room({
    onConnectionRequest:requestConnectionApproval,
    onMembers:list=>{if(token!==attempt)return;members=list;roomState(candidate.state);if(list.length)notice(`${list[0].name} connected. Either device can now initiate a file transfer.`);renderDevices();},
    onError:msg=>{if(token===attempt)notice(msg,true);},
    onState:(state,detail)=>{if(token===attempt)roomState(state,detail);},
    onTransfer:(conn,m)=>{if(token!==attempt){conn.close();return;}awaitTransfer(conn,{...m,room:candidate});},
    onMessage:async(message,m,reply)=>{if(message?.type==='transfer-cancel'){reply({cancelled:remoteCancel(message.id,m)});return;}if(message?.type!=='remember'||busy()){reply({accepted:false});return;}if(!confirm(`Remember ${m.name}? They will be able to find this device when both pages are open. You still approve each file transfer.`)){reply({accepted:false});return;}try{await trust.add(m,message.secret);reply({accepted:true});notice('Device remembered.');}catch(e){reply({accepted:false});notice(e.message,true);}}
  },{deviceId});room=candidate;
  try {
    await startupStorageReady;await networkReady;if(token!==attempt)return;
    await candidate.open(code,host,$('device-name').value.trim()||'My device',mode);if(token!==attempt)return;
    $('room-info').hidden=false;renderInvite();
    notice(active?.state==='reconnecting'?'Reconnected. Tap Resume to continue your saved transfer.':members.length?'Devices paired. On the sender, choose the receiver to enable file selection.':mode==='receive'?'Ready. Scan this invitation on the sending device.':'Ready. Scan the other device’s QR, or let it scan yours.');
  } catch(e) {
    if(token!==attempt)return;candidate.close();room=null;members=[];$('room-info').hidden=true;
    roomState('disconnected',e.message.replaceAll('room','invitation'));$('retry-room').hidden=false;
    if(host&&!codeOverride&&collisions<3&&e.message.includes('already open')){setTimeout(()=>openRoom(true,undefined,collisions+1),500);}
  } finally {if(token===attempt){connecting=false;controls();}}
}
function leaveRoom() {
  if(busy()){notice('Finish or cancel the file transfer before leaving.',true);return;}
  pendingConnectionDecision?.(false);
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
    if(record.direction==='send'){const resume=el('button','Reselect files & resume','secondary');resume.onclick=()=>{if(sendingTo(record.receiverId)||cancelBarriers.has(record.receiverId)){notice('Wait for the current transfer to this device to finish.',true);return;}const peer=allMembers().find(m=>m.deviceId===record.receiverId);if(!peer){notice('Reconnect the original receiver first, using Online discovery, its invitation, or remembered device.',true);return;}resumeRecord=record;const folder=record.sourceFolder||record.manifest.some(f=>f.path.includes('/'));$(folder?'resume-folder-picker':'resume-picker').click();};row.append(resume);}
    else {
      if(record.storage==='directory'){const allow=el('button','Allow destination access','secondary');allow.onclick=async()=>{try{if(await record.directory.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder permission was not granted.');notice('Folder ready. Resume from the sender.');}catch(e){notice(e.message,true);}};row.append(allow);}
      if(record.files.some(f=>f.complete)){const restore=el('button','Show received files','secondary');restore.onclick=async()=>{try{const storage=await BlockStorage.open(record);for(let f=0;f<record.files.length;f++)if(record.files[f].complete)receivedFile({...record.manifest[f],...await storage.completedFile(f),transferId:record.transferId});notice('Verified files shown below.');}catch(e){notice(e.message,true);}};row.append(restore);}
    }
    const remove=el('button','Remove saved data','text-button');remove.onclick=async()=>{if(busy()){notice('Finish or cancel the active transfer first.',true);return;}if(!confirm('Remove this saved transfer and its temporary browser files? Files already downloaded to your device remain.'))return;try{if(record.direction==='receive'){const storage=await BlockStorage.open(record);await storage.cleanup();}await records.remove(record.id);await renderRecovery();}catch(e){notice(e.message,true);}};row.append(remove);$('recoveries').append(row);
  }}catch(e){debug('Saved progress unavailable: '+e.message);}
}
async function resumeSelected(event){if(!resumeRecord||!event.target.files.length)return;files=[...event.target.files];const record=resumeRecord;resumeRecord=null;const peer=allMembers().find(m=>m.deviceId===record.receiverId);if(!peer){notice('Receiver disconnected. Reconnect and try again.',true);return;}setMode('send');try{if(record.sourceFolder)files=[await folderArchive(files)];const manifest=manifestFor(files);files=record.manifest.map(meta=>{const index=manifest.findIndex(f=>JSON.stringify(f)===JSON.stringify(meta));if(index<0)throw Error('Choose the same original files or folder to resume.');return files[index];});startSend(peer,record);}catch(e){notice(e.message,true);}event.target.value='';}
$('resume-picker').onchange=$('resume-folder-picker').onchange=resumeSelected;
$('pause').onclick=()=>active?.pause();$('resume').onclick=()=>{if(active){active.reconnectAttempts=0;active.resume();}};
$('debug-enabled').onchange=()=>{$('debug-log').hidden=!$('debug-enabled').checked;};
function joinInvitation(value,requireLink=false) {
  if(busy()){notice('Finish or cancel the active transfer before scanning another invitation.',true);return;}
  try {
    const invite=readInvitation(value,location.href,requireLink);
    if(room&&!room.closed&&room.code===invite.code&&(room.host||['connecting','connected','reconnecting'].includes(room.state))) {notice(room.host?'This is your current invitation. Scan the QR on the other device, or let that device scan yours.':'You already joined this invitation. Choose the receiver on the sending device.');return;}
    if(invite.mode)setMode(invite.mode);else if(!mode)setMode('send');
    debug('Valid invitation read; connecting to its creator.');void openRoom(false,invite.code);
  } catch(e){notice(e.message||'Invalid invitation. Enter the code instead.',true);}
}
const scanner=new Scanner($('scanner-video'),value=>{ $('scanner-dialog').close();joinInvitation(value,true);},message=>{$('scanner-dialog').close();notice(message,true);});
$('scan-qr').onclick=()=>{if(busy()){notice('Finish or cancel the active transfer before scanning.',true);return;}if(!navigator.mediaDevices?.getUserMedia){notice('Camera unavailable. Enter the invitation code or paste its link.',true);return;}$('scanner-dialog').showModal();void scanner.start();};
$('stop-scan').onclick=()=>{scanner.stop();$('scanner-dialog').close();$('room-code').focus();};
$('scanner-dialog').addEventListener('close',()=>scanner.stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('scanner-dialog').open){scanner.stop();$('scanner-dialog').close();}});
$('transfer').onclick=()=>{if(busy())return;setMode('send');if(!room)void openRoom(true);$('pairing-panel').scrollIntoView({behavior:'smooth',block:'start'});};
async function selectFiles(e){
  if(!selectedMember||!(preparedConnection===true||preparedConnection?.open)||preparingSelection){e.target.value='';notice('Confirm the receiver connection before choosing files.',true);return;}
  const selected=[...e.target.files],isFolder=e.target.id==='folder-picker';e.target.value='';
  if(!selected.length)return;
  const destination=selectedMember;preparingSelection=true;
  try{
    notice(isFolder?'Preparing folder information…':'Preparing file queue…');
    const chosen=isFolder?[await folderArchive(selected)]:selected;
    const batches=transferBatches(chosen);
    if(selectedMember?.deviceId!==destination.deviceId)throw Error('Receiver changed. Select the files again.');
    const queue=peerQueues.get(destination.deviceId)||{member:destination,batches:[],paused:false};
    queue.batches.push(...batches);queue.paused=false;peerQueues.set(destination.deviceId,queue);
    $('selection').textContent=isFolder?`${number(selected.length)} files in ${chosen[0].name} · ${fmt(chosen[0].size)}`:`${number(selected.length)} files · ${number(batches.length)} batches`;
    nextBatch(destination.deviceId);
  }catch(error){notice(error.message,true);}finally{preparingSelection=false;renderDevices();renderQueue();}
}
$('file-picker').onchange=$('folder-picker').onchange=selectFiles;
$('create-room').onclick=()=>openRoom(true);$('join-room').onclick=()=>joinInvitation($('room-code').value);
$('room-code').value='';
$('room-code').onkeydown=e=>{if(e.key==='Enter')$('join-room').click();};
$('retry-room').onclick=()=>{if(lastAttempt)openRoom(lastAttempt.host,lastAttempt.code);};
$('leave-room').onclick=$('cancel-connection').onclick=leaveRoom;
$('copy-room').onclick=async()=>{if(!room)return;try{await navigator.clipboard.writeText(room.code);notice('Code copied. Paste it on the sending device.');}catch{notice('Copy the displayed invitation code manually.');}};
$('copy-link').onclick=async()=>{if(!room)return;try{await navigator.clipboard.writeText(inviteUrl());notice('Invite link copied. Share it privately.');}catch{notice('Could not copy. Use the QR code or room code.');}};
$('share-room').hidden=!navigator.share;
$('share-room').onclick=async()=>{if(!room)return;try{await navigator.share({title:'Send files to my device',url:inviteUrl()});}catch(e){if(e.name!=='AbortError')notice('Use Copy link instead.');}};
$('cancel').onclick=()=>active?.cancel();$('decline').onclick=()=>offeredTransfer?.decline();
$('incoming').addEventListener('cancel',e=>{e.preventDefault();offeredTransfer?.decline();});
$('accept').onclick=async()=>{
  if(offeredTransfer?.state!=='offered')return;
  const transfer=offeredTransfer;
  await refreshAcceptance();
  if(offeredTransfer!==transfer||$('accept').disabled)return;
  $('accept').disabled=true;
  const destination={storage:navigator.storage?.getDirectory?'opfs':'indexeddb'};
  await transfer.accept(destination);
  if(transfer.state==='failed')return;
  if(offeredTransfer===transfer)closeRequest();controls();showNextOffer();notice('Receiving and preparing your browser downloads…');
};
$('choose-folder').hidden=$('request-folder').hidden=true;
$('direct-save-support').textContent='Verified files are downloaded using your browser. Your browser controls the download folder and may ask you to allow multiple downloads.';
$('clear-history').onclick=()=>{if(!busy()){history=[];save();drawHistory();}};
$('keep-awake').onchange=()=>void maintainWakeLock();
$('network-check').onclick=async()=>{
  $('network-check').disabled=true;$('network-result').textContent='Checking connection routes (up to 12 seconds)…';
  try {latestDiagnosis=await connectionDiagnosis(12000);$('network-result').textContent=latestDiagnosis.summary;}
  catch(e){$('network-result').textContent='Network check failed: '+e.message;}finally{$('network-check').disabled=false;}
};
let savedName='';try{savedName=(localStorage.getItem('wft-device-name')||'').trim();}catch{}
$('device-name').value=savedName||friendlyName();
const normalizeName=value=>String(value).normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,48);
$('device-name').onchange=()=>{const name=normalizeName($('device-name').value)||friendlyName();$('device-name').value=name;try{localStorage.setItem('wft-device-name',name);}catch{}if(room){room.name=name;room.setMode(mode);}if(trust){trust.name=name;for(const {room:r} of trust.rooms.values()){r.name=name;r.setMode(mode||'send');}}mainPeer?.setName(name);void presence?.setIdentity({name,peer1Id:mainPeer?.peer?.id||''}).catch(e=>debug(e.message));};
const nameReady=new Promise(resolve=>{
  if(savedName){resolve();return;}
  $('welcome-name').value='';
  $('name-dialog').showModal();$('welcome-name').focus();
  $('name-dialog').addEventListener('cancel',event=>event.preventDefault());
  $('name-form').onsubmit=event=>{
    event.preventDefault();
    const name=normalizeName($('welcome-name').value);
    if(!name){$('welcome-name').setCustomValidity('Enter a device name.');$('welcome-name').reportValidity();return;}
    $('device-name').value=name;$('device-name').onchange();
    $('name-dialog').close();resolve();
  };
  $('welcome-name').oninput=()=>$('welcome-name').setCustomValidity('');
});
const startupStorageReady=performance.getEntriesByType('navigation')[0]?.type==='reload'?clearCompletedDownloads(true):Promise.resolve();
trust=new TrustedDevices({id:deviceId,name:$('device-name').value,mode:'send',onChange:()=>{renderDevices();renderTrusted();},onTransfer:awaitTransfer,onConnectionRequest:requestConnectionApproval,onCancel:remoteCancel});
debug('Startup: preparing identity, Main Peer 1, and remembered devices.');
void nameReady.then(()=>startupStorageReady).then(()=>networkReady).then(async()=>{
  try{await ensureMainPeer();debug('Startup: Main Peer 1 is ready in this tab.');}
  catch(e){debug('Startup: '+e.message);}
  await trust.load();
  // Presence starts only when this tab's user enables it.
}).then(()=>{if(!mode)notice('Choose Transfer to connect, or turn Online on to discover devices. Then choose Send beside a connected device.');void connectionDiagnosis().then(result=>{latestDiagnosis=result;$('network-result').textContent=result.summary;debug('Automatic connection check: '+result.summary);});}).catch(e=>notice('Application startup issue: '+e.message,true));
function consumeInvitation(){const params=new URLSearchParams(location.hash.slice(1));if(!(params.get('join')||params.get('room')))return;const value=location.href;window.history.replaceState(null,'',location.pathname+location.search);joinInvitation(value,true);}
$('refresh-devices').onclick=async()=>{$('refresh-devices').disabled=true;debug('Checking online and remembered devices on request.');try{await networkReady;if($('online-toggle').checked){await setOnline(true);await presence?.tick();}await trust.load();renderDevices();}catch(e){notice(e.message,true);}finally{$('refresh-devices').disabled=false;}};
void nameReady.then(()=>startupStorageReady).then(consumeInvitation);window.addEventListener('hashchange',()=>void nameReady.then(consumeInvitation));
$('online-toggle').checked=false;try{localStorage.removeItem('wft-online-enabled');}catch{}
$('online-toggle').onchange=()=>void setOnline($('online-toggle').checked);
// Discovery is an explicit choice in this tab, not a persisted preference.
window.addEventListener('beforeunload',event=>{if(busy()){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{for(const item of downloads)URL.revokeObjectURL(item.url);void presence?.stop();void mainPeer?.stop();});
window.addEventListener('offline',()=>notice('Internet connection lost. Existing transfers may continue; new pairing needs internet.',true));
window.addEventListener('online',()=>{if(!busy())notice('Internet is back. Use Retry connection if your room is disconnected.');});
document.addEventListener('visibilitychange',()=>{void maintainWakeLock();});
if(!window.isSecureContext||!window.RTCPeerConnection) {
  notice('Use this app in a modern browser over HTTPS. This browser cannot establish secure file transfers.',true);
  $('create-room').disabled=$('join-room').disabled=true;
}
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
drawHistory();renderDevices();renderOnlineUsers();void startupStorageReady.then(renderRecovery);
