export async function appConcurrencyChecks(source){
 const check=(ok,message)=>{if(!ok)throw Error(message);},results=[];
 const section=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);if(a<0||b<0)throw Error('Application section missing');return source.slice(a,b);};
 const code=section('const busy =','const retainedBytes')+
 section('function drawHistory()','function setMode(')+
 section('function renderQueue()','function controls()')+
 section('function closeRequest()','let acceptanceGeneration=')+
 section('function track(','function resetPrepared(')+
 section('function incoming(','async function openRoom(');
 const run=new Function('check',`
 const transfers=new Map(),peerQueues=new Map(),cancelBarriers=new Map(),cancelledTransfers=new Map(),cards=new Map(),downloads=[];
 let active,offeredTransfer=null,history=[],files=[],serial=0;const deviceId='A',pendingTimers=[],nodes=new Map();
 const crypto={randomUUID:()=>String(++serial)},number=String,fmt=String;
 const setTimeout=fn=>{pendingTimers.push(fn);return fn;},clearTimeout=()=>{};
 const el=(tag,text)=>({tag,textContent:text,children:[],hidden:false,append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},setAttribute(){},closest(){return this;},showModal(){this.open=true;},close(){this.open=false;},focus(){}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,el('div'));return nodes.get(id);};
 const notice=()=>{},debug=()=>{},controls=()=>{},renderRecovery=async()=>{},scheduleReconnect=()=>{},receivedFile=()=>{},refreshAcceptance=async()=>{};
 const records={remove:async()=>{}},manifestFor=files=>files;
 class BlockTransfer{
  constructor(conn,options){Object.assign(this,{conn,options,id:options.id,direction:options.files?'send':'receive',state:'connecting',manifest:options.files||[],total:0});this.record={id:this.id};}
  terminal(){return ['complete','cancelled','declined','failed'].includes(this.state);}
  update(state){this.state=state;this.options.onUpdate({state,detail:state,files:this.manifest,localPaused:this.localPaused});}
  pause(){this.localPaused=true;this.update('paused');}
  resume(){this.localPaused=false;this.update('transferring');}
  cancel(){this.cleanupPromise=Promise.resolve();this.cancelAcknowledged=new Promise(r=>this.ack=r);this.update('cancelled');}
  attach(conn){this.conn=conn;this.attached=true;}
 }
 const peers=['B','C'].map(id=>({deviceId:id,id,name:id,room:{connect(peer,transferId){return {metadata:{kind:'file-v3',transferId},open:true,close(){this.open=false;}};}}}));
 const allMembers=()=>peers;
 `+code+`
 return {transfers,peerQueues,cancelBarriers,cancelledTransfers,cards,peers,nodes,
 get offered(){return offeredTransfer;},incoming,remoteCancel,showNextOffer,startSend,nextBatch,
 flush(){while(pendingTimers.length)pendingTimers.shift()();},track};
 `)(check);
 const [B,C]=run.peers,one=[{name:'one'}],two=[{name:'two'}];
 run.peerQueues.set('B',{member:B,batches:[one,two],paused:false});run.nextBatch('B');
 run.peerQueues.set('C',{member:C,batches:[one,two],paused:false});run.nextBatch('C');
 check(run.transfers.size===2,'Both peers must start simultaneously');
 const b=[...run.transfers.values()].find(e=>e.member===B).transfer,c=[...run.transfers.values()].find(e=>e.member===C).transfer;
 run.nextBatch('B');check(run.transfers.size===2,'Same peer batches must wait for completion');
 b.update('transferring');c.update('transferring');run.cards.get(b.id).pause.onclick();
 check(b.localPaused&&!c.localPaused,'Card pause must affect only its transfer');
 run.cards.get(b.id).resume.onclick();check(!b.localPaused,'Card resume failed');
 run.cards.get(b.id).cancel.onclick();check(!run.transfers.has(b.id)&&run.transfers.has(c.id),'Cancel closed another peer');
 check(run.cancelBarriers.has('B'),'Cancellation barrier missing');
 run.peerQueues.set('B',{member:B,batches:[one],paused:false});run.nextBatch('B');check(run.transfers.size===1,'Send must await cancellation acknowledgment');
 b.ack(true);await Promise.resolve();await Promise.resolve();run.flush();
 check(run.transfers.size===2,'Fresh send to cancelled peer did not start');
 const fresh=[...run.transfers.values()].find(e=>e.member===B).transfer;
 c.update('complete');run.flush();check([...run.transfers.values()].some(e=>e.member===C),'Other peer queue did not advance');
 check(run.transfers.has(fresh.id),'Completion stopped independent transfer');
 results.push('Per-peer queues start simultaneously, serialize batches per peer, and advance independently');
 results.push('Per-transfer Pause, Resume and Cancel isolate their actions');
 results.push('New selection waits for cancellation acknowledgment, then sends to the same peer');
 const connection=id=>({metadata:{kind:'file-v3',transferId:id},open:true,close(){this.open=false;}});
 const r1=connection('r1'),r2=connection('r2');run.incoming(r1,B);run.incoming(r2,C);
 const first=run.transfers.get('r1').transfer,second=run.transfers.get('r2').transfer;
 first.update('offered');second.update('offered');run.showNextOffer();check(run.offered===first,'First incoming offer missing');
 first.update('declined');run.flush();check(run.offered===second,'Next incoming offer was lost');
 check(!run.remoteCancel('r2',B),'Unrelated peer cancelled transfer');check(run.remoteCancel('r2',C),'Owner could not cancel transfer');
 const reconnect=connection(b.id);run.incoming(reconnect,B);check(!reconnect.open&&!run.transfers.has(b.id),'Cancelled transfer revived by delayed channel');
 const retry=connection(fresh.id);run.incoming(retry,B);check(!retry.open,'Inbound channel collided with outgoing transfer');
 results.push('Concurrent incoming offers retain separate receiver approvals');
 results.push('Peer identity checks and cancelled-ID tombstones reject stray cancellation/reconnects');
 return results;
}