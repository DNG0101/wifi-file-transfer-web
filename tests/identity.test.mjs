import test from 'node:test';
import assert from 'node:assert/strict';
import {identity} from '../src/devices.js';
const storage=()=>({data:new Map(),getItem(k){return this.data.get(k)??null;},setItem(k,v){this.data.set(k,String(v));},removeItem(k){this.data.delete(k);}});
test('persistent installation UUID is generated once and reused',()=>{
 globalThis.localStorage=storage();const first=identity(),second=identity();assert.equal(first,second);assert.equal(localStorage.getItem('app_device_uuid'),first);assert.equal(localStorage.getItem('wft-device-id'),first);
});
test('latest valid identity candidate wins and obsolete candidates are removed',()=>{
 globalThis.localStorage=storage();const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 localStorage.setItem('wft-identity-candidates',JSON.stringify([{id:a,version:3,updatedAt:500},{id:b,version:5,updatedAt:100}]));
 assert.equal(identity(),b);assert.equal(localStorage.getItem('wft-identity-candidates'),null);assert.equal(identity(),b);
});
test('invalid duplicate identity values never replace a valid stable UUID',()=>{
 globalThis.localStorage=storage();const good='cccccccc-cccc-4ccc-8ccc-cccccccccccc';localStorage.setItem('wft-device-id',good);localStorage.setItem('app_device_uuid','invalid');
 assert.equal(identity(),good);assert.equal(localStorage.getItem('app_device_uuid'),good);
});
