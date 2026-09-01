from pathlib import Path

p=Path('src/app.js')
s=p.read_text()

def rep(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'missing replacement target: {label}')
    s=s.replace(old,new,1)

rep("import {records,BlockStorage} from './storage.js';","import {records,BlockStorage,cleanupApplicationStorage} from './storage.js';",'storage import')
start=s.index('let history=[];')
end=s.index('function notice(',start)
s=s[:start]+"let history=[];\n"+s[end:]
old="""async function setOnline(enabled){
 $('online-toggle').checked=enabled;try{localStorage.setItem('wft-online-enabled',enabled?'1':'0');}catch{}
 if(enabled){
  try{
   await networkReady;
   if(!mainPeer)mainPeer=new MainPeerManager({uuid:deviceId,name:$('device-name').value,onIncoming:(conn,m)=>awaitTransfer(conn,{...m,room:directoryRoom}),onState:(state,detail)=>debug(`Main Peer 1 ${state}${detail?' · '+detail:''}`)});
   const peer1Id=await mainPeer.start();
   if(!presence)presence=new PresencePeerManager({uuid:deviceId,name:$('device-name').value,peer1Id,onChange:renderOnlineUsers,onState:presenceState});
   else await presence.setIdentity({name:$('device-name').value,peer1Id});
   await presence.start();
  }catch(e){presenceState('failed',e.message);}
 } else {await presence?.stop();await mainPeer?.stop();onlineUsers=[];renderOnlineUsers([]);}
}
"""
new="""async function ensureMainPeer(){
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
"""
rep(old,new,'online lifecycle')
rep("function save() { try {localStorage.setItem('wft-history-v2',JSON.stringify(history.slice(0,50)));} catch {} }","function save() {}",'history persistence')
rep("c.label.textContent=`${stateLabel[row.state]||row.state} · ${fmt(row.bytes||0)} / ${fmt(row.total||0)}${row.speed?' · '+fmt(row.speed)+'/s':''}${row.eta?' · about '+Math.ceil(row.eta/60)+' min left':''}${row.state==='verifying'?' · '+fmt(row.verifiedBytes||0)+' checked':''}${row.detail?' · '+row.detail:''}`;","const percent=row.total?Math.min(100,row.bytes/row.total*100):row.state==='complete'?100:0;c.label.textContent=`${stateLabel[row.state]||row.state} · ${percent.toFixed(percent<10?1:0)}% · ${fmt(row.bytes||0)} / ${fmt(row.total||0)}${row.speed?' · '+fmt(row.speed)+'/s':''}${row.eta?' · about '+Math.ceil(row.eta/60)+' min left':''}${row.state==='verifying'?' · '+fmt(row.verifiedBytes||0)+' checked':''}${row.detail?' · '+row.detail:''}`;",'percentage')
old="""async function refreshAcceptance() {
  if(active?.state!=='offered')return;
  $('accept').disabled=!directory;
  $('request-note').textContent=directory?`Files will save directly to ${directory.name}. Allow about ${fmt(active.total*2)} free disk space during verification. No file contents are stored in browser storage.`:typeof window.showDirectoryPicker==='function'?'Choose a device folder below, then accept. File contents will not be kept in browser storage.':'This browser cannot write directly to a device folder. Receive using desktop Chrome or Edge. You can still send files from this browser.';
}
"""
new="""async function refreshAcceptance() {
  if(active?.state!=='offered')return;
  const canTemp=!!navigator.storage?.getDirectory;
  $('accept').disabled=!directory&&!canTemp;
  $('request-note').textContent=directory?`The verified file will be saved automatically to ${directory.name}.`:canTemp?'Accept to receive. Temporary transfer data uses browser private storage only until verification, then the file download starts automatically.':'Choose a download folder before accepting this file.';
}
"""
rep(old,new,'acceptance availability')
rep("    actions.append(a,remove);line.append(name,actions);\n  } else line.append(el('span',`✓ Saved ${file.savedName} to your chosen folder`));","    actions.append(a,remove);line.append(name,actions);document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);const i=downloads.indexOf(item);if(i>=0)downloads.splice(i,1);},60000);\n  } else line.append(el('span',`✓ Saved ${file.savedName} automatically to your chosen folder`));",'automatic download')
rep('reselected:!!record,requireDirectory:!outgoing,onUpdate:update=>{','reselected:!!record,requireDirectory:false,onUpdate:update=>{','directory requirement')
old="""function awaitTransfer(conn,member){
  const existing=pendingReceivers.get(conn.peer);existing?.close();if(pendingReceivers.size>=4&&!existing){conn.close();return;}pendingReceivers.set(conn.peer,conn);
  const clean=()=>{clearTimeout(timer);if(pendingReceivers.get(conn.peer)===conn)pendingReceivers.delete(conn.peer);};
  const timer=setTimeout(()=>{clean();conn.close();},300000);conn.on('close',clean);conn.on('error',clean);
  conn.once('data',raw=>{clean();let message;try{message=typeof raw==='string'&&raw.length<49152?JSON.parse(raw):null;}catch{}if(message?.type!=='hello'){conn.close();return;}incoming(conn,member);conn.emit('data',raw);});
}
"""
new="""function awaitTransfer(conn,member){
  incoming(conn,member);
}
"""
rep(old,new,'handshake')
rep("$('accept').onclick=async()=>{if(active?.state!=='offered')return;await refreshAcceptance();if($('accept').disabled)return;void active.accept({storage:'directory',directory});closeRequest();controls();notice('Receiving directly into your device folder…');};","$('accept').onclick=async()=>{if(active?.state!=='offered')return;await refreshAcceptance();if($('accept').disabled)return;const destination=directory?{storage:'directory',directory}:navigator.storage?.getDirectory?{storage:'opfs'}:null;if(!destination)return;const transfer=active;await transfer.accept(destination);if(transfer.state==='failed')return;closeRequest();controls();notice(directory?'Receiving and saving automatically into your chosen folder…':'Receiving securely. Download starts automatically after verification…');};",'accept click')
rep("$('direct-save-support').textContent=typeof window.showDirectoryPicker==='function'?'Browser permission is required once to choose a folder. Transfer progress metadata is stored locally for recovery; file contents stay in your selected folder.':'Direct device-folder saving is not supported by this browser. You can send here; to receive without browser storage, use desktop Chrome or Edge.';","$('direct-save-support').textContent=typeof window.showDirectoryPicker==='function'?'Choose a folder for direct automatic saving. If you do not choose one, supported browsers use temporary private storage and trigger the verified file download automatically.':'This browser will use temporary private storage when available and trigger the verified file download automatically.';",'save support')
old="""debug('Startup: checking private remembered-device connections.');
void networkReady.then(()=>trust.load()).then(()=>{if(!mode)notice('Choose Send Files or Receive Files. Turn Online on to discover current users.');}).catch(()=>notice('Recovery metadata storage is unavailable. Enable site storage to transfer files.',true));
"""
new="""debug('Startup: preparing identity and remembered devices.');
void cleanupApplicationStorage().then(()=>networkReady).then(()=>ensureMainPeer()).then(()=>trust.load()).then(()=>{if(!mode)notice('Choose Send Files or Receive Files. Turn Online on to discover current users.');}).catch(e=>notice('Application startup issue: '+e.message,true));
"""
rep(old,new,'startup')
p.write_text(s)
