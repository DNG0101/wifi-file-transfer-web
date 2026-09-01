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
  const {uuid,name,PeerClass=Peer,options=peerOptions(),onIncoming,onState=()=>{},locks=navigator.locks}=config;
  Object.assign(this,{uuid,name,PeerClass,options,onIncoming:onIncoming||(()=>{}),onState,locks});
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
 accept(conn){
  if(conn.metadata?.kind!=='file-v3'){conn.on('open',()=>conn.close());return;}
  const meta=conn.metadata||{};
  const member={id:conn.peer,deviceId:safe(meta.deviceId)||conn.peer,name:safe(meta.name)||'Online user',mode:'receive',onlineDirectory:true};
  this.onIncoming(conn,member);
 }
 connect(remoteId,transferId){
  const peer=shared.peer||this.peer;
  if(!peer||peer.disconnected)throw Error('Main peer is not ready in this tab.');
  const id=safe(remoteId);if(!id||id===peer.id)throw Error('Invalid destination peer.');
  return peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v3',transferId,deviceId:this.uuid,name:this.name.slice(0,48)}});
 }
 setName(name){this.name=name;}
 async stop(){
  if(!this.enabled)return;this.enabled=false;shared.subscribers.delete(this);this.peer=null;this.leader=false;
  // Peer 1 belongs to the application session, not to the Online toggle. It is
  // destroyed only when no manager still owns it (normally when the page ends).
  if(!shared.subscribers.size){shared.peer?.destroy();shared.peer=null;shared.id='';this.releaseLock?.();this.releaseLock=null;}
  this.state('offline','Main peer subscription stopped.');
 }
}
