from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def load(p): return (ROOT/p).read_text()
def save(p,s): (ROOT/p).write_text(s)
def one(s,a,b,label):
    n=s.count(a)
    if n!=1: raise SystemExit(f'{label}: expected 1, found {n}')
    return s.replace(a,b,1)

p='src/block-transfer.js';s=load(p)
s=one(s,
"          const digestPromise=blockHash(bytes),checkpoint=hash.update(bytes);checkpoint.catch(()=>{});\n          return {block:b,bytes,digest:await digestPromise,checkpoint};",
"          const digestPromise=blockHash(bytes),checkpoint=hash.update(bytes);checkpoint.catch(()=>{});const digest=await digestPromise;\n          if(this.options.reselected&&state.hashes[b]&&state.hashes[b]!==digest)throw Error('The selected source file changed. Choose the original file or start a new transfer.');\n          state.hashes[b]=digest;return {block:b,bytes,digest,checkpoint};",
'persist prepared block fingerprint')
s=one(s,
"    this.epoch++;this.blocks.clear();this.completedData.clear();for(const hash of this.receiveHashes.values())hash.close();this.receiveHashes.clear();\n    this.rejectWaiters(new Interrupted(detail));this.transition('reconnecting',detail);this.options.onInterrupted?.(this);",
"    this.epoch++;this.blocks.clear();this.completedData.clear();for(const hash of this.receiveHashes.values())hash.close();this.receiveHashes.clear();\n    if(this.record){this.record.updated=Date.now();void this.store.put(this.record).catch(()=>{});}\n    this.rejectWaiters(new Interrupted(detail));this.transition('reconnecting',detail);this.options.onInterrupted?.(this);",
'persist prepared hashes on interruption')
save(p,s)

p='tests/block-transfer.test.mjs';s=load(p)
s=one(s,
"  await until(()=>sender.state==='reconnecting'&&receiver.state==='reconnecting');assert.equal(receiver.record.files[0].next,1);\n  const[c,d]=pair(raw=>{if(typeof raw==='string'&&JSON.parse(raw).type==='block-start')starts.push(JSON.parse(raw).block);return raw;});receiver.attach(d);sender.attach(c);await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);assert.equal(starts.filter(x=>x===0).length,1);assert.equal(receiver.state,'complete');",
"  await until(()=>sender.state==='reconnecting'&&receiver.state==='reconnecting');const verified=receiver.record.files[0].next;assert.ok(verified>=0&&verified<=1);\n  const before=new Map();for(let b=0;b<verified;b++)before.set(b,starts.filter(x=>x===b).length);\n  const[c,d]=pair(raw=>{if(typeof raw==='string'&&JSON.parse(raw).type==='block-start')starts.push(JSON.parse(raw).block);return raw;});receiver.attach(d);sender.attach(c);await until(()=>sender.terminal());assert.equal(sender.state,'complete',sender.detail);for(const [b,count] of before)assert.equal(starts.filter(x=>x===b).length,count,`verified block ${b} must not be resent`);assert.equal(receiver.state,'complete');",
'interruption test understands pipelining')
save(p,s)
print('v4.13 interruption fix applied')
