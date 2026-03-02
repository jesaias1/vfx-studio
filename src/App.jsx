import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
const lerp = (a,b,t) => a+(b-a)*t;
const rand = (lo,hi) => lo+Math.random()*(hi-lo);
function hexToRgb(h){return{r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)};}

/* ═══ DEFAULTS ═══ */
const DEFAULTS = {
  trails:{on:false,decay:0.02,length:0.8,motionOnly:true,brightness:1.0},
  edge:{on:false,color:'#00ffff',threshold:30,glow:1.0},
  feedback:{on:false,zoom:1.03,rotate:0.8,mix:0.85,drift:0.0},
  chromatic:{on:false,offset:4},
  scanlines:{on:false,opacity:0.3,noise:0.15},
  palette:{on:false,mode:0},
  bloom:{on:false,intensity:0.6},
  vhs:{on:false,distortion:0.5,colorBleed:0.4},
  crush:{on:false,contrast:1.5,blackLevel:20},
  strobe:{on:false,rate:4,intensity:0.5},
  stutter:{on:false,targetFps:15},
  mirror:{on:false,mode:0},
  pixelSort:{on:false,threshold:80,direction:0},
  audio:{on:false,sensitivity:1.0},
  slitScan:{on:false,offset:30},
  invert:{on:false},
  posterize:{on:false,levels:4},
  zoomPulse:{on:false,speed:2,amount:0.03},
};

const PRESETS = {
  Clean:()=>JSON.parse(JSON.stringify(DEFAULTS)),
  Ghost:()=>{const s=JSON.parse(JSON.stringify(DEFAULTS));s.trails={...s.trails,on:true,decay:0.008,length:1.0,brightness:1.2};s.edge={...s.edge,on:true};return s;},
  'Glitch Hell':()=>{const s=JSON.parse(JSON.stringify(DEFAULTS));s.feedback={...s.feedback,on:true,zoom:1.05,rotate:1.5,mix:0.9};s.chromatic={...s.chromatic,on:true,offset:10};s.scanlines={...s.scanlines,on:true,opacity:0.5,noise:0.3};s.vhs={...s.vhs,on:true,distortion:0.6};return s;},
  Rave:()=>{const s=JSON.parse(JSON.stringify(DEFAULTS));s.bloom={...s.bloom,on:true,intensity:0.9};s.palette={...s.palette,on:true,mode:2};s.strobe={...s.strobe,on:true,rate:6};s.audio={...s.audio,on:true};s.chromatic={...s.chromatic,on:true,offset:8};return s;},
  'Music Video':()=>{const s=JSON.parse(JSON.stringify(DEFAULTS));s.trails={...s.trails,on:true,decay:0.005,length:1.0,brightness:1.3};s.crush={...s.crush,on:true,contrast:1.8,blackLevel:30};s.stutter={...s.stutter,on:true,targetFps:12};s.audio={...s.audio,on:true};return s;},
  Surveillance:()=>{const s=JSON.parse(JSON.stringify(DEFAULTS));s.trails={...s.trails,on:true,decay:0.015,length:0.9};s.palette={...s.palette,on:true,mode:0};s.scanlines={...s.scanlines,on:true,opacity:0.4};s.vhs={...s.vhs,on:true,distortion:0.3};return s;},
  'Pixel Melt':()=>{const s=JSON.parse(JSON.stringify(DEFAULTS));s.pixelSort={...s.pixelSort,on:true,threshold:60};s.feedback={...s.feedback,on:true,zoom:1.02,rotate:0.3,mix:0.7};s.chromatic={...s.chromatic,on:true,offset:6};return s;},
  'Audio Surge':()=>{const s=JSON.parse(JSON.stringify(DEFAULTS));s.audio={...s.audio,on:true,sensitivity:1.5};s.trails={...s.trails,on:true,decay:0.01,brightness:1.4};s.bloom={...s.bloom,on:true,intensity:0.7};s.chromatic={...s.chromatic,on:true,offset:5};s.feedback={...s.feedback,on:true,zoom:1.02,mix:0.6};return s;},
};

const PALETTE_NAMES=['PHOSPHOR','INFRARED','VAPOR','BW HI-CON'];
function remapPixel(r,g,b,mode){
  const luma=0.299*r+0.587*g+0.114*b,t=luma/255;
  switch(mode){
    case 0:return[0,luma,luma*0.2];
    case 1:return[clamp(luma*1.4,0,255),clamp(luma*0.6,0,255),0];
    case 2:return[lerp(80,255,t),lerp(0,100,t),lerp(200,255,t)];
    case 3:{const v=luma>100?255:0;return[v,v,v];}
    default:return[r,g,b];
  }
}
const MIRROR_NAMES=['HORIZ','VERT','QUAD','KALEIDOSCOPE'];



/* ═══ AUDIO ANALYZER — BEAT/TRANSIENT DETECTION ═══ */
class AudioReactive {
  constructor(){
    this.analyser=null;this.dataArray=null;this.audioCtx=null;this.stream=null;
    this.bass=0;this.mid=0;this.high=0;this.energy=0;
    this.beat=false;this.lastBeat=0;
    this.hit=0; // 0-1, spikes on kick/transient, decays fast
    this.prevBass=0;this.prevEnergy=0;
    this.energyHistory=new Float32Array(60);this.histIdx=0;
    this.ready=false;
  }
  async init(){
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      this.audioCtx=new(window.AudioContext||window.webkitAudioContext)();
      if(this.audioCtx.state==='suspended') await this.audioCtx.resume();
      this.analyser=this.audioCtx.createAnalyser();
      this.analyser.fftSize=256;this.analyser.smoothingTimeConstant=0.4; // fast response
      this.dataArray=new Uint8Array(this.analyser.frequencyBinCount);
      const src=this.audioCtx.createMediaStreamSource(this.stream);src.connect(this.analyser);
      this.ready=true;
    }catch(e){console.warn('Audio init failed:',e);this.ready=false;}
  }
  update(sensitivity=1.0){
    if(!this.ready||!this.analyser)return;
    this.analyser.getByteFrequencyData(this.dataArray);
    const len=this.dataArray.length;
    let bassSum=0,midSum=0,highSum=0;
    const bassEnd=Math.floor(len*0.12),midEnd=Math.floor(len*0.45);
    for(let i=0;i<len;i++){const v=this.dataArray[i]/255;if(i<bassEnd)bassSum+=v;else if(i<midEnd)midSum+=v;else highSum+=v;}
    this.bass=clamp((bassSum/bassEnd)*sensitivity*2.5,0,1);
    this.mid=clamp((midSum/(midEnd-bassEnd))*sensitivity*2,0,1);
    this.high=clamp((highSum/(len-midEnd))*sensitivity*2,0,1);
    this.energy=this.bass*0.6+this.mid*0.25+this.high*0.15;
    // rolling average for comparison
    this.energyHistory[this.histIdx%60]=this.energy;this.histIdx++;
    let avg=0;for(let i=0;i<60;i++)avg+=this.energyHistory[i];avg/=60;
    // transient detection: spike in bass relative to previous frame
    const bassJump=this.bass-this.prevBass;
    const energyJump=this.energy-this.prevEnergy;
    const now=performance.now();
    const isTransient=(bassJump>0.15||energyJump>0.12)&&this.energy>avg*1.2&&(now-this.lastBeat)>80;
    this.beat=isTransient;
    if(isTransient){this.lastBeat=now;this.hit=1.0;} // spike to 1
    else{this.hit*=0.88;} // fast decay
    this.prevBass=this.bass;this.prevEnergy=this.energy;
  }
  destroy(){this.stream?.getTracks().forEach(t=>t.stop());this.audioCtx?.close();this.ready=false;}
}

