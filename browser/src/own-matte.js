// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Original 6,818-parameter matte refiner; original, from-scratch trained weights.
// ONNX Runtime is an inference library, not a third-party removal model.
import {repairBand,fitColorLine} from './overlay.js';
import {matchBoundaryCurvature} from './boundary.js';
import {matchSmoothTone} from './tone.js';
export const OWN_MODEL_SHA256='7d03f891d9a8fe0d62670943ea469ac41afb53986a2207b7f66cca4cc2530618';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function ownContextRect(r,w,h){const side=Math.max(128,Math.max(r.w,r.h)+48),cw=Math.min(w,side),ch=Math.min(h,side);return {x:clamp(Math.round(r.x+r.w/2-cw/2),0,w-cw),y:clamp(Math.round(r.y+r.h/2-ch/2),0,h-ch),w:cw,h:ch};}
export function prepareOwnMatte(data,w,h,r,model,gain=1){
 if(![w,h,r.x,r.y,r.w,r.h].every(Number.isInteger)||data.length!==w*h*4||r.w<1||r.h<1||r.x<0||r.y<0||r.x+r.w>w||r.y+r.h>h||model.alpha.length!==r.w*r.h)throw Error('Invalid matte reconstruction area.');
 const rect=ownContextRect(r,w,h),n=rect.w*rect.h,input=new Float32Array(n*7),support=new Uint8Array(n);
 for(let y=0;y<rect.h;y++)for(let x=0;x<rect.w;x++){
  const i=y*rect.w+x,xx=rect.x+x,yy=rect.y+y,j=(yy*w+xx)*4;for(let c=0;c<3;c++)input[c*n+i]=data[j+c]/255;
  input[5*n+i]=rect.w>1?2*x/(rect.w-1)-1:0;input[6*n+i]=rect.h>1?2*y/(rect.h-1)-1:0;
  if(xx>=r.x&&yy>=r.y&&xx<r.x+r.w&&yy<r.y+r.h){const k=(yy-r.y)*r.w+xx-r.x;if(model.core[k]||model.band[k]){support[i]=1;input[3*n+i]=clamp(model.alpha[k]*gain,0,.65);input[4*n+i]=1;}}
 }
 return {rect,n,input,support};
}
export function validateMatteProposal(data,w,h,r,model,prepared,matte){
 const line=fitColorLine(data,w,h,r);if(!line||line.condition<18||line.error>2.2||line.variance<16||line.variance/Math.max(1,line.total)<.9)return false;
 const before=[],after=[],{rect,n,input}=prepared;
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(model.core[y*r.w+x]){
  const i=(r.y+y-rect.y)*rect.w+r.x+x-rect.x,j=((r.y+y)*w+r.x+x)*4;
  for(const [a,b,errors] of [[input[3*n+i],0,before],[matte[i],matte[n+i],after]]){
   const difference=[0,1,2].map(c=>(data[j+c]-255*a)/Math.max(.15,1-a-b)-line.mean[c]),along=difference.reduce((s,v,c)=>s+v*line.v[c],0);
   errors.push(Math.sqrt(difference.reduce((s,v,c)=>s+(v-along*line.v[c])**2,0)/3));
  }
 }
 if(before.length<30)return false;
 const score=values=>{values.sort((a,b)=>a-b);const count=Math.max(1,Math.floor(values.length*.7));return values.slice(0,count).reduce((a,b)=>a+b,0)/count;},a=score(before),b=score(after);
 return b<2&&a-b>.2&&b<a*.85;
}
export class OwnMatteEngine{
 constructor(ort,session){this.ort=ort;this.session=session;this.previous=null;this.stats={frames:0,selected:0,preserved:0,ownModelFrames:0,ownModelPixels:0,ownSkippedFrames:0,ownRejectedProposals:0,decomposed:0,lighting:0};}
 static async create({runtime,modelBytes,onPhase=()=>{}}={}){
  onPhase('Loading our experimental repair model…');const ort=runtime??await import('onnxruntime-web/wasm');ort.env.wasm.numThreads=1;if(!runtime)ort.env.wasm.wasmPaths=new URL('./ort/',import.meta.url).href;
  if(!modelBytes){const response=await fetch(new URL('./models/own-matte-v1.onnx',import.meta.url));if(!response.ok)throw Error('Could not load the original repair model. Refresh and try again.');modelBytes=new Uint8Array(await response.arrayBuffer());}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',modelBytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==OWN_MODEL_SHA256)throw Error('The original repair model file does not match this version.');
  return new OwnMatteEngine(ort,await ort.InferenceSession.create(modelBytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'}));
 }
 async process(data,w,h,r,model){
  if(!model)return null;
  if(!model.evidence(data,w,h,r)){this.stats.frames++;this.stats.selected+=r.w*r.h;this.stats.preserved+=r.w*r.h;this.stats.ownSkippedFrames++;this.previous=null;return {method:'preserved'};}
  const gain=model.frameGain?.(data,w,h,r)??1,prepared=prepareOwnMatte(data,w,h,r,model,gain),{n,rect,input,support}=prepared,tensor=new this.ort.Tensor('float32',input,[1,7,rect.h,rect.w]);let results;
  try{
   results=await this.session.run({input:tensor});const result=results.matte;
   if(!result||result.type!=='float32'||result.dims.join(':')!==[1,2,rect.h,rect.w].join(':')||result.data.length!==2*n||result.data.some(v=>!Number.isFinite(v)||v<0||v>.8))throw Error('Our repair model returned an invalid matte.');
   const key=[w,h,rect.x,rect.y,rect.w,rect.h].join(':'),prior=this.previous?.key===key?this.previous:null,matte=new Float32Array(2*n);let pixels=0;
   for(let i=0;i<n;i++)if(support[i])for(let c=0;c<2;c++){const j=c*n+i,retention=(prior&&prior.support[i]&&Math.abs(result.data[j]-prior.matte[j])<.04)? .65:0;matte[j]=result.data[j]*(1-retention)+(prior?prior.matte[j]*retention:0);}
   if(!validateMatteProposal(data,w,h,r,model,prepared,matte)){this.stats.ownRejectedProposals++;this.previous=null;return null;}
   this.stats.frames++;this.stats.selected+=r.w*r.h;
   let region=new Float32Array(r.w*r.h*3);
   for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
    const i=(r.y+y-rect.y)*rect.w+r.x+x-rect.x,j=((r.y+y)*w+r.x+x)*4,k=y*r.w+x,a=matte[i],b=matte[n+i],transmission=Math.max(.15,1-a-b);
    for(let c=0;c<3;c++)region[k*3+c]=support[i]?clamp((data[j+c]-255*a)/transmission,0,255):data[j+c];
   }
   // The learned boundary estimate failed the actual-clip outline test. Keep
   // the established original directional reconstruction for this uncertainty.
   region=repairBand(region,r.w,r.h,model.band);region=matchBoundaryCurvature(region,r.w,r.h,model.band);
   const tone=matchSmoothTone(region,r.w,r.h,model.core,model.band);region=tone.image;
   let corePixels=0,bandPixels=0;
   for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=y*r.w+x;if(!model.core[i]&&!model.band[i])continue;const j=((r.y+y)*w+r.x+x)*4;for(let c=0;c<3;c++)data[j+c]=region[i*3+c];pixels++;if(model.core[i])corePixels++;else bandPixels++;}
   this.previous={key,matte,support};this.stats.ownModelFrames++;this.stats.ownModelPixels+=pixels;this.stats.decomposed+=corePixels-tone.pixels;this.stats.lighting+=bandPixels+tone.pixels;this.stats.preserved+=r.w*r.h-pixels;return {method:'own-matte'};
  }finally{tensor.dispose();if(results)for(const result of Object.values(results))result.dispose();}
 }
 report(){return {...this.stats,pattern:0,temporal:0,fallback:0,globalInverseFrames:0};}
 async dispose(){this.previous=null;await this.session.release();}
}
export function combineRepairReports(primary,support){
 const combined={...primary,...support};for(const key of ['frames','selected','preserved','decomposed','lighting','pattern','temporal','fallback','globalInverseFrames'])combined[key]=(primary[key]??0)+(support[key]??0);
 for(const [name,key] of [['preserved','preserved'],['decomposed','decomposed'],['lighting','lighting'],['pattern','pattern'],['temporal','temporal'],['fallback','fallback']])combined[name+'Coverage']=combined.selected?Math.round(combined[key]/combined.selected*1000)/10:0;
 return combined;
}
