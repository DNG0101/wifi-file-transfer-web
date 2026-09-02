import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Room,parseRoom,newCode,peerOptions,configureIce} from '../src/room.js';
class FakePeer extends EventEmitter {
  static instances=[];
  constructor(id,options){super();this.id=id||'guest';this.options=options;FakePeer.instances.push(this);}
  destroy(){this.destroyed=true;this.emit('disconnected');}
  connect(id){this.connection=new FakeConn(id);return this.connection;}
}
class FakeConn extends EventEmitter {
  constructor(id){super();this.peer=id;this.open=true;this.sent=[];this.metadata={kind:'room-v2'};}
  send(m){this.sent.push(m);}
  close(){this.open=false;this.emit('close');}
}
test('codes and pasted invite URLs are accepted but invalid input is rejected',()=>{
  assert.equal(parseRoom(' ABCD-efgh-2345 '),'abcdefgh2345');
  assert.equal(parseRoom('https://example.com/#room=abcdefgh2345&mode=receive'),'abcdefgh2345');
  assert.throws(()=>parseRoom('wrong'));
  for(let i=0;i<100;i++)assert.equal(parseRoom(newCode()).length,12);
});
test('retired public TURN is removed, redundant STUN and configured TURN are preserved',()=>{
  const servers=peerOptions().config.iceServers.flatMap(s=>s.urls);
  assert.equal(servers.filter(s=>s.startsWith('stun:')).length,2);assert.ok(!servers.some(s=>s.startsWith('turn:')));
  configureIce([{urls:'turns:relay.example:5349',username:'temporary-test',credential:'test-only'}]);assert.ok(peerOptions().config.iceServers.some(s=>s.urls==='turns:relay.example:5349'));configureIce([]);
});
test('closing while signaling opens rejects promptly and ignores late open events',async()=>{
  const states=[];const room=new Room({onState:s=>states.push(s)},{PeerClass:FakePeer});
  const opening=room.open('abcdefgh2345',true,'Host','send');const failure=assert.rejects(opening,/cancelled/);
  room.close();room.peer.emit('open');await failure;assert.equal(room.state,'closed');assert.equal(room.id,undefined);assert.deepEqual(states,['connecting','closed']);
});
test('unverified room connections do not receive member rosters',async()=>{
  const room=new Room({},{PeerClass:FakePeer});const opening=room.open('abcdefgh2345',true,'Host','send');room.peer.emit('open');await opening;
  const stranger=new FakeConn('unknown');room.incoming(stranger);room.broadcast();assert.equal(stranger.sent.length,0);
  stranger.emit('data',{type:'join',code:'wrong',member:{name:'Stranger',mode:'receive'}});assert.equal(stranger.open,false);room.close();
});
test('member removal and closed-room callbacks are deterministic',async()=>{
  let roster=[];const room=new Room({onMembers:m=>roster=m},{PeerClass:FakePeer});const opening=room.open('abcdefgh2345',true,'Host','send');room.peer.emit('open');await opening;
  const guest=new FakeConn('guest');room.incoming(guest);guest.emit('data',{type:'join',code:'abcdefgh2345',member:{name:'Receiver',mode:'receive'}});await Promise.resolve();await Promise.resolve();
  assert.equal(roster.length,1);guest.close();assert.equal(roster.length,0);room.close();guest.emit('data',{type:'join',code:'abcdefgh2345',member:{name:'Late',mode:'receive'}});assert.equal(room.members.size,0);
});
test('destination explicitly accepts or rejects before a joining peer becomes connected',async()=>{
  let decide;const approval=new Promise(resolve=>decide=resolve);let roster=[];
  const room=new Room({onConnectionRequest:()=>approval,onMembers:m=>roster=m},{PeerClass:FakePeer});const opening=room.open('abcdefgh2345',true,'Host','receive');room.peer.emit('open');await opening;
  const guest=new FakeConn('guest');room.incoming(guest);guest.emit('data',{type:'join',code:'abcdefgh2345',member:{name:'Guest',mode:'send',deviceId:'guest-device'}});
  assert.equal(roster.length,0);decide(true);await Promise.resolve();await Promise.resolve();assert.equal(roster.length,1);room.close();
  let reject;const refusal=new Promise(resolve=>reject=resolve);const denied=new Room({onConnectionRequest:()=>refusal},{PeerClass:FakePeer});const deniedOpening=denied.open('abcdefgh2345',true,'Host','receive');denied.peer.emit('open');await deniedOpening;
  const stranger=new FakeConn('stranger');denied.incoming(stranger);stranger.emit('data',{type:'join',code:'abcdefgh2345',member:{name:'Stranger',mode:'send',deviceId:'stranger-device'}});reject(false);await Promise.resolve();await Promise.resolve();assert.equal(denied.members.has('stranger'),false);assert.deepEqual(stranger.sent.at(-1),{type:'rejected',reason:'declined'});denied.close();
});
test('disconnected rooms refuse new file connections',async()=>{
  const room=new Room({},{PeerClass:FakePeer});const opening=room.open('abcdefgh2345',true,'Host','send');room.peer.emit('open');await opening;room.members.set('guest',{id:'guest',name:'Receiver',mode:'receive'});room.setState('disconnected');assert.throws(()=>room.connect('guest'),/Retry connection/);room.close();
});
test('expired invitations reject new devices without interrupting existing members',async()=>{
 const room=new Room({},{PeerClass:FakePeer,inviteLifetime:-1});const opening=room.open('abcdefgh2345',true,'Host','receive');room.peer.emit('open');await opening;
 const guest=new FakeConn('new-device');room.incoming(guest);guest.emit('data',{type:'join',code:'abcdefgh2345',member:{name:'New',mode:'send',deviceId:crypto.randomUUID()}});assert.deepEqual(guest.sent.at(-1),{type:'rejected',reason:'expired'});assert.equal(room.members.size,1);room.close();
});

test('expired invitation gives the guest a specific new-QR recovery message',async()=>{
 const room=new Room({},{PeerClass:FakePeer});
 const opening=room.open('abcdefgh2345',false,'Guest','send');
 room.peer.emit('open');await Promise.resolve();
 const failure=assert.rejects(opening,/expired.*New invitation/);
 room.control.emit('data',{type:'rejected',reason:'expired'});
 await failure;room.close();
});
test('unavailable QR creator rejects the join immediately instead of waiting for timeout',async()=>{
 const room=new Room({},{PeerClass:FakePeer});
 const opening=room.open('abcdefgh2345',false,'Guest','send');
 room.peer.emit('open');await Promise.resolve();
 const failure=assert.rejects(opening,/unavailable/);
 room.peer.emit('error',{type:'peer-unavailable'});
 await failure;room.close();
});

test('connected room peers can receive file channels regardless of their current UI mode',async()=>{
  let transfers=0;const room=new Room({onTransfer:()=>transfers++},{PeerClass:FakePeer});
  const opening=room.open('abcdefgh2345',true,'Host','send');room.peer.emit('open');await opening;
  room.members.set('guest',{id:'guest',name:'Guest',mode:'receive',deviceId:'guest-device'});
  const incoming=new FakeConn('guest');incoming.metadata={kind:'file-v3',transferId:crypto.randomUUID()};room.incoming(incoming);
  assert.equal(room.mode,'send');assert.equal(transfers,1,'Send-mode peer must still accept an incoming transfer offer from a connected member');room.close();
});
