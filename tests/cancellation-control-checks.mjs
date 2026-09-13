export async function cancellationControlChecks(mainSource,devicesSource){
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 const MainPeerManager=new Function('PeerModule','peerOptions','navigator',mainSource.replace(/^import .*;\n/gm,'').replace(/export /g,'')+';return MainPeerManager;')({Peer:class{}},()=>({}),{});
 class Channel{
  open=true;listeners=new Map();
  on(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
  off(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(f=>f!==fn));}
  send(value){Promise.resolve().then(()=>{if(this.other.open)for(const fn of [...(this.other.listeners.get('data')||[])])fn(value);});}
  close(){if(!this.open)return;this.open=false;for(const fn of this.listeners.get('close')||[])fn();}
 }
 const a=new Channel(),b=new Channel();a.other=b;b.other=a;
 const received=[],A=new MainPeerManager({uuid:'A',name:'A',onCancel:(id,m)=>{received.push([id,m.deviceId]);return id==='reverse';}}),B=new MainPeerManager({uuid:'B',name:'B',onCancel:(id,m)=>{received.push([id,m.deviceId]);return id==='forward';}});
 A.holdConnection(a,{deviceId:'B',id:'peer-B'});B.holdConnection(b,{deviceId:'A',id:'peer-A'});
 check(await A.cancelTransfer('peer-B','forward'),'Forward cancellation missing');
 check(await B.cancelTransfer('peer-A','reverse'),'Reverse cancellation missing');
 check(await A.cancelTransfer('peer-B','unknown')===false,'Unknown cancellation was confirmed');
 check(a.open&&b.open&&A.authorized.has('B')&&B.authorized.has('A'),'Cancellation closed approval connection');
 check((a.listeners.get('data')||[]).length===1&&(b.listeners.get('data')||[]).length===1,'Acknowledgment listeners leaked');
 check(await A.cancelTransfer('unapproved','forward')===false,'Unapproved peer allowed');
 const opened=[];
 class Room{constructor(cb){this.cb=cb;opened.push(this);}async open(){}close(){}}
 const TrustedDevices=new Function('Room','deviceRecords',devicesSource.replace(/^import .*;\n/gm,'').replace(/export /g,'')+';return TrustedDevices;')(Room,{});
 const trusted=new TrustedDevices({id:'A',name:'A',mode:'send',onCancel:(id,m)=>id==='trusted'&&m.deviceId==='B'});trusted.contacts=[{id:'B',name:'B',secret:'secret'}];await trusted.refresh();
 let reply;opened[0].cb.onMessage({type:'transfer-cancel',id:'trusted'},{deviceId:'B'},value=>reply=value);
 check(reply.cancelled,'Remembered peer cancellation missing');
 opened[0].cb.onMessage({type:'transfer-cancel',id:'trusted'},{deviceId:'C'},value=>reply=value);check(reply.cancelled===false,'Wrong remembered identity accepted');
 a.close();b.close();
 return ['Persistent approved channel carries cancellation in either direction and remains connected','Unknown peers are rejected and request listeners are removed','Remembered device cancellation checks peer identity'];
}