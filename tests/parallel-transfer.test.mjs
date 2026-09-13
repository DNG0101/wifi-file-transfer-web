import test from 'node:test';
import {BlockTransfer} from '../src/block-transfer.js';
import {blockHash} from '../src/integrity.js';
import {BLOCK_SIZE} from '../src/storage.js';
import {transferMatrix} from './transfer-matrix.mjs';
test('parallel peers, cancellation, cleanup races and repeat sends',async t=>{
 const results=await transferMatrix({BlockTransfer,blockHash,File,Blob,BLOCK_SIZE});
 for(const result of results)t.diagnostic(result);
});
