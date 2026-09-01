import * as PeerModule from 'peerjs';
import {peerOptions} from './room.js';
const Peer=PeerModule.Peer||PeerModule.default.Peer||PeerModule.default;

const safe=value=>String(value||'').trim().slice(0,128);

export class MainPeerManager{
 constructor({uuid,name,PeerClass=Peer,options=peerOptions(),onIncoming=()=>{},onState=()=>{},locks=navigator.locks}){
  Object.assign(this,{uuid,name,PeerClass,options,onIncoming,onState,locks});
  this.id=`wftp-main-${uuid}`;this.enabled=false;this.leader=false;
 }
 state(value,detail=''){this.onState(value,detail);}
 async start(){
  if(this.enabled)return this.peer?.id||'';this.enabled=true;
  if(this.locks?.request){
   let decided;const ready=new Promise(r=>decided=r);
   this.lockTask=this.locks.request('wft-main-peer-leader',{ifAvailable:true},async lock=>{
    if(!this.enabled){decided();return;}
    if(!lock){this.state('standby','Main peer is active in another tab.');decided();return;}
    this.leader=true;
    try{await this.open();decided();await new Promise(r=>this.releaseLock=r);}
    catch(e){this.leader=false;this.state('failed',e.message);decided();}
   }).catch(e=>{this.state('failed',e.message);decided();});
   await ready;
   return this.peer?.id||'';
  }
  this.leader=true;await this.open();return this.peer.id;
 }
 open(){return new Promise((resolve,reject)=>{
  const p=new this.PeerClass(this.id,this.options);this.peer=p;let opened=false;
  const timeout=setTimeout(()=>{if(!opened){p.destroy();reject(Error('Main peer did not start.'));}},20000);
  p.on('open',id=>{opened=true;clearTimeout(timeout);this.id=id;this.state('connected','Main peer ready.');resolve(id);});
  p.on('connection',conn=>this.accept(conn));
  p.on('disconnected',()=>{if(!this.enabled)return;this.state('reconnecting','Main peer reconnecting…');try{p.reconnect();}catch{}});
  p.on('error',e=>{if(!opened){clearTimeout(timeout);reject(e);}else if(e.type!=='peer-unavailable')this.state('failed',`Main peer error (${e.type||'network'}).`);});
 });}
 accept(conn){
  if(conn.metadata?.kind!=='file-v3'){conn.on('open',()=>conn.close());return;}
  const meta=conn.metadata||{};
  const member={id:conn.peer,deviceId:safe(meta.deviceId)||conn.peer,name:safe(meta.name)||'Online user',mode:'receive',onlineDirectory:true};
  this.onIncoming(conn,member);
 }
 connect(remoteId,transferId){
  if(!this.peer||this.peer.disconnected||!this.leader)throw Error('Main peer is not ready in this tab.');
  const id=safe(remoteId);if(!id||id===this.peer.id)throw Error('Invalid destination peer.');
  return this.peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v3',transferId,deviceId:this.uuid,name:this.name.slice(0,48)}});
 }
 setName(name){this.name=name;}
 async stop(){
  if(!this.enabled)return;this.enabled=false;this.peer?.destroy();this.peer=null;this.leader=false;this.releaseLock?.();this.releaseLock=null;this.state('offline','Main peer stopped.');
 }
}
