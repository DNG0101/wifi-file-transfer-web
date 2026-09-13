import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {cancellationControlChecks} from './cancellation-control-checks.mjs';
test('approved and remembered cancellation channels',async t=>{
 const [main,devices]=await Promise.all(['main-peer','devices'].map(name=>readFile(new URL('../src/'+name+'.js',import.meta.url),'utf8')));
 for(const result of await cancellationControlChecks(main,devices))t.diagnostic(result);
});
