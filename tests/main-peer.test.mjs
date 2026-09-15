import test from 'node:test';
import {MainPeerManager} from '../src/main-peer.js';
export async function checkTwoWayConnections(makeManager) {
  const assert=(v,m)=>{if(!v)throw Error(m);};
  const pending=[];const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  class Channel {
    constructor(peer,metadata){this.peer=peer;this.metadata=metadata;this.open=false;this.events=new Map();}
    on(type,fn){const list=this.events.get(type)||[];list.push(fn);this.events.set(type,list);}
    emit(type,data){for(const fn of this.events.get(type)||[])fn(data);}
    send(data){if(!this.open)throw Error('Closed channel');Promise.resolve().then(()=>{if(this.other.open)this.other.emit('data',data);});}
    close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}
  }
  let aConnected=0,bConnected=0,aIncoming=0,bIncoming=0;
  const a=makeManager({uuid:'a',name:'日本の端末',onIncoming:()=>aIncoming++,onConnected:()=>aConnected++});
  const b=makeManager({uuid:'b',name:'هاتف',onConnectionRequest:()=>true,onIncoming:()=>bIncoming++,onConnected:()=>bConnected++});
  const wire=(from,to)=>({id:from.id,disconnected:false,connect(id,options){
    assert(id===to.id,'Wrong peer destination');
    const left=new Channel(to.id,options.metadata),right=new Channel(from.id,options.metadata);
    left.other=right;right.other=left;to.accept(right);
    Promise.resolve().then(()=>{left.open=right.open=true;right.emit('open');left.emit('open');});
    pending.push(left);return left;
  }});
  a.peer=wire(a,b);b.peer=wire(b,a);
  const member={id:b.id,deviceId:'b',name:b.name,onlineDirectory:true};
  await a.requestConnection(b.id,member,1000);await tick();
  assert(aConnected===1&&bConnected===1,'Both sides must confirm connection');
  assert(a.authorized.has('b')&&b.authorized.has('a'),'Both sides must authorize');
  assert(a.connections.get('b').open&&b.connections.get('a').open,'Control link must stay open');
  const ab=a.connect(b.id,'file-one'),ba=b.connect(a.id,'file-two');await tick();
  assert(aIncoming===1&&bIncoming===1,'Both directions must accept a file channel');
  ab.close();ba.close();
  assert(a.authorized.has('b')&&b.authorized.has('a'),'File completion must preserve pairing');
  const probe=await b.probe(a.id,1000);probe.close();
  assert(a.connections.get('b').open,'Probe must not close pairing');
  const spoof=new Channel('different-peer',{kind:'file-v3',deviceId:'a',name:'spoof'});
  spoof.other={open:false};b.accept(spoof);spoof.open=true;spoof.emit('open');
  assert(!spoof.open&&bIncoming===1,'Authorization must match peer ID as well as device ID');
  assert(a.disconnect('b'),'Explicit disconnect should close the selected device');await tick();
  assert(!a.authorized.size&&!b.authorized.size,'Explicit disconnect must remove both authorizations');
  let refused=false;try{a.connect(b.id,'third');}catch{refused=true;}
  assert(refused,'Sending must require a current approved connection');
  b.onConnectionRequest=()=>false;refused=false;
  try{await a.requestConnection(b.id,member,1000);}catch{refused=true;}
  assert(refused&&!a.authorized.size&&!b.authorized.size,'Declined requests must not authorize');
  for(const c of pending)c.close();
  return 'Two-way confirmation, reverse file channels, persistent pairing, probe, spoof rejection, disconnect, and decline checks passed';
}

test('online pairing confirms both sides and allows sending either way',async()=>{await checkTwoWayConnections(config=>new MainPeerManager({...config,options:{},locks:null,continuityStorage:null}));});

test('accepted connection resumes after reload without asking for approval again',async()=>{
  const assert=(v,m)=>{if(!v)throw Error(m);};
  const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  class MemoryStorage{constructor(){this.map=new Map();}getItem(k){return this.map.get(k)??null;}setItem(k,v){this.map.set(k,String(v));}}
  class Channel{
    constructor(peer,metadata){this.peer=peer;this.metadata=metadata;this.open=false;this.events=new Map();}
    on(type,fn){const list=this.events.get(type)||[];list.push(fn);this.events.set(type,list);}
    emit(type,data){for(const fn of this.events.get(type)||[])fn(data);}
    send(data){if(!this.open)throw Error('Closed channel');Promise.resolve().then(()=>{if(this.other.open)this.other.emit('data',data);});}
    close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}
  }
  const wire=(from,to)=>({id:from.id,disconnected:false,connect(id,options){
    assert(id===to.id,'Wrong peer destination during continuity test');
    const left=new Channel(to.id,options.metadata),right=new Channel(from.id,options.metadata);left.other=right;right.other=left;to.accept(right);
    Promise.resolve().then(()=>{left.open=right.open=true;right.emit('open');left.emit('open');});return left;
  }});
  const aStore=new MemoryStorage(),bStore=new MemoryStorage();let firstApprovals=0,reloadApprovals=0;
  const a=new MainPeerManager({uuid:'a',name:'A',options:{},locks:null,continuityStorage:aStore,onConnectionRequest:()=>true,onIncoming:()=>{}});
  const b=new MainPeerManager({uuid:'b',name:'B',options:{},locks:null,continuityStorage:bStore,onConnectionRequest:()=>{firstApprovals++;return true;},onIncoming:()=>{}});
  a.peer=wire(a,b);b.peer=wire(b,a);
  await a.requestConnection(b.id,{id:b.id,deviceId:'b',name:'B',onlineDirectory:true},1000);await tick();
  const saved=a.continuityFor('b');assert(saved&&saved.token&&b.continuityFor('a')?.token===saved.token,'Both devices must persist the same reload continuity token');
  a.connections.get('b').close();await tick();
  const bReload=new MainPeerManager({uuid:'b',name:'B',options:{},locks:null,continuityStorage:bStore,onConnectionRequest:()=>{reloadApprovals++;return false;},onIncoming:()=>{}});
  a.peer=wire(a,bReload);bReload.peer=wire(bReload,a);
  await a.requestResume(saved,bReload.id,1000);await tick();
  assert(firstApprovals===1&&reloadApprovals===0,'Reload continuity must not show the connection approval dialog again');
  assert(a.connections.get('b')?.open&&bReload.connections.get('a')?.open,'Reload must restore the live control connection');
  assert(a.authorized.get('b')?.id===bReload.id&&bReload.authorized.get('a')?.id===a.id,'Reload must restore both authorizations');
  assert(a.disconnect('b'),'Explicit disconnect must still work after automatic resume');await tick();
  assert(!a.continuityFor('b')&&!bReload.continuityFor('a'),'Explicit disconnect must revoke reload continuity on both devices');
});
