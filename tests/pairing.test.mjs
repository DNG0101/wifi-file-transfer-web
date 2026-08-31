import test from 'node:test';
import assert from 'node:assert/strict';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import {friendlyName} from '../src/devices.js';
import {parseRoom} from '../src/room.js';
test('locally generated invitation QR decodes to the exact repository link',()=>{
 const link='https://dng0101.github.io/wifi-file-transfer-web/#join=abcdefgh2345';const qr=qrcode(0,'M');qr.addData(link);qr.make();const scale=5,quiet=4,n=qr.getModuleCount(),width=(n+quiet*2)*scale,pixels=new Uint8ClampedArray(width*width*4);
 for(let y=0;y<width;y++)for(let x=0;x<width;x++){const row=Math.floor(y/scale)-quiet,col=Math.floor(x/scale)-quiet;const color=row>=0&&col>=0&&row<n&&col<n&&qr.isDark(row,col)?0:255;const offset=(y*width+x)*4;pixels.set([color,color,color,255],offset);}
 assert.equal(jsQR(pixels,width,width).data,link);assert.equal(parseRoom(link),'abcdefgh2345');
});
test('friendly names use browser-safe platform hints without unique fingerprinting',()=>{
 assert.equal(friendlyName('Mozilla Windows Chrome/130 Edg/130'),'Edge on Windows');assert.equal(friendlyName('Mozilla iPhone Version/18 Safari/600'),'Safari on iPhone');assert.equal(friendlyName('Android Chrome/130'),'Chrome on Android');
});
