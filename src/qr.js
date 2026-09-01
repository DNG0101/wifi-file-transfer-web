import jsQR from 'jsqr';

export class Scanner {
  constructor(video,onResult,onError,dependencies={}) {
    Object.assign(this,{video,onResult,onError});this.generation=0;
    this.media=dependencies.media||navigator.mediaDevices;
    this.makeCanvas=dependencies.makeCanvas||(()=>document.createElement('canvas'));
    this.decode=dependencies.decode||jsQR;
  }
  async start() {
    this.stop();const generation=this.generation;
    try {
      const stream=await this.media.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video.srcObject=stream;
      await this.video.play();
      if(generation!==this.generation)return;
      const canvas=this.makeCanvas(),ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw Error('Camera image unavailable');
      const scan=()=>{
        if(generation!==this.generation)return;
        try {
          if(this.video.readyState>=2&&this.video.videoWidth&&this.video.videoHeight){
            canvas.width=Math.min(1280,this.video.videoWidth);
            canvas.height=Math.round(canvas.width*this.video.videoHeight/this.video.videoWidth);
            ctx.drawImage(this.video,0,0,canvas.width,canvas.height);
            const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
            const result=this.decode(pixels.data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});
            if(result){this.stop();this.onResult(result.data);return;}
          }
          this.timer=setTimeout(scan,250);
        } catch {if(generation===this.generation){this.stop();this.onError('Could not read the camera image. Reopen the scanner or paste the invitation link.');}}
      };
      scan();
    } catch(e) {
      // A cancelled camera request must never stop a newer scanner.
      if(generation!==this.generation)return;
      this.stop();this.onError(e.name==='NotAllowedError'?'Camera access was denied. Allow camera access in site settings, or paste an invite link.':'Camera unavailable. Close other camera apps, then retry, or paste the invitation link.');
    }
  }
  stop(){this.generation++;clearTimeout(this.timer);this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;}
}
