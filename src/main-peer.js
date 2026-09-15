import * as PeerModule from 'peerjs';
import {peerOptions} from './room.js';
const Peer=PeerModule.Peer||PeerModule.default.Peer||PeerModule.default;

const safe=value=>String(value||'').trim().slice(0,128);
const shared={peer:null,id:'',opening:null,subscribers:new Set()};
const CONTINUITY_KEY='wftp-main-continuity-v1',CONTINUITY_TTL=12*60*60*1000,RECONNECT_GRACE=45000;
const tokenOk=value=>/^[a-f0-9]{64}$/i.test(value||'');
const defaultStorage=()=>{try{return typeof sessionStorage==='undefined'?null:sessionStorage;}catch{return null;}};
const stablePeerId=deviceId=>`wftp-main-${safe(deviceId)}`;

function dispatchIncoming(conn){
 const targets=[...shared.subscribers].reverse().filter(manager=>manager.enabled&&manager.acceptIncoming);
 const target=targets[0];
 if(!target){conn.on('open',()=>conn.close());return;}
 target.accept(conn);
}

export class MainPeerManager{
 constructor(config={}){
  const {uuid,name,PeerClass=Peer,options=peerOptions(),onIncoming,onConnectionRequest,onCancel=()=>false,onConnected=()=>{},onDisconnected=()=>{},onState=()=>{},locks=navigator.locks,continuityStorage=defaultStorage()}=config;
  Object.assign(this,{uuid,name,PeerClass,options,onIncoming:onIncoming||(()=>{}),onConnectionRequest:onConnectionRequest||(()=>false),onCancel,onConnected,onDisconnected,onState,locks,continuityStorage});
  this.authorized=new Map();this.connections=new Map();this.resumeTimers=new Map();this.resumeAttempts=new Map();this.disconnectTimers=new Map();this.resumePending=new Set();this.continuity=new Map();
  this.acceptIncoming=typeof onIncoming==='function';
  this.id=stablePeerId(uuid);this.enabled=false;this.leader=false;this.loadContinuity();
 }
 state(value,detail=''){this.onState(value,detail);}
 loadContinuity(){
  this.continuity.clear();if(!this.continuityStorage)return;
  try{
   const rows=JSON.parse(this.continuityStorage.getItem(CONTINUITY_KEY)||'[]'),now=Date.now();
   if(Array.isArray(rows))for(const row of rows){const deviceId=safe(row?.deviceId),peerId=safe(row?.peerId),name=safe(row?.name);if(deviceId&&deviceId!==this.uuid&&peerId&&tokenOk(row?.token)&&Number.isFinite(row?.savedAt)&&now-row.savedAt<=CONTINUITY_TTL)this.continuity.set(deviceId,{deviceId,peerId,name:name||'Connected device',token:row.token,savedAt:row.savedAt});}
   this.flushContinuity();
  }catch{}
 }
 flushContinuity(){if(!this.continuityStorage)return;try{this.continuityStorage.setItem(CONTINUITY_KEY,JSON.stringify([...this.continuity.values()]));}catch{}}
 newContinuityToken(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
 rememberContinuity(member,token){
  if(!member?.deviceId||member.deviceId===this.uuid||!tokenOk(token))return;
  const row={deviceId:safe(member.deviceId),peerId:safe(member.id)||stablePeerId(member.deviceId),name:safe(member.name)||'Connected device',token,savedAt:Date.now()};
  this.continuity.set(row.deviceId,row);this.flushContinuity();
 }
 continuityFor(deviceId){return this.continuity.get(safe(deviceId));}
 forgetContinuity(deviceId){const id=safe(deviceId);this.clearResume(id);const removed=this.continuity.delete(id);if(removed)this.flushContinuity();return removed;}
 clearResume(deviceId){const id=safe(deviceId);clearTimeout(this.resumeTimers.get(id));clearTimeout(this.disconnectTimers.get(id));this.resumeTimers.delete(id);this.disconnectTimers.delete(id);this.resumeAttempts.delete(id);this.resumePending.delete(id);}
 async start(){
  if(this.enabled&&shared.id)return shared.id;
  this.enabled=true;shared.subscribers.add(this);
  if(shared.peer&&!shared.peer.destroyed){this.peer=shared.peer;this.id=shared.id||shared.peer.id;this.leader=true;this.state('connected','Main peer ready.');queueMicrotask(()=>this.resumeSavedConnections());return this.id;}
  if(shared.opening){const id=await shared.opening;this.peer=shared.peer;this.id=id;this.leader=!!shared.peer;queueMicrotask(()=>this.resumeSavedConnections());return id;}
  if(this.locks?.request){
   let decided;const ready=new Promise(r=>decided=r);
   this.lockTask=this.locks.request('wft-main-peer-leader',{ifAvailable:true},async lock=>{
    if(!this.enabled){decided();return;}
    if(!lock){this.leader=false;this.state('standby','Main Peer 1 is active in another tab.');decided();return;}
    this.leader=true;
    try{await this.open();decided();await new Promise(r=>this.releaseLock=r);}
    catch(e){this.leader=false;this.state('failed',e.message);decided();}
   }).catch(e=>{this.state('failed',e.message);decided();});
   await ready;
   return shared.id||this.id;
  }
  this.leader=true;return this.open();
 }
 open(){
  if(shared.opening)return shared.opening;
  shared.opening=new Promise((resolve,reject)=>{
   const stableId=stablePeerId(this.uuid);
   const tryOpen=attempt=>{
    if(!this.enabled){reject(Error('Main peer start was cancelled.'));return;}
    const p=new this.PeerClass(stableId,this.options);shared.peer=p;this.peer=p;let opened=false,finished=false;
    const timeout=setTimeout(()=>{if(finished)return;finished=true;p.destroy();if(shared.peer===p)shared.peer=null;reject(Error('Main peer did not start.'));},20000);
    p.on('open',id=>{if(finished)return;finished=true;opened=true;clearTimeout(timeout);shared.id=id;this.id=id;for(const manager of shared.subscribers){manager.peer=p;manager.id=id;manager.leader=true;manager.state('connected','Main peer ready.');queueMicrotask(()=>manager.resumeSavedConnections());}resolve(id);});
    p.on('connection',dispatchIncoming);
    p.on('disconnected',()=>{if(!opened||!shared.subscribers.size)return;for(const manager of shared.subscribers)manager.state('reconnecting','Main peer reconnecting…');try{p.reconnect();}catch{}});
    p.on('error',e=>{
     if(!opened){
      if(finished)return;finished=true;clearTimeout(timeout);p.destroy();if(shared.peer===p)shared.peer=null;
      if(e.type==='unavailable-id'&&attempt<6&&this.enabled){const delay=[150,300,600,1200,2400,4000][attempt]||4000;this.state('reconnecting','Reclaiming this device’s stable Peer 1 ID after refresh…');setTimeout(()=>tryOpen(attempt+1),delay);return;}
      reject(e);return;
     }
     if(e.type!=='peer-unavailable')for(const manager of shared.subscribers)manager.state('failed',`Main peer error (${e.type||'network'}).`);
    });
   };
   tryOpen(0);
  }).finally(()=>{shared.opening=null;});
  return shared.opening;
 }
 resumeSavedConnections(){if(!this.enabled||!this.peer||this.peer.disconnected)return;for(const link of this.continuity.values())if(!this.connections.get(link.deviceId)?.open)this.scheduleResume(link.deviceId,true);}
 scheduleResume(deviceId,initial=false){
  const id=safe(deviceId),link=this.continuity.get(id);if(!this.enabled||!link||this.connections.get(id)?.open||this.resumePending.has(id)||this.resumeTimers.has(id))return;
  const preferred=String(this.uuid).localeCompare(id)<0,attempt=this.resumeAttempts.get(id)||0;
  const base=initial?(preferred?120:2500):(preferred?Math.min(8000,250*2**Math.min(attempt,5)):Math.min(10000,2500+attempt*1200));
  this.resumeTimers.set(id,setTimeout(()=>{this.resumeTimers.delete(id);void this.attemptResume(id);},base));
 }
 async attemptResume(deviceId){
  const id=safe(deviceId),link=this.continuity.get(id);if(!this.enabled||!link||this.connections.get(id)?.open||this.resumePending.has(id))return;
  this.resumePending.add(id);let success=false;
  const targets=[stablePeerId(id),link.peerId].filter((value,index,array)=>value&&array.indexOf(value)===index);
  try{for(const remoteId of targets){try{await this.requestResume(link,remoteId,6000);success=true;break;}catch{}}}
  finally{this.resumePending.delete(id);}
  if(success){this.resumeAttempts.delete(id);return;}
  const attempts=(this.resumeAttempts.get(id)||0)+1;this.resumeAttempts.set(id,attempts);if(attempts<8)this.scheduleResume(id,false);
 }
 beginContinuity(member){
  const id=safe(member.deviceId);if(!this.enabled||!this.continuity.has(id)){this.authorized.delete(id);this.onDisconnected(member);return;}
  this.state('reconnecting',`${member.name} is refreshing or reconnecting…`);this.scheduleResume(id,true);
  if(!this.disconnectTimers.has(id))this.disconnectTimers.set(id,setTimeout(()=>{this.disconnectTimers.delete(id);if(this.connections.get(id)?.open)return;this.authorized.delete(id);this.onDisconnected(member);this.state('disconnected',`${member.name} is offline. The approved session can resume if the device returns.`);},RECONNECT_GRACE));
 }
 holdConnection(conn,member,{token=''}={}){
  const previous=this.connections.get(member.deviceId);this.clearResume(member.deviceId);this.connections.set(member.deviceId,conn);this.authorized.set(member.deviceId,member);if(tokenOk(token))this.rememberContinuity(member,token);
  if(previous&&previous!==conn)previous.close();
  const disconnected=()=>{
    if(this.connections.get(member.deviceId)!==conn)return;
    this.connections.delete(member.deviceId);
    if(!this.enabled){this.authorized.delete(member.deviceId);return;}
    this.beginContinuity(member);
  };
  conn.on('close',disconnected);conn.on('error',()=>{conn.close();disconnected();});
  conn.on('data',message=>{
    if(message?.type==='disconnect'){
      const current=this.connections.get(member.deviceId);this.forgetContinuity(member.deviceId);if(current===conn)this.connections.delete(member.deviceId);this.authorized.delete(member.deviceId);conn.close();this.onDisconnected(member);return;
    }
    if(message?.type!=='transfer-cancel'||typeof message.id!=='string'||message.id.length>64)return;
    const cancelled=this.onCancel(message.id,member)===true;
    if(conn.open)conn.send({type:'transfer-cancelled',id:message.id,cancelled});
  });
  this.onConnected(member);
 }
 accept(conn){
  const meta=conn.metadata||{};
  const member={id:conn.peer,deviceId:safe(meta.deviceId)||conn.peer,name:safe(meta.name)||'Online user',mode:'receive',onlineDirectory:true};
  if(meta.kind==='connection-resume'){
    const link=this.continuityFor(member.deviceId),token=safe(meta.resumeToken);
    if(!link||!tokenOk(token)||token!==link.token){conn.on('open',()=>conn.close());return;}
    let finished=false;const timer=setTimeout(()=>{if(!finished)conn.close();},10000);
    conn.on('close',()=>{finished=true;clearTimeout(timer);});conn.on('error',()=>{finished=true;clearTimeout(timer);conn.close();});
    conn.on('open',()=>{if(finished||!conn.open)return;finished=true;clearTimeout(timer);this.rememberContinuity(member,token);this.holdConnection(conn,member,{token});conn.send({type:'connection-resume-ready'});});return;
  }
  if(meta.kind==='connection-request'){
    const token=safe(meta.resumeToken);let accepted=false,finished=false;
    const timer=setTimeout(()=>{if(!finished)conn.close();},90000);
    conn.on('close',()=>{finished=true;clearTimeout(timer);});
    conn.on('error',()=>{clearTimeout(timer);conn.close();});
    conn.on('data',message=>{
      if(finished||!accepted||message?.type!=='connection-confirm')return;
      finished=true;clearTimeout(timer);
      this.holdConnection(conn,member,{token});
      conn.send({type:'connection-ready'});
    });
    conn.on('open',async()=>{
      try{accepted=await this.onConnectionRequest(member);}catch{}
      if(finished||!conn.open)return;
      conn.send({type:'connection-response',accepted});
      if(!accepted){finished=true;clearTimeout(timer);setTimeout(()=>conn.close(),200);}
    });return;
  }
  const authorized=this.authorized.get(member.deviceId);
  if(!authorized||authorized.id!==conn.peer){conn.on('open',()=>conn.close());return;}
  if(meta.kind==='connection-probe'){conn.on('open',()=>conn.send('ready'));return;}
  if(!['file-v3','file-v5'].includes(meta.kind)){conn.on('open',()=>conn.close());return;}
  this.onIncoming(conn,{...member,lane:Number.isInteger(meta.lane)?meta.lane:0});
 }
 requestResume(link,remoteId,timeout=6000){
  const peer=shared.peer||this.peer,id=safe(remoteId);if(!peer||peer.disconnected||!link||!tokenOk(link.token)||!id||id===peer.id)return Promise.reject(Error('Main peer is not ready to resume this device.'));
  const member={id,deviceId:link.deviceId,name:link.name||'Connected device',mode:'receive',onlineDirectory:true};
  const conn=peer.connect(id,{reliable:true,serialization:'json',metadata:{kind:'connection-resume',deviceId:this.uuid,name:this.name.slice(0,48),resumeToken:link.token}});
  return new Promise((resolve,reject)=>{let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){conn.close();reject(error);}else{this.rememberContinuity(member,link.token);this.holdConnection(conn,member,{token:link.token});resolve(member);}};const timer=setTimeout(()=>finish(Error('Automatic reconnection timed out.')),timeout);conn.on('data',message=>message?.type==='connection-resume-ready'&&finish());conn.on('error',()=>finish(Error('Automatic reconnection failed.')));conn.on('close',()=>finish(Error('Automatic reconnection closed early.')));});
 }
 connect(remoteId,transferId){
  const peer=shared.peer||this.peer;
  if(!peer||peer.disconnected)throw Error('Main peer is not ready in this tab.');
  const id=safe(remoteId);if(!id||id===peer.id)throw Error('Invalid destination peer.');
  if(![...this.authorized.values()].some(member=>member.id===id))throw Error('Connect to this device and wait for approval first.');
  return peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v5',transferId,lane:0,deviceId:this.uuid,name:this.name.slice(0,48)}});
 }
 connectLane(remoteId,transferId,lane){
  const peer=shared.peer||this.peer,id=safe(remoteId);
  if(!peer||peer.disconnected)throw Error('Main peer is not ready in this tab.');
  if(!id||id===peer.id||!Number.isInteger(lane)||lane<=0||lane>=4)throw Error('Invalid parallel transfer lane.');
  if(![...this.authorized.values()].some(member=>member.id===id))throw Error('Connect to this device and wait for approval first.');
  return peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v5',transferId,lane,deviceId:this.uuid,name:this.name.slice(0,48)}});
 }
 requestConnection(remoteId,member,timeout=90000){
  const peer=shared.peer||this.peer,id=safe(remoteId);
  if(!peer||peer.disconnected||!id||id===peer.id)return Promise.reject(Error('Main peer is not ready for this device.'));
  if(!member?.deviceId||member.id!==id)return Promise.reject(Error('Destination identity does not match.'));
  const existing=this.connections.get(member.deviceId);
  if(existing?.open&&this.authorized.get(member.deviceId)?.id===id)return Promise.resolve(member);
  const resumeToken=this.newContinuityToken();
  const conn=peer.connect(id,{reliable:true,serialization:'json',metadata:{kind:'connection-request',deviceId:this.uuid,name:this.name.slice(0,48),resumeToken}});
  return new Promise((resolve,reject)=>{
    let done=false,confirmed=false;
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){conn.close();reject(error);}else{this.holdConnection(conn,member,{token:resumeToken});resolve(member);}};
    const timer=setTimeout(()=>finish(Error('The destination device did not confirm the connection.')),timeout);
    conn.on('data',message=>{
      if(done)return;
      if(message?.type==='connection-response'){
        if(message.accepted!==true){finish(Error('The destination device declined the connection request.'));return;}
        confirmed=true;conn.send({type:'connection-confirm'});
      }else if(message?.type==='connection-ready'&&confirmed)finish();
    });
    conn.on('error',()=>finish(Error('Could not confirm the connection.')));
    conn.on('close',()=>finish(Error('The connection request closed early.')));
  });
 }
 probe(remoteId,timeout=20000){
  const peer=shared.peer||this.peer,id=safe(remoteId);if(!peer||peer.disconnected||!id||id===peer.id)return Promise.reject(Error('Main peer is not ready for this device.'));
  const conn=peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'connection-probe',deviceId:this.uuid,name:this.name.slice(0,48)}});
  return new Promise((resolve,reject)=>{let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){conn.close();reject(error);}else resolve(conn);};const timer=setTimeout(()=>finish(Error('File connection timed out.')),timeout);conn.on('data',value=>value==='ready'&&finish());conn.on('error',()=>finish(Error('Could not open the file connection.')));conn.on('close',()=>finish(Error('The file connection closed early.')));});
 }
 cancelTransfer(remoteId,id){
  const member=[...this.authorized.values()].find(m=>m.id===remoteId),conn=member&&this.connections.get(member.deviceId);
  if(!conn?.open)return Promise.resolve(false);
  return new Promise(resolve=>{
   let done=false;
   const finish=value=>{if(done)return;done=true;clearTimeout(timer);conn.off?.('data',receive);resolve(value);};
   const receive=message=>{if(message?.type==='transfer-cancelled'&&message.id===id)finish(message.cancelled===true);};
   const timer=setTimeout(()=>finish(false),5000);
   conn.on('data',receive);try{conn.send({type:'transfer-cancel',id});}catch{finish(false);}
  });
 }
 disconnect(deviceId){
  const id=safe(deviceId),conn=this.connections.get(id),member=this.authorized.get(id),hadContinuity=this.continuity.has(id);
  if(!conn&&!member&&!hadContinuity)return false;
  this.forgetContinuity(id);this.connections.delete(id);this.authorized.delete(id);
  if(conn?.open){try{conn.send({type:'disconnect',forgetContinuity:true});setTimeout(()=>conn.close(),250);}catch{conn.close();}}else conn?.close();
  if(member)this.onDisconnected(member);return true;
 }
 setName(name){this.name=name;for(const link of this.continuity.values())if(this.authorized.has(link.deviceId)){const member=this.authorized.get(link.deviceId);link.name=member?.name||link.name;}this.flushContinuity();}
 async stop(){
  if(!this.enabled)return;this.enabled=false;for(const timer of this.resumeTimers.values())clearTimeout(timer);for(const timer of this.disconnectTimers.values())clearTimeout(timer);this.resumeTimers.clear();this.disconnectTimers.clear();this.resumeAttempts.clear();this.resumePending.clear();for(const conn of this.connections.values())conn.close();this.connections.clear();this.authorized.clear();shared.subscribers.delete(this);this.peer=null;this.leader=false;
  // Continuity credentials intentionally remain in sessionStorage across reloads.
  // An explicit Disconnect clears them on both devices.
  if(!shared.subscribers.size){shared.peer?.destroy();shared.peer=null;shared.id='';this.releaseLock?.();this.releaseLock=null;}
  this.state('offline','Main peer subscription stopped.');
 }
}