/* ═══ MAIN COMPONENT ═══ */
export default function App(){
  const canvasRef=useRef(null),videoRef=useRef(null),prevFrameRef=useRef(null);
  const feedbackRef=useRef(null),animIdRef=useRef(null);
  const fpsRef=useRef({last:performance.now(),frames:0,value:0});
  const recorderRef=useRef(null),chunksRef=useRef([]),micStreamRef=useRef(null);
  const trailCanvasRef=useRef(null),lastRenderRef=useRef(0),frameCountRef=useRef(0);
  const prevMotionRef=useRef(null),audioRef=useRef(null);
  const feedbackDataRef=useRef(null);

  const [started,setStarted]=useState(false);
  const [permError,setPermError]=useState('');
  const [panelOpen,setPanelOpen]=useState(true);
  const fpsDisplayRef=useRef(null);
  const audioBarRefs=useRef({bass:null,mid:null,high:null,beat:null});
  const [fx,setFx]=useState(JSON.parse(JSON.stringify(DEFAULTS)));
  const [chaos,setChaos]=useState(0);
  const [recording,setRecording]=useState(false);
  const [micOn,setMicOn]=useState(false);
  const [micGain,setMicGain]=useState(0.8);
  const [facingUser,setFacingUser]=useState(true);
  const [isMobile,setIsMobile]=useState(false);
  const [openSections,setOpenSections]=useState({});
  const [bpm,setBpm]=useState(0); // 0 = off
  const [devices,setDevices]=useState([]);
  const [selectedDevice,setSelectedDevice]=useState('');
  const slitBufferRef=useRef([]);

  const fxRef=useRef(fx);fxRef.current=fx;
  const chaosRef=useRef(chaos);chaosRef.current=chaos;
  const bpmRef=useRef(bpm);bpmRef.current=bpm;

  useEffect(()=>{const c=()=>setIsMobile(window.innerWidth<768);c();window.addEventListener('resize',c);return()=>window.removeEventListener('resize',c);},[]);

  const startCamera=useCallback(async(devId)=>{
    try{
      const constraints={video:{width:{ideal:1280},height:{ideal:720}},audio:false};
      if(devId) constraints.video.deviceId={exact:devId};
      else constraints.video.facingMode=facingUser?'user':'environment';
      const stream=await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current.srcObject=stream;await videoRef.current.play();
      // enumerate devices after getting permission
      const allDevs=await navigator.mediaDevices.enumerateDevices();
      const cams=allDevs.filter(d=>d.kind==='videoinput');
      setDevices(cams);
      if(!devId&&cams.length>0){
        const activeTrack=stream.getVideoTracks()[0];
        const activeDev=cams.find(d=>d.label===activeTrack.label);
        if(activeDev)setSelectedDevice(activeDev.deviceId);
      }
      setStarted(true);
    }catch(e){setPermError(e.message||'Camera access denied');}
  },[facingUser]);

  const switchCamera=useCallback((devId)=>{
    if(videoRef.current?.srcObject)videoRef.current.srcObject.getTracks().forEach(t=>t.stop());
    setSelectedDevice(devId);
    startCamera(devId);
  },[startCamera]);

  const flipCamera=useCallback(()=>{if(videoRef.current?.srcObject)videoRef.current.srcObject.getTracks().forEach(t=>t.stop());setFacingUser(p=>!p);},[]);
  useEffect(()=>{if(started)startCamera(selectedDevice);},[facingUser]);

  // Audio init/destroy
  useEffect(()=>{
    if(!started)return;
    if(fx.audio.on&&!audioRef.current){
      const ar=new AudioReactive();ar.init().then(()=>{if(ar.ready)audioRef.current=ar;}).catch(()=>{});
    }
    if(!fx.audio.on&&audioRef.current){audioRef.current.destroy();audioRef.current=null;}
    return()=>{if(audioRef.current){audioRef.current.destroy();audioRef.current=null;}};
  },[started,fx.audio.on]);

  /* ═══ RENDER LOOP ═══ */
  useEffect(()=>{
    if(!started)return;
    const canvas=canvasRef.current,ctx=canvas.getContext('2d',{willReadFrequently:true}),video=videoRef.current;
    const mCanvas=document.createElement('canvas'),mCtx=mCanvas.getContext('2d',{willReadFrequently:true});
    const fbCanvas=document.createElement('canvas');feedbackRef.current=fbCanvas;const fbCtx=fbCanvas.getContext('2d');
    const trailCanvas=document.createElement('canvas');trailCanvasRef.current=trailCanvas;const trCtx=trailCanvas.getContext('2d',{willReadFrequently:true});
    let running=true;

    const resize=()=>{
      canvas.width=window.innerWidth;canvas.height=window.innerHeight;
      mCanvas.width=Math.floor(canvas.width*0.5);mCanvas.height=Math.floor(canvas.height*0.5);
      fbCanvas.width=canvas.width;fbCanvas.height=canvas.height;
      trailCanvas.width=canvas.width;trailCanvas.height=canvas.height;
    };
    resize();window.addEventListener('resize',resize);

    function render(timestamp){
      if(!running)return;
      animIdRef.current=requestAnimationFrame(render);
      const s=fxRef.current,chaosVal=chaosRef.current;

      // FPS stutter
      if(s.stutter.on){const interval=1000/s.stutter.targetFps;if(timestamp-lastRenderRef.current<interval)return;lastRenderRef.current=timestamp;}
      frameCountRef.current++;

      // Audio — beat/transient detection: hit spikes to 1 on kicks, decays to 0
      let au={bass:0,mid:0,high:0,energy:0,beat:false,hit:0};
      if(audioRef.current&&audioRef.current.ready&&s.audio.on){
        audioRef.current.update(s.audio.sensitivity);
        au=audioRef.current;
        // Update audio meter via DOM refs (no re-render)
        if(frameCountRef.current%4===0){
          const br=audioBarRefs.current;
          if(br.bass)br.bass.style.height=`${au.bass*100}%`;
          if(br.mid)br.mid.style.height=`${au.mid*100}%`;
          if(br.high)br.high.style.height=`${au.high*100}%`;
          if(br.beat)br.beat.style.opacity=au.beat?'1':'0';
        }
      }
      // hit: 0 (nothing) → 1.0 (kick detected), decays fast
      let hit=s.audio.on?au.hit:0;
      const beatHit=s.audio.on&&au.beat;

      // BPM pulse — generates a hit at BPM intervals
      const curBpm=bpmRef.current;
      if(curBpm>0){
        const beatInterval=60000/curBpm;
        const phase=(timestamp%beatInterval)/beatInterval;
        const bpmHit=phase<0.08?1.0-phase/0.08:0; // sharp spike at start of each beat
        hit=Math.max(hit,bpmHit); // combine with audio hit
      }

      const W=canvas.width,H=canvas.height,mW=mCanvas.width,mH=mCanvas.height;

      /* 1) half-res motion detect */
      mCtx.drawImage(video,0,0,mW,mH);
      const curFrame=mCtx.getImageData(0,0,mW,mH),cD=curFrame.data;
      const motionMask=new Float32Array(mW*mH);
      const motionVX=new Float32Array(mW*mH),motionVY=new Float32Array(mW*mH);
      if(prevFrameRef.current){
        const pD=prevFrameRef.current.data;
        for(let i=0;i<cD.length;i+=4){
          const idx=i>>2;
          motionMask[idx]=(Math.abs(cD[i]-pD[i])+Math.abs(cD[i+1]-pD[i+1])+Math.abs(cD[i+2]-pD[i+2]))/3;
        }
        if(prevMotionRef.current){
          for(let y=2;y<mH-2;y++)for(let x=2;x<mW-2;x++){
            const idx=y*mW+x;
            if(motionMask[idx]>15){motionVX[idx]=(motionMask[idx+1]||0)-(motionMask[idx-1]||0);motionVY[idx]=(motionMask[idx+mW]||0)-(motionMask[idx-mW]||0);}
          }
        }
      }
      prevFrameRef.current=curFrame;prevMotionRef.current=motionMask;

      /* 2) FEEDBACK / DATAMOSH — proper recursive re-feed */
      if(s.feedback.on){
        const zoom=s.feedback.zoom+(hit*0.04); // kick = zoom burst
        const rot=(s.feedback.rotate+(hit*3))*Math.PI/180;
        const driftX=Math.sin(timestamp*0.0005)*s.feedback.drift*20;
        const driftY=Math.cos(timestamp*0.0007)*s.feedback.drift*15;
        ctx.save();ctx.globalAlpha=s.feedback.mix;
        ctx.translate(W/2+driftX,H/2+driftY);ctx.rotate(rot*0.016);
        ctx.scale(zoom,zoom);ctx.translate(-W/2,-H/2);
        ctx.drawImage(fbCanvas,0,0);ctx.restore();ctx.globalAlpha=1;
        // blend current video on top
        ctx.save();ctx.globalAlpha=1-s.feedback.mix+0.15;
        ctx.drawImage(video,0,0,W,H);ctx.restore();ctx.globalAlpha=1;
      }

      /* 3) TRAILS */
      if(s.trails.on){
        const decay=s.trails.decay*(1-hit*0.8); // kick = slower decay = longer trails
        trCtx.fillStyle=`rgba(0,0,0,${clamp(decay,0.001,0.2)})`;
        trCtx.fillRect(0,0,W,H);
        if(s.trails.motionOnly){
          const tmpC=document.createElement('canvas');tmpC.width=W;tmpC.height=H;
          const t2=tmpC.getContext('2d');t2.drawImage(video,0,0,W,H);
          const vF=t2.getImageData(0,0,W,H),vD=vF.data;
          for(let y=0;y<H;y++){const my=Math.floor(y*mH/H);for(let x=0;x<W;x++){const mx=Math.floor(x*mW/W);const m=motionMask[my*mW+mx];const vi=(y*W+x)*4;vD[vi+3]=m<12?0:clamp(m*3*s.trails.brightness,0,255);}}
          t2.putImageData(vF,0,0);trCtx.globalCompositeOperation='screen';trCtx.globalAlpha=s.trails.length;trCtx.drawImage(tmpC,0,0);trCtx.globalCompositeOperation='source-over';
        }else{trCtx.globalAlpha=s.trails.length*0.7;trCtx.drawImage(video,0,0,W,H);}
        trCtx.globalAlpha=1;
        if(!s.feedback.on){ctx.clearRect(0,0,W,H);ctx.drawImage(video,0,0,W,H);}
        ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=s.trails.brightness+(hit*0.5);ctx.drawImage(trailCanvas,0,0);ctx.restore();ctx.globalAlpha=1;
      }else if(!s.feedback.on){ctx.clearRect(0,0,W,H);ctx.drawImage(video,0,0,W,H);}

      /* 4) edge glow */
      if(s.edge.on){
        const eD=ctx.getImageData(0,0,W,H),ed=eD.data,out=new Uint8ClampedArray(ed.length);
        const col=hexToRgb(s.edge.color),th=s.edge.threshold-(hit*25); // kick lowers threshold = more edges
        const glowMul=s.edge.glow+(hit*1.5); // kick = brighter glow
        for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
          const i=(y*W+x)*4;const lC=ed[i]*0.3+ed[i+1]*0.59+ed[i+2]*0.11;
          const lR=ed[i+4]*0.3+ed[i+5]*0.59+ed[i+6]*0.11;const lD=ed[i+W*4]*0.3+ed[i+W*4+1]*0.59+ed[i+W*4+2]*0.11;
          const lL=ed[i-4]*0.3+ed[i-3]*0.59+ed[i-2]*0.11;const lU=ed[i-W*4]*0.3+ed[i-W*4+1]*0.59+ed[i-W*4+2]*0.11;
          const g=Math.abs(lR-lL)+Math.abs(lD-lU);
          if(g>th){const b2=clamp(g*3*glowMul,0,255);out[i]=(col.r*b2)>>8;out[i+1]=(col.g*b2)>>8;out[i+2]=(col.b*b2)>>8;out[i+3]=b2;}
        }
        const tE=document.createElement('canvas');tE.width=W;tE.height=H;tE.getContext('2d').putImageData(new ImageData(out,W,H),0,0);
        ctx.save();ctx.globalCompositeOperation='screen';ctx.drawImage(tE,0,0);ctx.restore();
      }



      /* 6) pixel sort */
      if(s.pixelSort.on){
        const iD=ctx.getImageData(0,0,W,H),d=iD.data;
        const th=s.pixelSort.threshold+(beatHit?-30:0);
        const step=s.pixelSort.direction===0?3:2;
        if(s.pixelSort.direction===0){// horizontal
          for(let y=0;y<H;y+=step){let start=-1;
            for(let x=0;x<W;x++){const i=(y*W+x)*4;const lum=d[i]*0.3+d[i+1]*0.59+d[i+2]*0.11;
              if(lum>th){if(start===-1)start=x;}else{if(start!==-1&&x-start>3){sortRow(d,W,y,start,x);start=-1;}}
            }if(start!==-1)sortRow(d,W,y,start,W);
          }
        }else{// vertical
          for(let x=0;x<W;x+=step){let start=-1;
            for(let y=0;y<H;y++){const i=(y*W+x)*4;const lum=d[i]*0.3+d[i+1]*0.59+d[i+2]*0.11;
              if(lum>th){if(start===-1)start=y;}else{if(start!==-1&&y-start>3){sortCol(d,W,x,start,y);start=-1;}}
            }if(start!==-1)sortCol(d,W,x,start,H);
          }
        }
        ctx.putImageData(iD,0,0);
      }

      /* 7) palette remap */
      if(s.palette.on){const iD=ctx.getImageData(0,0,W,H),d=iD.data;for(let i=0;i<d.length;i+=4){const[nr,ng,nb]=remapPixel(d[i],d[i+1],d[i+2],s.palette.mode);d[i]=nr;d[i+1]=ng;d[i+2]=nb;}ctx.putImageData(iD,0,0);}

      /* 8) crush blacks */
      if(s.crush.on){
        const iD=ctx.getImageData(0,0,W,H),d=iD.data;
        const c2=s.crush.contrast+(hit*0.8),bl=s.crush.blackLevel; // kick = contrast spike
        for(let i=0;i<d.length;i+=4){for(let ch=0;ch<3;ch++){let v=d[i+ch];v=((v-128)*c2)+128;if(v<bl)v=0;d[i+ch]=clamp(v,0,255);}}
        ctx.putImageData(iD,0,0);
      }

      /* 9) VHS */
      if(s.vhs.on){
        const iD=ctx.getImageData(0,0,W,H),d=iD.data,src=new Uint8ClampedArray(d);
        const dist=s.vhs.distortion+(hit*0.5),bleed=s.vhs.colorBleed,t2=frameCountRef.current; // kick = more glitch
        for(let y=0;y<H;y++){
          const jit=Math.floor(Math.sin(y*0.02+t2*0.1)*dist*8+(Math.random()-0.5)*dist*4);
          if(jit!==0)for(let x=0;x<W;x++){const si=(y*W+clamp(x+jit,0,W-1))*4,di=(y*W+x)*4;d[di]=src[si];d[di+1]=src[si+1];d[di+2]=src[si+2];}
          if(bleed>0.1){const bp=Math.floor(bleed*6);for(let x=0;x<W;x++){const di=(y*W+x)*4;d[di]=src[(y*W+clamp(x+bp,0,W-1))*4];}}
        }
        if(dist>0.2&&(Math.random()<dist*0.15||beatHit)){ // kick triggers glitch bars
          const gy=Math.floor(Math.random()*H),gh=Math.floor(rand(2,25*dist));
          for(let y2=gy;y2<Math.min(gy+gh,H);y2++){const sh=Math.floor(rand(-40,40)*dist);for(let x=0;x<W;x++){const di=(y2*W+x)*4,sx=clamp(x+sh,0,W-1),si=(y2*W+sx)*4;d[di]=src[si];d[di+1]=src[si+1];d[di+2]=src[si+2];}}
        }
        ctx.putImageData(iD,0,0);
      }

      /* 10) bloom */
      if(s.bloom.on){const bi=s.bloom.intensity+(hit*0.6);ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=bi*0.4;ctx.filter=`blur(${12+hit*8}px) brightness(${1.5+hit*0.5})`;ctx.drawImage(canvas,0,0);ctx.filter='none';ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.restore();}

      /* 11) chromatic */
      if(s.chromatic.on){
        const off=Math.round(s.chromatic.offset+(hit*12)); // kick = big RGB split burst
        const iD=ctx.getImageData(0,0,W,H),s2=new Uint8ClampedArray(iD.data),d=iD.data;
        for(let y=0;y<H;y++)for(let x=0;x<W;x++){const idx=(y*W+x)*4;d[idx]=s2[(y*W+clamp(x+off,0,W-1))*4];d[idx+2]=s2[(y*W+clamp(x-off,0,W-1))*4+2];}
        ctx.putImageData(iD,0,0);
      }

      /* 12) scanlines */
      if(s.scanlines.on){ctx.save();ctx.globalAlpha=s.scanlines.opacity*0.5;ctx.fillStyle='#000';for(let y=0;y<H;y+=3)ctx.fillRect(0,y,W,1);ctx.restore();
        if(s.scanlines.noise>0.01){const nD=ctx.getImageData(0,0,W,H),nd=nD.data,str=s.scanlines.noise*60;for(let i=0;i<nd.length;i+=16){const n=(Math.random()-0.5)*str;nd[i]+=n;nd[i+1]+=n;nd[i+2]+=n;}ctx.putImageData(nD,0,0);}
      }

      /* 13) strobe — audio-synced on beat */
      if(s.strobe.on){
        const flash=beatHit?1.0:(hit>0.3?hit:0); // only flash on beat/kick
        if(flash>0){ctx.save();ctx.globalAlpha=s.strobe.intensity*flash*0.5;ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.restore();}
      }

      /* 14) mirror */
      if(s.mirror.on){
        if(s.mirror.mode===0){ctx.save();ctx.translate(W,0);ctx.scale(-1,1);ctx.globalAlpha=0.5;ctx.drawImage(canvas,W/2,0,W/2,H,W/2,0,W/2,H);ctx.restore();ctx.globalAlpha=1;}
        else if(s.mirror.mode===1){ctx.save();ctx.translate(0,H);ctx.scale(1,-1);ctx.globalAlpha=0.5;ctx.drawImage(canvas,0,H/2,W,H/2,0,H/2,W,H/2);ctx.restore();ctx.globalAlpha=1;}
        else if(s.mirror.mode===2){// quad
          ctx.save();ctx.translate(W,0);ctx.scale(-1,1);ctx.globalAlpha=0.5;ctx.drawImage(canvas,W/2,0,W/2,H,W/2,0,W/2,H);ctx.restore();
          ctx.save();ctx.translate(0,H);ctx.scale(1,-1);ctx.globalAlpha=0.5;ctx.drawImage(canvas,0,H/2,W,H/2,0,H/2,W,H/2);ctx.restore();ctx.globalAlpha=1;
        } else {// kaleidoscope
          ctx.save();ctx.translate(W/2,H/2);ctx.rotate(Math.PI/3);ctx.translate(-W/2,-H/2);ctx.globalAlpha=0.3;ctx.drawImage(canvas,0,0);ctx.restore();
          ctx.save();ctx.translate(W/2,H/2);ctx.rotate(-Math.PI/3);ctx.translate(-W/2,-H/2);ctx.globalAlpha=0.3;ctx.drawImage(canvas,0,0);ctx.restore();ctx.globalAlpha=1;
        }
      }

      /* 15) slit-scan — each row from a different time */
      if(s.slitScan.on){
        const buf=slitBufferRef.current;
        buf.push(ctx.getImageData(0,0,W,H));
        if(buf.length>s.slitScan.offset)buf.shift();
        if(buf.length>2){
          const out=ctx.getImageData(0,0,W,H),od=out.data;
          for(let y=0;y<H;y++){
            const fi=Math.floor((y/H)*buf.length);
            const frame=buf[clamp(fi,0,buf.length-1)];
            if(frame){const fd=frame.data;const rowStart=y*W*4;for(let x=0;x<W*4;x++)od[rowStart+x]=fd[rowStart+x];}
          }
          ctx.putImageData(out,0,0);
        }
      }

      /* 16) invert */
      if(s.invert.on){
        const iD=ctx.getImageData(0,0,W,H),d=iD.data;
        for(let i=0;i<d.length;i+=4){d[i]=255-d[i];d[i+1]=255-d[i+1];d[i+2]=255-d[i+2];}
        ctx.putImageData(iD,0,0);
      }

      /* 17) posterize */
      if(s.posterize.on){
        const iD=ctx.getImageData(0,0,W,H),d=iD.data;
        const lvl=s.posterize.levels,step2=255/lvl;
        for(let i=0;i<d.length;i+=4){
          d[i]=Math.floor(d[i]/step2)*step2;
          d[i+1]=Math.floor(d[i+1]/step2)*step2;
          d[i+2]=Math.floor(d[i+2]/step2)*step2;
        }
        ctx.putImageData(iD,0,0);
      }

      /* 18) zoom pulse */
      if(s.zoomPulse.on){
        const pulse=1+Math.sin(timestamp*s.zoomPulse.speed*0.003)*s.zoomPulse.amount*(1+hit*2);
        ctx.save();ctx.translate(W/2,H/2);ctx.scale(pulse,pulse);ctx.translate(-W/2,-H/2);
        ctx.drawImage(canvas,0,0);ctx.restore();
      }

      /* save feedback buffer */
      fbCtx.clearRect(0,0,W,H);fbCtx.drawImage(canvas,0,0);

      /* FPS — direct DOM update, no re-render */
      const now=performance.now();fpsRef.current.frames++;
      if(now-fpsRef.current.last>=500){
        fpsRef.current.value=Math.round(fpsRef.current.frames/((now-fpsRef.current.last)/1000));
        fpsRef.current.frames=0;fpsRef.current.last=now;
        if(fpsDisplayRef.current)fpsDisplayRef.current.textContent=fpsRef.current.value+' FPS';
      }
    }
    render(0);
    return()=>{running=false;cancelAnimationFrame(animIdRef.current);window.removeEventListener('resize',resize);};
  },[started]);

  /* recording */
  const startRecording=useCallback(async()=>{const cs=canvasRef.current.captureStream(30);let combined=cs;if(micOn){try{const ms=await navigator.mediaDevices.getUserMedia({audio:true});micStreamRef.current=ms;const ac=new AudioContext(),src=ac.createMediaStreamSource(ms),gn=ac.createGain();gn.gain.value=micGain;const dest=ac.createMediaStreamDestination();src.connect(gn).connect(dest);combined=new MediaStream([...cs.getVideoTracks(),...dest.stream.getAudioTracks()]);}catch{}}const rec=new MediaRecorder(combined,{mimeType:'video/webm; codecs=vp9'});chunksRef.current=[];rec.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data);};rec.onstop=()=>{const blob=new Blob(chunksRef.current,{type:'video/webm'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`vfx-${Date.now()}.webm`;a.click();URL.revokeObjectURL(url);};rec.start(100);recorderRef.current=rec;setRecording(true);},[micOn,micGain]);
  const stopRecording=useCallback(()=>{recorderRef.current?.stop();micStreamRef.current?.getTracks().forEach(t=>t.stop());setRecording(false);},[]);

  const updateFx=useCallback((g,k,v)=>setFx(p=>({...p,[g]:{...p[g],[k]:v}})),[]);
  const applyPreset=useCallback((fn)=>{setFx(fn());setChaos(0);if(trailCanvasRef.current){trailCanvasRef.current.getContext('2d').clearRect(0,0,trailCanvasRef.current.width,trailCanvasRef.current.height);}},[]);
  const toggleSection=useCallback((id)=>setOpenSections(p=>({...p,[id]:!p[id]})),[]);

  const randomizeAll=useCallback(()=>{
    const r=(lo,hi)=>lo+Math.random()*(hi-lo);
    const rb=()=>Math.random()>0.5;
    const rc=()=>'#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
    setFx({
      trails:{on:rb(),decay:r(0.002,0.06),length:r(0.3,1),motionOnly:rb(),brightness:r(0.5,1.8)},
      edge:{on:rb(),color:rc(),threshold:r(10,60),glow:r(0.5,2.5)},
      feedback:{on:rb(),zoom:r(1.005,1.07),rotate:r(0,3),mix:r(0.4,0.95),drift:r(0,0.6)},
      chromatic:{on:rb(),offset:Math.floor(r(1,15))},
      scanlines:{on:rb(),opacity:r(0.1,0.6),noise:r(0,0.4)},
      palette:{on:Math.random()>0.7,mode:Math.floor(r(0,4))},
      bloom:{on:rb(),intensity:r(0.2,0.9)},
      vhs:{on:rb(),distortion:r(0.1,0.7),colorBleed:r(0,0.6)},
      crush:{on:rb(),contrast:r(1,2.5),blackLevel:r(0,50)},
      strobe:{on:Math.random()>0.7,rate:Math.floor(r(2,10)),intensity:r(0.2,0.7)},
      stutter:{on:Math.random()>0.6,targetFps:Math.floor(r(4,20))},
      mirror:{on:Math.random()>0.6,mode:Math.floor(r(0,4))},
      pixelSort:{on:Math.random()>0.6,threshold:Math.floor(r(40,150)),direction:Math.floor(r(0,2))},
      audio:{on:fx.audio.on,sensitivity:fx.audio.sensitivity},
      slitScan:{on:Math.random()>0.7,offset:Math.floor(r(5,40))},
      invert:{on:Math.random()>0.8},
      posterize:{on:Math.random()>0.7,levels:Math.floor(r(2,8))},
      zoomPulse:{on:Math.random()>0.6,speed:r(1,5),amount:r(0.01,0.06)},
    });
    setChaos(r(0,0.5));
    if(trailCanvasRef.current){trailCanvasRef.current.getContext('2d').clearRect(0,0,trailCanvasRef.current.width,trailCanvasRef.current.height);}
  },[fx.audio.on,fx.audio.sensitivity]);

  /* ═══ PERMISSION SCREEN ═══ */
  if(!started){return(
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#0a0a0a]">
      <video ref={videoRef} className="hidden" playsInline muted/>
      <div className="border border-[#333] p-8 max-w-md w-full mx-4" style={{fontFamily:'Courier New,monospace'}}>
        <h1 className="text-[#00ff88] text-2xl mb-1 tracking-widest font-bold">VFX_STUDIO</h1>
        <div className="text-[#555] text-xs mb-4 tracking-wider">AUDIO-REACTIVE VISUAL ENGINE v4.0</div>
        <div className="border-t border-[#222] my-4"/>
        <p className="text-[#888] text-sm mb-6 leading-relaxed">Real-time webcam effects for music video production. Audio-reactive — your music drives the visuals.</p>
        {permError&&<div className="border border-red-900 bg-red-950/30 p-3 mb-4 text-red-400 text-xs">ERROR: {permError}</div>}
        {devices.length>1&&(
          <div className="mb-4">
            <div className="text-[9px] text-[#666] tracking-wider mb-1">SELECT CAMERA</div>
            <select value={selectedDevice} onChange={e=>setSelectedDevice(e.target.value)}
              className="w-full bg-[#111] border border-[#333] text-[#aaa] text-xs p-2 outline-none cursor-pointer appearance-none">
              {devices.map(d=>(<option key={d.deviceId} value={d.deviceId}>{d.label||`Camera ${devices.indexOf(d)+1}`}</option>))}
            </select>
          </div>
        )}
        <button onClick={()=>startCamera(selectedDevice||undefined)} className="w-full border border-[#00ff88] text-[#00ff88] py-3 px-6 text-sm tracking-widest hover:bg-[#00ff88] hover:text-black transition-colors duration-200 cursor-pointer">▶ INITIALIZE CAMERA</button>
        <div className="text-[#333] text-[10px] mt-4 text-center tracking-wider">AUDIO REACTIVE • SLIT SCAN • DATAMOSH • VHS</div>
      </div>
    </div>
  );}

  /* ═══ UI COMPONENTS ═══ */
  const Slider=({label,value,min,max,step:st,onChange:oc,audioHighlight})=>(
    <div className="mb-1.5"><div className="flex justify-between text-[10px] text-[#555] mb-0.5"><span>{label}</span><span className={audioHighlight?'text-[#ff6600]':'text-[#00ff88]'}>{typeof value==='number'?value.toFixed(2):value}</span></div>
    <input type="range" min={min} max={max} step={st} value={value} onChange={e=>oc(parseFloat(e.target.value))} className="w-full h-1.5 appearance-none bg-[#1a1a1a] outline-none cursor-pointer rounded-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#00ff88] [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:rounded-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-[#00ff88] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-none" style={{touchAction:'none'}}/></div>
  );
  const Toggle=({label,on,onChange:oc,accent})=>(<button onClick={()=>oc(!on)} className={`text-[10px] tracking-wider px-2 py-1.5 border cursor-pointer transition-all w-full text-left mb-1.5 ${on?`border-[${accent||'#00ff88'}] text-[${accent||'#00ff88'}] bg-[${accent||'#00ff88'}10]`:'border-[#222] text-[#555] bg-transparent hover:border-[#444]'}`}>[{on?'■':'○'}] {label}</button>);

  const Section=({id,title,icon,children,accent})=>{
    const isOpen=openSections[id]!==false;// default open
    return(<div className="mb-1 border-b border-[#111] pb-1">
      <button onClick={()=>toggleSection(id)} className="w-full flex items-center justify-between py-1.5 cursor-pointer group">
        <div className="flex items-center gap-2"><span className="text-sm">{icon}</span><span className={`text-[10px] tracking-widest font-bold ${accent?`text-[${accent}]`:'text-[#777]'}`}>{title}</span></div>
        <span className="text-[#444] text-[10px] group-hover:text-[#888] transition-colors">{isOpen?'▾':'▸'}</span>
      </button>
      {isOpen&&<div className="pl-1 pb-1">{children}</div>}
    </div>);
  };

  const ColorRow=({colors,current,onPick})=>(<div className="flex gap-1 mt-1 mb-1">{colors.map(c=>(<button key={c} onClick={()=>onPick(c)} className={`w-5 h-5 border cursor-pointer ${current===c?'border-[#00ff88] scale-110':'border-[#333]'}`} style={{background:c}}/>))}<input type="color" value={current} onChange={e=>onPick(e.target.value)} className="w-5 h-5 border border-[#333] cursor-pointer bg-transparent p-0"/></div>);


  return(
    <div className="fixed inset-0 bg-[#0a0a0a] overflow-hidden" style={{fontFamily:'Courier New,monospace'}}>
      <video ref={videoRef} className="hidden" playsInline muted/>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full"/>
      <div ref={fpsDisplayRef} className="fixed top-2 left-2 text-[10px] text-[#00ff88] bg-[#0a0a0acc] px-2 py-1 border border-[#222] z-50 backdrop-blur-sm">0 FPS</div>
      {recording&&<div className="fixed top-2 left-20 flex items-center gap-2 text-[10px] text-red-500 bg-[#0a0a0acc] px-2 py-1 border border-red-900 z-50"><span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"/>REC</div>}
      <button onClick={()=>setPanelOpen(p=>!p)} className={`fixed z-50 border border-[#333] bg-[#0a0a0a] text-[#888] w-8 h-8 flex items-center justify-center text-sm cursor-pointer hover:text-[#00ff88] hover:border-[#00ff88] transition-colors ${isMobile?'bottom-2 right-2':'top-2 right-2'}`}>{panelOpen?'✕':'☰'}</button>
      <button onClick={flipCamera} className={`fixed z-50 border border-[#333] bg-[#0a0a0a] text-[#888] px-2 py-1 text-xs cursor-pointer hover:text-[#00ff88] hover:border-[#00ff88] transition-colors ${isMobile?'bottom-2 left-2':'top-2 right-12'}`}>⟲</button>

      {/*═══ PANEL ═══*/}
      <div className={`fixed z-40 bg-[#080808f0] border-l border-[#1a1a1a] transition-transform duration-300 overflow-y-auto backdrop-blur-md ${isMobile?`bottom-0 left-0 right-0 border-t border-l-0 ${panelOpen?'translate-y-0':'translate-y-full'}`:`top-0 right-0 bottom-0 ${panelOpen?'translate-x-0':'translate-x-full'}`}`} style={{width:isMobile?'100%':'310px',maxHeight:isMobile?'70vh':'100vh'}}>
        <div className="p-3 pt-5">
          <div className="mb-3 flex items-center justify-between"><div><div className="text-[#00ff88] text-xs tracking-widest font-bold">VFX_STUDIO</div><div className="text-[#333] text-[8px] tracking-wider">v4 AUDIO REACTIVE</div></div></div>

          {/*presets*/}
          <div className="mb-3 pb-2 border-b border-[#111]">
            <div className="grid grid-cols-4 gap-0.5">{Object.entries(PRESETS).map(([n,fn])=>(<button key={n} onClick={()=>applyPreset(fn)} className="text-[7px] tracking-wider border border-[#222] text-[#666] py-1.5 cursor-pointer hover:border-[#00ff88] hover:text-[#00ff88] transition-colors truncate px-0.5">{n.toUpperCase()}</button>))}</div>
            <button onClick={randomizeAll} className="w-full mt-1 text-[9px] tracking-widest border border-[#ff6600] text-[#ff6600] py-2 cursor-pointer hover:bg-[#ff660020] transition-colors font-bold">🎲 RANDOMIZE ALL</button>
          </div>

          {/*chaos*/}
          <div className="mb-2 pb-2 border-b border-[#111]"><Slider label="⚡ MASTER CHAOS" value={chaos} min={0} max={1} step={0.01} onChange={setChaos}/></div>

          {/*camera + recording at top*/}
          {devices.length>1&&<div className="mb-2 pb-2 border-b border-[#111]">
            <div className="text-[9px] text-[#666] tracking-wider mb-1">📷 CAMERA</div>
            <select value={selectedDevice} onChange={e=>switchCamera(e.target.value)} className="w-full bg-[#111] border border-[#222] text-[#888] text-[10px] p-1.5 outline-none cursor-pointer">
              {devices.map(d=>(<option key={d.deviceId} value={d.deviceId}>{d.label||`Camera ${devices.indexOf(d)+1}`}</option>))}
            </select>
          </div>}
          <div className="mb-2 pb-2 border-b border-[#111]">
            <button onClick={recording?stopRecording:startRecording} className={`w-full text-[10px] tracking-wider py-2 border cursor-pointer transition-colors mb-1 ${recording?'border-red-700 text-red-400 bg-red-950/20':'border-[#222] text-[#666] hover:border-[#00ff88] hover:text-[#00ff88]'}`}>{recording?'■ STOP RECORDING':'● START RECORDING'}</button>
            <div className="flex gap-1 items-center">
              <Toggle label="MIC" on={micOn} onChange={setMicOn}/>
              {micOn&&<div className="flex-1"><Slider label="GAIN" value={micGain} min={0} max={2} step={0.1} onChange={setMicGain}/></div>}
            </div>
          </div>

          <Section id="audio" title="AUDIO REACTIVE" icon="🎵" accent="#ff6600">
            <Toggle label="ENABLE AUDIO" on={fx.audio.on} onChange={v=>updateFx('audio','on',v)} accent="#ff6600"/>
            <Slider label="SENSITIVITY" value={fx.audio.sensitivity} min={0.3} max={3} step={0.1} onChange={v=>updateFx('audio','sensitivity',v)} audioHighlight/>
            <div className="flex gap-1 items-end h-6 mb-2">
              <div className="flex-1 bg-[#111] h-full relative"><div ref={el=>{if(audioBarRefs.current)audioBarRefs.current.bass=el;}} className="absolute bottom-0 left-0 right-0 bg-red-600 transition-none" style={{height:'0%'}}/><div className="absolute bottom-0 text-[7px] text-[#666] w-full text-center">B</div></div>
              <div className="flex-1 bg-[#111] h-full relative"><div ref={el=>{if(audioBarRefs.current)audioBarRefs.current.mid=el;}} className="absolute bottom-0 left-0 right-0 bg-yellow-500 transition-none" style={{height:'0%'}}/><div className="absolute bottom-0 text-[7px] text-[#666] w-full text-center">M</div></div>
              <div className="flex-1 bg-[#111] h-full relative"><div ref={el=>{if(audioBarRefs.current)audioBarRefs.current.high=el;}} className="absolute bottom-0 left-0 right-0 bg-cyan-400 transition-none" style={{height:'0%'}}/><div className="absolute bottom-0 text-[7px] text-[#666] w-full text-center">H</div></div>
              <div ref={el=>{if(audioBarRefs.current)audioBarRefs.current.beat=el;}} className="text-[8px] text-red-500 font-bold" style={{opacity:0}}>BEAT</div>
            </div>
            <div className="text-[8px] text-[#444] mt-1">Kicks/transients trigger effect bursts</div>
          </Section>

          <div className="mb-2 pb-2 border-b border-[#111]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#666] tracking-wider">♩ BPM</span>
              <input type="number" min={0} max={300} value={bpm} onChange={e=>setBpm(clamp(parseInt(e.target.value)||0,0,300))}
                className="w-16 bg-[#111] border border-[#222] text-[#00ff88] text-[11px] p-1 outline-none text-center font-bold" placeholder="OFF"/>
              <div className="flex gap-0.5">{[0,80,120,140,160].map(b=>(<button key={b} onClick={()=>setBpm(b)} className={`text-[7px] px-1.5 py-0.5 border cursor-pointer ${bpm===b?'border-[#00ff88] text-[#00ff88]':'border-[#222] text-[#555]'}`}>{b||'OFF'}</button>))}</div>
            </div>
            <div className="text-[8px] text-[#444] mt-0.5">Effects pulse at this tempo (0 = off)</div>
          </div>

          <Section id="trails" title="★ MOTION TRAILS" icon="👻">
            <Toggle label="TRAILS" on={fx.trails.on} onChange={v=>updateFx('trails','on',v)}/>
            <Slider label="DECAY (↓ = longer)" value={fx.trails.decay} min={0.001} max={0.1} step={0.001} onChange={v=>updateFx('trails','decay',v)}/>
            <Slider label="LENGTH" value={fx.trails.length} min={0.1} max={1} step={0.05} onChange={v=>updateFx('trails','length',v)}/>
            <Slider label="BRIGHTNESS" value={fx.trails.brightness} min={0.3} max={2} step={0.1} onChange={v=>updateFx('trails','brightness',v)}/>
            <Toggle label="MOTION ONLY" on={fx.trails.motionOnly} onChange={v=>updateFx('trails','motionOnly',v)}/>
          </Section>

          <Section id="stutter" title="FPS STUTTER" icon="⏱"><Toggle label="FRAME LIMITER" on={fx.stutter.on} onChange={v=>updateFx('stutter','on',v)}/><Slider label="TARGET FPS" value={fx.stutter.targetFps} min={2} max={30} step={1} onChange={v=>updateFx('stutter','targetFps',v)}/></Section>

          <Section id="feedback" title="DATAMOSH" icon="🌀">
            <Toggle label="FEEDBACK LOOP" on={fx.feedback.on} onChange={v=>updateFx('feedback','on',v)}/>
            <Slider label="ZOOM" value={fx.feedback.zoom} min={1.005} max={1.1} step={0.005} onChange={v=>updateFx('feedback','zoom',v)}/>
            <Slider label="ROTATE" value={fx.feedback.rotate} min={0} max={5} step={0.1} onChange={v=>updateFx('feedback','rotate',v)}/>
            <Slider label="MIX" value={fx.feedback.mix} min={0.3} max={0.98} step={0.01} onChange={v=>updateFx('feedback','mix',v)}/>
            <Slider label="DRIFT" value={fx.feedback.drift} min={0} max={1} step={0.05} onChange={v=>updateFx('feedback','drift',v)}/>
          </Section>

          <Section id="pixelsort" title="PIXEL SORT" icon="▦"><Toggle label="PIXEL SORT" on={fx.pixelSort.on} onChange={v=>updateFx('pixelSort','on',v)}/><Slider label="THRESHOLD" value={fx.pixelSort.threshold} min={20} max={200} step={5} onChange={v=>updateFx('pixelSort','threshold',v)}/><div className="flex gap-0.5">{['HORIZ','VERT'].map((n,i)=>(<button key={n} onClick={()=>updateFx('pixelSort','direction',i)} className={`text-[8px] flex-1 tracking-wider border py-1 cursor-pointer ${fx.pixelSort.direction===i?'border-[#00ff88] text-[#00ff88]':'border-[#222] text-[#555]'}`}>{n}</button>))}</div></Section>

          <Section id="edge" title="EDGE GLOW" icon="✦"><Toggle label="SILHOUETTE" on={fx.edge.on} onChange={v=>updateFx('edge','on',v)}/><Slider label="THRESHOLD" value={fx.edge.threshold} min={5} max={80} step={1} onChange={v=>updateFx('edge','threshold',v)}/><Slider label="GLOW" value={fx.edge.glow} min={0.3} max={3} step={0.1} onChange={v=>updateFx('edge','glow',v)}/><ColorRow colors={['#00ffff','#ff00ff','#ffffff','#ff4400']} current={fx.edge.color} onPick={c=>updateFx('edge','color',c)}/></Section>

          <Section id="vhs" title="VHS DISTORTION" icon="📼"><Toggle label="VHS" on={fx.vhs.on} onChange={v=>updateFx('vhs','on',v)}/><Slider label="DISTORTION" value={fx.vhs.distortion} min={0.05} max={1} step={0.05} onChange={v=>updateFx('vhs','distortion',v)}/><Slider label="COLOR BLEED" value={fx.vhs.colorBleed} min={0} max={1} step={0.05} onChange={v=>updateFx('vhs','colorBleed',v)}/></Section>

          <Section id="crush" title="BLACK CRUSH" icon="◼"><Toggle label="CRUSH" on={fx.crush.on} onChange={v=>updateFx('crush','on',v)}/><Slider label="CONTRAST" value={fx.crush.contrast} min={1} max={3} step={0.1} onChange={v=>updateFx('crush','contrast',v)}/><Slider label="BLACK LEVEL" value={fx.crush.blackLevel} min={0} max={80} step={1} onChange={v=>updateFx('crush','blackLevel',v)}/></Section>

          <Section id="chromatic" title="RGB SPLIT" icon="🔴"><Toggle label="CHROMATIC" on={fx.chromatic.on} onChange={v=>updateFx('chromatic','on',v)}/><Slider label="OFFSET" value={fx.chromatic.offset} min={1} max={20} step={1} onChange={v=>updateFx('chromatic','offset',v)}/></Section>



          <Section id="scanlines" title="CRT / NOISE" icon="▤"><Toggle label="SCANLINES" on={fx.scanlines.on} onChange={v=>updateFx('scanlines','on',v)}/><Slider label="LINE OPACITY" value={fx.scanlines.opacity} min={0.05} max={1} step={0.05} onChange={v=>updateFx('scanlines','opacity',v)}/><Slider label="NOISE" value={fx.scanlines.noise} min={0} max={0.8} step={0.05} onChange={v=>updateFx('scanlines','noise',v)}/></Section>

          <Section id="strobe" title="STROBE" icon="⚡"><Toggle label="STROBE" on={fx.strobe.on} onChange={v=>updateFx('strobe','on',v)}/><Slider label="RATE" value={fx.strobe.rate} min={1} max={15} step={1} onChange={v=>updateFx('strobe','rate',v)}/><Slider label="INTENSITY" value={fx.strobe.intensity} min={0.1} max={1} step={0.05} onChange={v=>updateFx('strobe','intensity',v)}/></Section>

          <Section id="palette" title="COLOR REMAP" icon="🎨"><Toggle label="PALETTE" on={fx.palette.on} onChange={v=>updateFx('palette','on',v)}/><div className="grid grid-cols-2 gap-0.5">{PALETTE_NAMES.map((n,i)=>(<button key={n} onClick={()=>updateFx('palette','mode',i)} className={`text-[8px] tracking-wider border py-1 cursor-pointer ${fx.palette.mode===i?'border-[#00ff88] text-[#00ff88]':'border-[#222] text-[#555]'}`}>{n}</button>))}</div></Section>

          <Section id="bloom" title="BLOOM" icon="☀"><Toggle label="GLOW" on={fx.bloom.on} onChange={v=>updateFx('bloom','on',v)}/><Slider label="INTENSITY" value={fx.bloom.intensity} min={0.1} max={1} step={0.05} onChange={v=>updateFx('bloom','intensity',v)}/></Section>

          <Section id="mirror" title="MIRROR" icon="◇"><Toggle label="MIRROR" on={fx.mirror.on} onChange={v=>updateFx('mirror','on',v)}/><div className="grid grid-cols-4 gap-0.5">{MIRROR_NAMES.map((n,i)=>(<button key={n} onClick={()=>updateFx('mirror','mode',i)} className={`text-[7px] tracking-wider border py-1 cursor-pointer ${fx.mirror.mode===i?'border-[#00ff88] text-[#00ff88]':'border-[#222] text-[#555]'}`}>{n}</button>))}</div></Section>

          <Section id="slitscan" title="SLIT SCAN" icon="◈"><Toggle label="SLIT SCAN" on={fx.slitScan.on} onChange={v=>updateFx('slitScan','on',v)}/><Slider label="TIME OFFSET" value={fx.slitScan.offset} min={3} max={60} step={1} onChange={v=>updateFx('slitScan','offset',v)}/><div className="text-[8px] text-[#444] mt-0.5">Each row shows a different moment in time</div></Section>

          <Section id="invert" title="INVERT" icon="◐"><Toggle label="NEGATIVE" on={fx.invert.on} onChange={v=>updateFx('invert','on',v)}/></Section>

          <Section id="posterize" title="POSTERIZE" icon="▧"><Toggle label="POSTERIZE" on={fx.posterize.on} onChange={v=>updateFx('posterize','on',v)}/><Slider label="LEVELS" value={fx.posterize.levels} min={2} max={12} step={1} onChange={v=>updateFx('posterize','levels',v)}/></Section>

          <Section id="zoompulse" title="ZOOM PULSE" icon="◉"><Toggle label="ZOOM PULSE" on={fx.zoomPulse.on} onChange={v=>updateFx('zoomPulse','on',v)}/><Slider label="SPEED" value={fx.zoomPulse.speed} min={0.5} max={8} step={0.5} onChange={v=>updateFx('zoomPulse','speed',v)}/><Slider label="AMOUNT" value={fx.zoomPulse.amount} min={0.005} max={0.1} step={0.005} onChange={v=>updateFx('zoomPulse','amount',v)}/></Section>




          <div className="text-[7px] text-[#222] mt-3 tracking-wider text-center">VFX_STUDIO v4 // AUDIO REACTIVE ENGINE</div>
        </div>
      </div>
    </div>
  );
}

