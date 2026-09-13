import * as PeerModule from 'peerjs';
import {peerOptions} from './room.js';
const Peer=PeerModule.Peer||PeerModule.default.Peer||PeerModule.default;

const safe=value=>String(value||'').trim().slice(0,128);
const shared={peer:null,id:'',opening:null,subscribers:new Set()};

function dispatchIncoming(conn){
 const targets=[...shared.subscribers].reverse().filter(manager=>manager.enabled&&manager.acceptIncoming);
 const target=targets[0];
 if(!target){conn.on('open',()=>conn.close());return;}
 target.accept(conn);
}

export class MainPeerManager{
 constructor(config={}){
  const {uuid,name,PeerClass=Peer,options=peerOptions(),onIncoming,onConnectionRequest,onCancel=()=>false,onConnected=()=>{},onDisconnected=()=>{},onState=()=>{},locks=navigator.locks}=config;
  Object.assign(this,{uuid,name,PeerClass,options,onIncoming:onIncoming||(()=>{}),onConnectionRequest:onConnectionRequest||(()=>false),onCancel,onConnected,onDisconnected,onState,locks});this.authorized=new Map();this.connections=new Map();
  this.acceptIncoming=typeof onIncoming==='function';
  this.id=`wftp-main-${uuid}`;this.enabled=false;this.leader=false;
 }
 state(value,detail=''){this.onState(value,detail);}
 async start(){
  if(this.enabled&&shared.id)return shared.id;
  this.enabled=true;shared.subscribers.add(this);
  if(shared.peer&&!shared.peer.destroyed){this.peer=shared.peer;this.id=shared.id||shared.peer.id;this.leader=true;this.state('connected','Main peer ready.');return this.id;}
  if(shared.opening){const id=await shared.opening;this.peer=shared.peer;this.id=id;this.leader=!!shared.peer;return id;}
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
   const p=new this.PeerClass(this.id,this.options);shared.peer=p;this.peer=p;let opened=false;
   const timeout=setTimeout(()=>{if(!opened){p.destroy();shared.peer=null;reject(Error('Main peer did not start.'));}},20000);
   p.on('open',id=>{opened=true;clearTimeout(timeout);shared.id=id;this.id=id;for(const manager of shared.subscribers){manager.peer=p;manager.id=id;manager.leader=true;manager.state('connected','Main peer ready.');}resolve(id);});
   p.on('connection',dispatchIncoming);
   p.on('disconnected',()=>{if(!shared.subscribers.size)return;for(const manager of shared.subscribers)manager.state('reconnecting','Main peer reconnecting…');try{p.reconnect();}catch{}});
   p.on('error',e=>{if(!opened){clearTimeout(timeout);shared.peer=null;reject(e);}else if(e.type!=='peer-unavailable')for(const manager of shared.subscribers)manager.state('failed',`Main peer error (${e.type||'network'}).`);});
  }).finally(()=>{shared.opening=null;});
  return shared.opening;
 }
 holdConnection(conn,member){
  const previous=this.connections.get(member.deviceId);
  this.connections.set(member.deviceId,conn);this.authorized.set(member.deviceId,member);
  if(previous&&previous!==conn)previous.close();
  const disconnected=()=>{
    if(this.connections.get(member.deviceId)!==conn)return;
    this.connections.delete(member.deviceId);this.authorized.delete(member.deviceId);
    this.onDisconnected(member);
  };
  conn.on('close',disconnected);conn.on('error',()=>{conn.close();disconnected();});
  conn.on('data',message=>{
    if(message?.type!=='transfer-cancel'||typeof message.id!=='string'||message.id.length>64)return;
    const cancelled=this.onCancel(message.id,member)===true;
    if(conn.open)conn.send({type:'transfer-cancelled',id:message.id,cancelled});
  });
  this.onConnected(member);
 }
 accept(conn){
  const meta=conn.metadata||{};
  const member={id:conn.peer,deviceId:safe(meta.deviceId)||conn.peer,name:safe(meta.name)||'Online user',mode:'receive',onlineDirectory:true};
  if(meta.kind==='connection-request'){
    let accepted=false,finished=false;
    const timer=setTimeout(()=>{if(!finished)conn.close();},90000);
    conn.on('close',()=>{finished=true;clearTimeout(timer);});
    conn.on('error',()=>{clearTimeout(timer);conn.close();});
    conn.on('data',message=>{
      if(finished||!accepted||message?.type!=='connection-confirm')return;
      finished=true;clearTimeout(timer);
      this.holdConnection(conn,member);
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
  if(meta.kind!=='file-v3'){conn.on('open',()=>conn.close());return;}
  this.onIncoming(conn,member);
 }
 connect(remoteId,transferId){
  const peer=shared.peer||this.peer;
  if(!peer||peer.disconnected)throw Error('Main peer is not ready in this tab.');
  const id=safe(remoteId);if(!id||id===peer.id)throw Error('Invalid destination peer.');
  if(![...this.authorized.values()].some(member=>member.id===id))throw Error('Connect to this device and wait for approval first.');
  return peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v3',transferId,deviceId:this.uuid,name:this.name.slice(0,48)}});
 }
 requestConnection(remoteId,member,timeout=90000){
  const peer=shared.peer||this.peer,id=safe(remoteId);
  if(!peer||peer.disconnected||!id||id===peer.id)return Promise.reject(Error('Main peer is not ready for this device.'));
  if(!member?.deviceId||member.id!==id)return Promise.reject(Error('Destination identity does not match.'));
  const existing=this.connections.get(member.deviceId);
  if(existing?.open&&this.authorized.get(member.deviceId)?.id===id)return Promise.resolve(member);
  const conn=peer.connect(id,{reliable:true,serialization:'json',metadata:{kind:'connection-request',deviceId:this.uuid,name:this.name.slice(0,48)}});
  return new Promise((resolve,reject)=>{
    let done=false,confirmed=false;
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){conn.close();reject(error);}else{this.holdConnection(conn,member);resolve(member);}};
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
 setName(name){this.name=name;}
 async stop(){
  if(!this.enabled)return;for(const conn of this.connections.values())conn.close();this.connections.clear();this.authorized.clear();this.enabled=false;shared.subscribers.delete(this);this.peer=null;this.leader=false;
  // Peer 1 belongs to the application session, not to the Online toggle. It is
  // destroyed only when no manager still owns it (normally when the page ends).
  if(!shared.subscribers.size){shared.peer?.destroy();shared.peer=null;shared.id='';this.releaseLock?.();this.releaseLock=null;}
  this.state('offline','Main peer subscription stopped.');
 }
}
