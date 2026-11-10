// Original-classical-repair inputs and known clean targets, kept private.
// No third-party inpainting outputs or pretrained weights are used.
import fs from 'node:fs';import {CalibratedOverlay} from '../src/overlay.js';
const root=process.env.RGB_PAIRS_ROOT||'.runtime/rgb-refiner',w=128,h=128,n=w*h,r={x:29,y:27,w:70,h:74};let state=20261106;
const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
function morph(a,radius,dilate){const out=new Uint8Array(a.length);for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){let value=dilate?0:1;for(let yy=y-radius;yy<=y+radius;yy++)for(let xx=x-radius;xx<=x+radius;xx++){const v=xx>=0&&yy>=0&&xx<r.w&&yy<r.h?a[yy*r.w+xx]:0;value=dilate?Math.max(value,v):Math.min(value,v);}out[y*r.w+x]=value;}return out;}
for(const split of ['train','validation']){
 const bytes=fs.readFileSync(`${root}/${split}.clean.rgb`),records=bytes.length/(n*3),out=fs.openSync(`${root}/${split}.pairs.bin`,'w');
 for(let index=0;index<records;index++)for(let variant=0;variant<2;variant++){
  const clean=bytes.subarray(index*n*3,(index+1)*n*3),original=new Uint8ClampedArray(n*4),observed=new Uint8ClampedArray(n*4),alpha=new Float32Array(r.w*r.h),white=new Float32Array(alpha.length),dark=new Float32Array(alpha.length),cx=34+(rand()-.5)*10,cy=36+(rand()-.5)*10,rx=23+rand()*7,ry=23+rand()*7,p=.62+rand()*.20,opacity=.27+rand()*.06,gain=.95+rand()*.10,noise=rand()*.007,darkAmplitude=.005+rand()*.02;
  for(let i=0;i<n;i++)original.set([clean[i*3],clean[i*3+1],clean[i*3+2],255],i*4);observed.set(original);
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=y*r.w+x,d=(Math.abs(x-cx)/rx)**p+(Math.abs(y-cy)/ry)**p;let coverage=Math.max(0,Math.min(1,(1-d)*12));if(process.env.HARD_EDGES==='1'&&variant===1){coverage=0;for(const oy of [-.375,-.125,.125,.375])for(const ox of [-.375,-.125,.125,.375])if((Math.abs(x+ox-cx)/rx)**p+(Math.abs(y+oy-cy)/ry)**p<1)coverage+=1/16;}white[i]=opacity*coverage;dark[i]=darkAmplitude*Math.exp(-(((d-1)/.05)**2));for(let c=0;c<3;c++){const j=((r.y+y)*w+r.x+x)*4+c;observed[j]=original[j]*(1-white[i]-dark[i])+255*white[i]+(rand()-.5)*.8;}}
  // An independently perturbed opacity estimate models calibration error;
  // it is not supplied with the true clean target at reconstruction time.
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=y*r.w+x;let sum=0,count=0;for(let yy=Math.max(0,y-1);yy<=Math.min(r.h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(r.w-1,x+1);xx++){sum+=white[yy*r.w+xx];count++;}alpha[i]=Math.max(0,sum/count*gain+noise*Math.sin(x*.19+y*.13)*(white[i]>.01));}
  const support=morph(Uint8Array.from(alpha,a=>a>.002),2,true),core=morph(Uint8Array.from(alpha,a=>a>opacity*.5),1,false),band=Uint8Array.from(support,(v,i)=>v&&!core[i]),model=new CalibratedOverlay(r,255,alpha,core,band,{corePixels:core.reduce((s,v)=>s+v,0),bandPixels:band.reduce((s,v)=>s+v,0),peakAlpha:opacity});
  model.evidence=()=>true;model.frameGain=()=>1;const repaired=observed.slice();model.recover(repaired,w,h,r,{seamless:true});
  // Eleven interleaved bytes per pixel: observed RGB, repaired RGB,
  // estimated alpha, support, clean target RGB.
  const packed=Buffer.alloc(n*11);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,j=i*11,local=x>=r.x&&y>=r.y&&x<r.x+r.w&&y<r.y+r.h?(y-r.y)*r.w+x-r.x:-1;for(let c=0;c<3;c++){packed[j+c]=observed[i*4+c];packed[j+3+c]=repaired[i*4+c];packed[j+8+c]=clean[i*3+c];}packed[j+6]=local>=0?Math.round(alpha[local]*255):0;packed[j+7]=local>=0&&support[local]?255:0;}fs.writeSync(out,packed);
  if((index*2+variant+1)%96===0)console.log(split,index*2+variant+1,'pairs');
 }fs.closeSync(out);console.log(split,'complete',records*2);
}