/* pixel sort helpers */
function sortRow(d,W,y,x1,x2){const pixels=[];for(let x=x1;x<x2;x++){const i=(y*W+x)*4;pixels.push([d[i],d[i+1],d[i+2],d[i+3]]);}pixels.sort((a,b)=>(a[0]*0.3+a[1]*0.59+a[2]*0.11)-(b[0]*0.3+b[1]*0.59+b[2]*0.11));for(let j=0;j<pixels.length;j++){const i=(y*W+(x1+j))*4;d[i]=pixels[j][0];d[i+1]=pixels[j][1];d[i+2]=pixels[j][2];d[i+3]=pixels[j][3];}}
function sortCol(d,W,x,y1,y2){const pixels=[];for(let y=y1;y<y2;y++){const i=(y*W+x)*4;pixels.push([d[i],d[i+1],d[i+2],d[i+3]]);}pixels.sort((a,b)=>(a[0]*0.3+a[1]*0.59+a[2]*0.11)-(b[0]*0.3+b[1]*0.59+b[2]*0.11));for(let j=0;j<pixels.length;j++){const i=((y1+j)*W+x)*4;d[i]=pixels[j][0];d[i+1]=pixels[j][1];d[i+2]=pixels[j][2];d[i+3]=pixels[j][3];}}
