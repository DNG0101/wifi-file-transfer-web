import test from 'node:test';
import assert from 'node:assert/strict';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import {readInvitation,invitationUrl} from '../src/invitation.js';
import {Scanner} from '../src/qr.js';
const base='https://dng0101.github.io/wifi-file-transfer-web/';
test('QR invitations canonicalize Pages paths, remove query clutter and select opposite role',()=>{
 for(const mode of ['send','receive']){
  const link=invitationUrl(base+'index.html?tracking=discard','abcdefgh2345',mode);
  assert.equal(new URL(link).search,'');
  for(const page of [base,base+'index.html',base.slice(0,-1)])
   assert.deepEqual(readInvitation(link,page,true),{code:'abcdefgh2345',mode:mode==='send'?'receive':'send'});
  const qr=qrcode(0,'M');qr.addData(link);qr.make();
  const size=(qr.getModuleCount()+8)*6, pixels=new Uint8ClampedArray(size*size*4).fill(255);
  for(let y=0;y<qr.getModuleCount();y++)for(let x=0;x<qr.getModuleCount();x++)if(qr.isDark(y,x))
   for(let dy=0;dy<6;dy++)for(let dx=0;dx<6;dx++){const i=((y+4)*6+dy)*size*4+((x+4)*6+dx)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;}
  assert.equal(jsQR(pixels,size,size).data,link);
 }
});
test('reject unrelated QR links and malformed codes without accepting other sites',()=>{
 for(const link of ['https://evil.example/#join=abcdefgh2345',base+'other/#join=abcdefgh2345',base+'#join=bad','random text'])
  assert.throws(()=>readInvitation(link,base,true));
 assert.deepEqual(readInvitation('ABCD-efgh-2345',base),{code:'abcdefgh2345',mode:null});
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const stream=()=>{const track={stopped:false,stop(){this.stopped=true;}};return {track,getTracks:()=>[track]};};
test('late camera permission after stop releases the camera without starting playback',async()=>{
 const request=deferred(),s=stream();let plays=0;
 const scanner=new Scanner({play:()=>plays++},()=>assert.fail(),()=>assert.fail(),{media:{getUserMedia:()=>request.promise}});
 const start=scanner.start();scanner.stop();request.resolve(s);await start;assert.equal(s.track.stopped,true);assert.equal(plays,0);
});
test('closing while video starts prevents stale scan loop',async()=>{
 const play=deferred(),s=stream();let canvases=0;
 const scanner=new Scanner({play:()=>play.promise},()=>assert.fail(),()=>assert.fail(),{media:{getUserMedia:async()=>s},makeCanvas:()=>canvases++});
 const start=scanner.start();await Promise.resolve();scanner.stop();play.resolve();await start;assert.equal(canvases,0);assert.equal(s.track.stopped,true);
});
test('old camera rejection cannot stop a newer camera session',async()=>{
 const old=deferred(),play=deferred(),s=stream();let calls=0,errors=0;
 const scanner=new Scanner({play:()=>play.promise},()=>{},()=>errors++,{media:{getUserMedia:()=>++calls===1?old.promise:Promise.resolve(s)}});
 const first=scanner.start(),second=scanner.start();await Promise.resolve();old.reject(Error('old failure'));await first;
 assert.equal(s.track.stopped,false);assert.equal(errors,0);scanner.stop();play.resolve();await second;
});
test('scanner decodes once and stops camera; frame failures report and release camera',async()=>{
 for(const fails of [false,true]){
  const s=stream();let results=0,errors=0;
  const scanner=new Scanner({readyState:2,videoWidth:1280,videoHeight:720,play:async()=>{}},()=>results++,()=>errors++,{
   media:{getUserMedia:async()=>s},makeCanvas:()=>({getContext:()=>({drawImage(){if(fails)throw Error('bad frame');},getImageData:()=>({data:[]})})}),decode:()=>({data:'invite'})
  });
  await scanner.start();assert.equal(results,fails?0:1);assert.equal(errors,fails?1:0);assert.equal(s.track.stopped,true);scanner.stop();
 }
});
