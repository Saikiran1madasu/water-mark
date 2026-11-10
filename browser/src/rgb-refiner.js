// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Original from-scratch RGB-restoration experiment. Model promotion requires
// independent reconstruction and temporal validation, not training loss alone.
const side=128,pixels=side*side,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const RGB_REFINER_SHA256='4c405764bb5a78a38a4608de2e1b76d260bad39ff3d5fa8fc56f11d279c7a68b';
export async function loadOriginalRGBRefiner(onPhase=()=>{}){
 onPhase('Loading our original reconstruction model…');
 const response=await fetch(new URL('./models/own-rgb-v3.onnx',import.meta.url));if(!response.ok)throw Error('Could not load our reconstruction model. Refresh and try again.');
 return OriginalRGBRefiner.create({modelBytes:new Uint8Array(await response.arrayBuffer()),expectedSHA256:RGB_REFINER_SHA256});
}
export function prepareRGBRefinement(original,repaired,w,h,r,model){
 if(![w,h,r.x,r.y,r.w,r.h].every(Number.isInteger)||w<1||h<1||r.x<0||r.y<0||r.w<1||r.h<1||r.x+r.w>w||r.y+r.h>h)throw Error('Invalid RGB refinement area.');
 if(original.length!==w*h*4||repaired.length!==original.length||model.alpha.length!==r.w*r.h||model.core.length!==model.alpha.length||model.band.length!==model.alpha.length)throw Error('Invalid RGB refinement buffers.');
 if(r.w>112||r.h>112)return null;
 const rect={x:clamp(Math.round(r.x+r.w/2-side/2),0,Math.max(0,w-side)),y:clamp(Math.round(r.y+r.h/2-side/2),0,Math.max(0,h-side)),w:side,h:side},input=new Float32Array(pixels*8);
 for(let y=0;y<side;y++)for(let x=0;x<side;x++){
  const i=y*side+x,xx=clamp(rect.x+x,0,w-1),yy=clamp(rect.y+y,0,h-1),j=(yy*w+xx)*4;
  for(let c=0;c<3;c++){input[c*pixels+i]=original[j+c]/255;input[(c+3)*pixels+i]=repaired[j+c]/255;}
  if(xx>=r.x&&yy>=r.y&&xx<r.x+r.w&&yy<r.y+r.h){const k=(yy-r.y)*r.w+xx-r.x;if(model.core[k]||model.band[k]){input[6*pixels+i]=Math.round(model.alpha[k]*255)/255;input[7*pixels+i]=1;}}
 }
 return {rect,input};
}
export function commitRGBRefinement(repaired,w,h,r,model,prepared,values){
 if(values.length!==pixels*3||values.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Invalid RGB restoration result.');
 const changes=[];
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
  const k=y*r.w+x;if(!model.core[k]&&!model.band[k])continue;
  const i=(r.y+y-prepared.rect.y)*side+r.x+x-prepared.rect.x,j=((r.y+y)*w+r.x+x)*4;
  if(i<0||i>=pixels)throw Error('Restoration area does not fit its context.');
  for(let c=0;c<3;c++){const value=values[c*pixels+i]*255;if(Math.abs(value-repaired[j+c])>16.1)throw Error('Restoration exceeded the bounded correction range.');changes.push([j+c,value]);}
 }
 // Validate the entire proposal before writing even a single source byte.
 const out=repaired.slice();for(const [j,value]of changes)out[j]=value;return out;
}
export class OriginalRGBRefiner{
 constructor(ort,session){this.ort=ort;this.session=session;}
 static async create({runtime,modelBytes,expectedSHA256}){
  if(!modelBytes||!/^[a-f0-9]{64}$/.test(expectedSHA256??''))throw Error('An independently verified original checkpoint is required.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',modelBytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==expectedSHA256)throw Error('The RGB checkpoint does not match its recorded hash.');
  const ort=runtime??await import('onnxruntime-web/wasm');ort.env.wasm.numThreads=1;if(!runtime)ort.env.wasm.wasmPaths=new URL('./ort/',import.meta.url).href;
  return new OriginalRGBRefiner(ort,await ort.InferenceSession.create(modelBytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'}));
 }
 async process(original,repaired,w,h,r,model,{selfCalibrate=false}={}){
  const prepared=prepareRGBRefinement(original,repaired,w,h,r,model);if(!prepared)return null;
  const tensor=new this.ort.Tensor('float32',prepared.input,[1,8,side,side]);let results,counterTensor,counterResults;
  try{
   results=await this.session.run({input:tensor});const value=results.recovered;if(!value||value.type!=='float32'||value.dims.join(':')!==[1,3,side,side].join(':'))throw Error('Unexpected original RGB model output.');
   let output=value.data;
   if(selfCalibrate){
    // Feed the SAME current-frame repair through a simulated overlay. Its
    // response measures fixed model/shape bias without a clean reference.
    // Subtract only that response; no previous painted frame is imported.
    const simulated=prepared.input.slice();
    for(let i=0;i<pixels;i++)for(let c=0;c<3;c++){const a=simulated[6*pixels+i],base=simulated[(3+c)*pixels+i];simulated[c*pixels+i]=base*(1-a)+a;}
    counterTensor=new this.ort.Tensor('float32',simulated,[1,8,side,side]);counterResults=await this.session.run({input:counterTensor});const counter=counterResults.recovered;
    if(!counter||counter.type!=='float32'||counter.dims.join(':')!==[1,3,side,side].join(':')||counter.data.some(v=>!Number.isFinite(v)||v<0||v>1)||output.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Invalid RGB self-calibration output.');
    output=Float32Array.from(output,(v,j)=>clamp(prepared.input[3*pixels+j]+clamp(v-counter.data[j],-16/255,16/255),0,1));
   }
   return commitRGBRefinement(repaired,w,h,r,model,prepared,output);
  }finally{tensor.dispose();counterTensor?.dispose();if(results)for(const value of Object.values(results))value.dispose();if(counterResults)for(const value of Object.values(counterResults))value.dispose();}
 }
 async dispose(){await this.session.release();}
 async refineRepair(original,repaired,w,h,r,model,{preserveMask}={}){
  if(preserveMask&&preserveMask.length!==r.w*r.h)throw Error('Invalid original-reference preservation mask.');
  const data=await this.process(original,repaired,w,h,r,model,{selfCalibrate:true});if(!data)return null;
  const changedMask=new Uint8Array(r.w*r.h);let changed=0;
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
   const i=y*r.w+x;if(!model.core[i]&&!model.band[i])continue;const j=((r.y+y)*w+r.x+x)*4;
   // Sequence validation improves the uncertain contour, not the inverted
   // interior. Preserve that interior and all verified original references.
   if(model.core[i]||preserveMask?.[i]){for(let c=0;c<3;c++)data[j+c]=repaired[j+c];continue;}
   if([0,1,2].some(c=>data[j+c]!==repaired[j+c])){changedMask[i]=1;changed++;}
  }
  return {data,pixels:changed,changedMask};
 }
}
