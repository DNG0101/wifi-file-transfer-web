import test from 'node:test';
import assert from 'node:assert/strict';
import {parallelism,validateParallelism,bindParallelism} from '../src/parallelism.js';
test('slider supports every integer from 8 to 50 with exactly twice as many blocks',()=>{
 const input={value:'',setAttribute(k,v){this[k]=v;},addEventListener(_,fn){this.change=fn;}},output={};
 const read=bindParallelism(input,output);
 assert.equal(input.min,'8');assert.equal(input.max,'50');assert.equal(input.step,'1');assert.equal(input.value,'8');assert.equal(output.textContent,'8 lanes / 16 blocks');
 for(let lanes=8;lanes<=50;lanes++){input.value=String(lanes);input.change();assert.deepEqual(read(),{lanes,blocks:lanes*2});assert.equal(input['aria-valuetext'],`${lanes} lanes / ${lanes*2} blocks`);}
 assert.deepEqual(parallelism(-2),{lanes:8,blocks:16});assert.deepEqual(parallelism(100),{lanes:50,blocks:100});assert.deepEqual(parallelism(NaN),{lanes:8,blocks:16});
});
test('peer cannot request invalid ratios or exceed 50 lanes / 100 blocks',()=>{
 for(const value of [null,{}, {lanes:7,blocks:14},{lanes:51,blocks:102},{lanes:8,blocks:100},{lanes:8.5,blocks:17},{lanes:'8',blocks:16}])assert.throws(()=>validateParallelism(value));
 assert.deepEqual(validateParallelism({lanes:50,blocks:100}),{lanes:50,blocks:100});
});
