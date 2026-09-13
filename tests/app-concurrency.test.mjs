import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {appConcurrencyChecks} from './app-concurrency-checks.mjs';
test('application keeps simultaneous transfers and approvals independent',async t=>{
 const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 for(const result of await appConcurrencyChecks(source))t.diagnostic(result);
});
