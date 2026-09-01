import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePresence,mergePresenceRecords,validPresence,STALE_MS,MAX_RECORDS,HEARTBEAT_MS} from '../src/presence-db.js';
const now=1_800_000_000_000;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(uuid,overrides={})=>({uuid,name:'Device',peerId:'peer-1',peer2Id:'presence-1',status:'online',version:1,revision:1,heartbeatSeq:1,lastSeen:now,updatedAt:now,...overrides});
test('presence merge is distinct, idempotent, deterministic and revision-first',()=>{
 const old=row(id(1),{peerId:'old',version:3,revision:3,heartbeatSeq:90}),fresh=row(id(1),{peerId:'new',version:4,revision:4,heartbeatSeq:1});
 assert.equal(comparePresence(old,fresh)<0,true);
 const once=mergePresenceRecords([old],[fresh,fresh],now),twice=mergePresenceRecords(once,[old,fresh],now);
 assert.deepEqual(once,twice);assert.equal(once.length,1);assert.equal(once[0].peerId,'new');
 const a=row(id(2),{peerId:'a'}),b=row(id(2),{peerId:'b'});
 assert.deepEqual(mergePresenceRecords([a],[b],now),mergePresenceRecords([b],[a],now));
});
test('heartbeat sequence wins within a revision and offline updates hide old online rows',()=>{
 const live=row(id(1),{heartbeatSeq:8}),newer=row(id(1),{heartbeatSeq:9,status:'offline'});
 assert.equal(mergePresenceRecords([live],[newer],now)[0].status,'offline');
});
test('expired rows cannot resurrect but a fresh return with same UUID is accepted',()=>{
 const expired=row(id(1),{version:100,revision:100,lastSeen:now-STALE_MS-1,updatedAt:now-STALE_MS-1});
 assert.deepEqual(mergePresenceRecords([], [expired],now),[]);
 const returned=row(id(1),{version:101,revision:101,lastSeen:now,updatedAt:now});
 assert.deepEqual(mergePresenceRecords([expired],[returned],now),[returned]);
});
test('presence validation bounds all network-controlled fields',()=>{
 assert.equal(validPresence(row(id(1)),now),true);
 for(const invalid of [row('bad'),row(id(1),{name:'x'.repeat(49)}),row(id(1),{peerId:'x'.repeat(129)}),row(id(1),{version:-1,revision:-1}),row(id(1),{lastSeen:now+60001}),row(id(1),{status:'maybe'})])assert.equal(validPresence(invalid,now),false);
 assert.equal(MAX_RECORDS,256);
 assert.equal(HEARTBEAT_MS,20000);
});


