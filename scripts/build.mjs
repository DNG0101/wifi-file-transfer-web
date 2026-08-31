import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
// Resolve in Node so builds also work inside restricted Windows desktop sandboxes.
export const resolver={name:'node-files',setup(b){
  b.onResolve({filter:/.*/},args=>({path:createRequire(args.importer||path.resolve('package.json')).resolve(args.path.startsWith('.')?path.resolve(args.importer?path.dirname(args.importer):process.cwd(),args.path):args.path).replace(/cryptoNode\.js$/, 'crypto.js'),namespace:'source'}));
  b.onLoad({filter:/.*/,namespace:'source'},async args=>({contents:await readFile(args.path,'utf8'),loader:args.path.endsWith('.json')?'json':'js'}));
}};
await build({entryPoints:['./src/app.js'],plugins:[resolver],bundle:true,format:'esm',minify:true,outfile:'assets/app.js',target:['chrome100','firefox100','safari16']});
await build({entryPoints:['./src/hash-worker.js'],plugins:[resolver],bundle:true,format:'esm',minify:true,outfile:'assets/hash-worker.js',target:['chrome100','firefox100','safari16']});
