import { Room,newCode,normalizeCode } from './room.js';
import { Transfer,memorySink,directorySink,MEMORY_LIMIT } from './transfer.js';
const $=id=>document.getElementById(id);
const fmt=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1073741824?`${(n/1048576).toFixed(1)} MB`:`${(n/1073741824).toFixed(2)} GB`;
let room,mode='send',files=[],members=[],active,directory,connecting=false;
const downloads=[];const cards=new Map();
let history=[];try{history=JSON.parse(localStorage.getItem('wft-history-v2')||'[]').filter(x=>x&&typeof x.id==='string'&&Array.isArray(x.files)&&x.files.every(f=>f&&typeof f.name==='string')).slice(0,50);}catch{}
for(const row of history)if(!['complete','failed','declined','cancelled'].includes(row.state)){row.state='failed';row.detail='Page closed before transfer finished.';}
function notice(text,error=false){$('status').textContent=text;$('status').className=error?'status error':'status';}
function save(){try{localStorage.setItem('wft-history-v2',JSON.stringify(history.slice(0,50)));}catch{}}
function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function drawHistory(){
  $('history').replaceChildren();cards.clear();
  if(!history.length){$('history').append(element('p','No transfers yet. Your sent and received files will appear here.','muted'));return;}
  for(const row of history){const card=element('article',undefined,'history-card');const title=element('strong');const detail=element('p',undefined,'muted');const progress=document.createElement('progress');progress.max=100;const label=element('span');card.append(title,detail,progress,label);$('history').append(card);cards.set(row.id,{title,detail,progress,label});updateCard(row);}
}
function updateCard(row){const c=cards.get(row.id);if(!c)return;c.title.textContent=`${row.direction==='send'?'↑ To':'↓ From'} ${row.peer} · ${row.files.length} file${row.files.length===1?'':'s'}`;c.detail.textContent=row.files.map(f=>f.name).join(', ');c.progress.value=row.total?Math.min(100,row.bytes/row.total*100):row.state==='complete'?100:0;c.progress.setAttribute('aria-label',`Transfer to or from ${row.peer}`);c.label.textContent=`${row.state} · ${fmt(row.bytes)} / ${fmt(row.total)}${row.detail?' · '+row.detail:''}`;}
function busy(){return active&&!active.terminal();}
function setMode(next){if(busy()){notice('Finish or cancel the current transfer first.',true);return;}mode=next;room?.setMode(mode);$('send').classList.toggle('selected',mode==='send');$('receive').classList.toggle('selected',mode==='receive');$('send').setAttribute('aria-pressed',mode==='send');$('receive').setAttribute('aria-pressed',mode==='receive');$('send-panel').hidden=mode!=='send';$('receive-panel').hidden=mode!=='receive';renderDevices();}
function renderDevices(){
  $('devices').replaceChildren();const receivers=members.filter(m=>m.mode==='receive');
  if(!room?.id||connecting){$('devices').append(element('p','Create or join a room on both devices to find receivers.','muted'));return;}
  if(!receivers.length){$('devices').append(element('p','Waiting for receivers. On the other device, join this room and choose Receive.','muted'));return;}
  for(const m of receivers){const b=element('button',undefined,'device');b.append(element('span','▣','device-icon'),element('strong',m.name),element('span',files.length?'Send files →':'Select files first','muted'));b.disabled=!files.length||busy();b.onclick=()=>startSend(m);$('devices').append(b);}
}
function track(conn,member,outgoing){
  const row={id:crypto.randomUUID(),peer:member.name,direction:outgoing?'send':'receive',state:'connecting',files:[],bytes:0,total:0,time:new Date().toISOString()};history.unshift(row);history=history.slice(0,50);drawHistory();
  const t=new Transfer(conn,{files:outgoing?files:undefined,onUpdate:update=>{
    const stateChanged=row.state!==update.state;Object.assign(row,update);updateCard(row);if(stateChanged)save();
    if(['complete','failed','cancelled','declined'].includes(update.state)){
      save();$('incoming').hidden=true;$('cancel').hidden=true;renderDevices();
      notice(update.state==='complete'?'Transfer complete. Received files are ready below.':update.detail,update.state!=='complete');
    }else{$('cancel').hidden=false;}
  },onOffer:manifest=>{
    $('incoming').hidden=false;$('request-title').textContent=`${member.name} wants to send ${manifest.length} file${manifest.length===1?'':'s'}`;
    $('request-files').textContent=manifest.map(f=>`${f.name} (${fmt(f.size)})`).join('\n');
    const total=manifest.reduce((n,f)=>n+f.size,0);
    $('accept').disabled=!directory&&total+downloads.reduce((n,d)=>n+d.size,0)>MEMORY_LIMIT;
    $('request-note').textContent=$('accept').disabled?'This exceeds the 256 MB browser memory limit. Choose a download folder before accepting, or ask for smaller batches.':directory?'Files will be saved to your chosen folder after verification.':'Files stay in this tab until you click Save. Keep this page open.';
  },onFile:file=>{
    const line=element('div',undefined,'download');
    if(file.blob){const url=URL.createObjectURL(file.blob);const item={url,size:file.blob.size};downloads.push(item);const a=element('a',`Save ${file.name}`);a.href=url;a.download=file.name;const remove=element('button','Dismiss','secondary');remove.onclick=()=>{URL.revokeObjectURL(url);downloads.splice(downloads.indexOf(item),1);line.remove();};line.append(a,remove);}
    else line.append(element('span',`✓ Saved ${file.savedName} to your folder`));
    $('downloads').append(line);
  }});active=t;renderDevices();return t;
}
function startSend(member){if(busy())return;try{track(room.connect(member.id),member,true);notice(`Connecting to ${member.name}. Waiting for acceptance…`);}catch(e){notice(e.message,true);}}
async function openRoom(host){
  if(busy()||connecting)return;connecting=true;room?.close();members=[];renderDevices();$('create-room').disabled=$('join-room').disabled=true;
  const code=host?newCode():normalizeCode($('room-code').value);notice('Connecting to the room…');
  const candidate=new Room({onMembers:list=>{members=list;renderDevices();},onError:msg=>notice(msg,true),onTransfer:(conn,m)=>{
    if(busy()){conn.on('open',()=>{conn.send(JSON.stringify({type:'decline'}));setTimeout(()=>conn.close(),100);});return;}
    track(conn,m,false);
  }});room=candidate;
  try{await candidate.open(code,host,$('device-name').value.trim()||'My device',mode);$('room-code').value=code;$('room-info').hidden=false;$('current-room').textContent=code.match(/.{1,4}/g).join('-');$('room-note').textContent=host?'You created this room. Keep this page open while others join.':'Joined the room. Keep the room creator’s page open.';$('device-name').disabled=true;notice('Room connected. Choose Send or Receive on each device.');}
  catch(e){candidate.close();room=null;members=[];$('room-info').hidden=true;notice(e.message,true);}
  finally{connecting=false;$('create-room').disabled=$('join-room').disabled=false;renderDevices();}
}
$('send').onclick=()=>setMode('send');$('receive').onclick=()=>setMode('receive');
$('file-picker').onchange=e=>{files=[...e.target.files];$('selection').textContent=files.length?`${files.length} file${files.length===1?'':'s'} · ${fmt(files.reduce((n,f)=>n+f.size,0))} · ${files.map(f=>f.name).join(', ')}`:'No files selected';renderDevices();};
$('create-room').onclick=()=>openRoom(true);$('join-room').onclick=()=>openRoom(false);
$('leave-room').onclick=()=>{if(busy()){notice('Cancel or finish the transfer before leaving.',true);return;}room?.close();room=null;members=[];$('room-info').hidden=true;$('device-name').disabled=false;renderDevices();notice('Left the room.');};
$('copy-room').onclick=async()=>{if(!room)return;try{await navigator.clipboard.writeText(room.code);notice('Room code copied. Enter it on the other device.');}catch{notice('Copy the displayed room code manually.');}};
$('copy-link').onclick=async()=>{if(!room)return;try{const url=new URL(location.href);url.hash='room='+room.code;await navigator.clipboard.writeText(url.href);notice('Invite link copied. Share it privately with the other device.');}catch{notice('Could not copy. Use the room code instead.',true);}};
$('cancel').onclick=()=>active?.cancel();$('decline').onclick=()=>active?.decline();
$('accept').onclick=()=>{if(active?.state!=='offered')return;const total=active.total+downloads.reduce((n,d)=>n+d.size,0);if(!directory&&total>MEMORY_LIMIT){notice('Choose a download folder first or receive a smaller batch.',true);return;}active.accept(directory?(file)=>directorySink(directory,file):()=>memorySink());$('incoming').hidden=true;notice('Receiving files…');};
$('choose-folder').hidden=!('showDirectoryPicker' in window);
$('choose-folder').onclick=async()=>{try{directory=await window.showDirectoryPicker({mode:'readwrite'});$('folder-status').textContent=`Saving to ${directory.name}`;if(active?.state==='offered'){$('accept').disabled=false;$('request-note').textContent='Files will be saved to your chosen folder after verification.';}}catch(e){if(e.name!=='AbortError')notice('Could not access folder: '+e.message,true);}};
$('clear-history').onclick=()=>{if(busy()){notice('Finish the current transfer before clearing history.',true);return;}history=[];save();drawHistory();};
try{$('device-name').value=localStorage.getItem('wft-device-name')||(/Android|iPhone|iPad/.test(navigator.userAgent)?'My phone':'My computer');}catch{$('device-name').value='My device';}
$('device-name').onchange=()=>{try{localStorage.setItem('wft-device-name',$('device-name').value.slice(0,48));}catch{}};
const invite=new URLSearchParams(location.hash.slice(1)).get('room');if(invite){$('room-code').value=normalizeCode(invite);setMode('receive');historyReplace();}
function historyReplace(){window.history.replaceState(null,'',location.pathname+location.search);}
window.addEventListener('beforeunload',event=>{if(busy()){event.preventDefault();event.returnValue='';}});
window.addEventListener('offline',()=>notice('You are offline. New connections need internet access; existing transfers may continue.',true));
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
drawHistory();renderDevices();
