// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Offline development only: add realistic media-codec errors to our own pairs.
// Reconstruction remains our JavaScript; FFmpeg is not a production dependency.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {CalibratedOverlay} from '../src/overlay.js';
const [source,target]=process.argv.slice(2);
if(!source||!target||source===target)throw Error('Provide separate input/output pair directories.');
fs.mkdirSync(target,{recursive:true});
const w=128,h=128,n=w*h,r={x:29,y:27,w:70,h:74};
function morph(a,radius,dilate){
 const out=new Uint8Array(a.length);
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
  let value=dilate?0:1;
  for(let yy=y-radius;yy<=y+radius;yy++)for(let xx=x-radius;xx<=x+radius;xx++){
   const v=xx>=0&&yy>=0&&xx<r.w&&yy<r.h?a[yy*r.w+xx]:0;value=dilate?Math.max(value,v):Math.min(value,v);
  }out[y*r.w+x]=value;
 }return out;
}
function run(args,input){
 const result=spawnSync('ffmpeg',['-v','error',...args],{input,maxBuffer:256*1024*1024});
 if(result.status!==0)throw Error(result.stderr.toString());return result.stdout;
}
for(const split of ['train','validation']){
 const records=fs.readFileSync(`${source}/${split}.pairs.bin`),count=records.length/(n*11);
 if(!Number.isInteger(count))throw Error('Incomplete original training records.');
 const rgb=Buffer.alloc(count*n*3);
 for(let i=0;i<count*n;i++)for(let c=0;c<3;c++)rgb[i*3+c]=records[i*11+c];
 const compressed=[18,24,30].map(crf=>{
  const bitstream=run(['-f','rawvideo','-pix_fmt','rgb24','-s',`${w}x${h}`,'-r','24','-i','pipe:0','-c:v','libx264','-preset','fast','-crf',String(crf),'-g','12','-bf','0','-pix_fmt','yuv420p','-f','h264','pipe:1'],rgb);
  const decoded=run(['-f','h264','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],bitstream);
  if(decoded.length!==rgb.length)throw Error('Codec augmentation changed frame count.');return decoded;
 });
 const output=fs.openSync(`${target}/${split}.pairs.bin`,'w');
 try{
  // Retain all original pairs as well as one encoded variant of each pair.
  fs.writeSync(output,records);
  for(let f=0;f<count;f++){
   const pair=Buffer.from(records.subarray(f*n*11,(f+1)*n*11)),original=new Uint8ClampedArray(n*4),alpha=new Float32Array(r.w*r.h);
   for(let i=0;i<n;i++){for(let c=0;c<3;c++){original[i*4+c]=compressed[f%3][f*n*3+i*3+c];pair[i*11+c]=original[i*4+c];}original[i*4+3]=255;}
   for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)alpha[y*r.w+x]=pair[((y+r.y)*w+x+r.x)*11+6]/255;
   const values=[...alpha].filter(v=>v>.05).sort((a,b)=>a-b),peak=values[Math.floor(values.length*.9)];
   const support=Uint8Array.from(alpha,(_,i)=>pair[((Math.floor(i/r.w)+r.y)*w+i%r.w+r.x)*11+7]>0),core=morph(Uint8Array.from(alpha,a=>a>peak*.5),1,false),band=Uint8Array.from(support,(v,i)=>v&&!core[i]);
   const model=new CalibratedOverlay(r,255,alpha,core,band,{corePixels:core.reduce((s,v)=>s+v,0),bandPixels:band.reduce((s,v)=>s+v,0),peakAlpha:peak});
   model.evidence=()=>true;model.frameGain=()=>1;
   const repaired=original.slice();model.recover(repaired,w,h,r,{seamless:true});
   for(let i=0;i<n;i++)for(let c=0;c<3;c++)pair[i*11+3+c]=repaired[i*4+c];
   fs.writeSync(output,pair);
  }
 }finally{fs.closeSync(output);}
 console.log(split,count*2,'pairs, half codec-augmented');
}
fs.writeFileSync(`${target}/codec-data.json`,JSON.stringify({source,codecs:['H.264 YUV420p'],crf:[18,24,30],cleanLabels:'Original unmarked clean crops, unchanged. No third-party teacher.',split:'The existing held-out source-frame interval is preserved.',runtime:'Offline training data preparation only.'},null,2));
