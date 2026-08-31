import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
test('page contains every control used by app and relative deployable assets',async()=>{
 const html=await readFile('index.html','utf8'),js=await readFile('src/app.js','utf8');
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const match of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(match[1]),`Missing control ${match[1]}`);
 for(const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))await access(match[1].split('?')[0]);
 assert.ok(!html.includes('maximum-scale=1'));
});
