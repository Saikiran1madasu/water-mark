// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Original multi-frame color-line calibration. No clean reference or logo asset.
import {matchSmoothTone} from './tone.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function principal(samples){
  const mean=[0,0,0];for(const p of samples)for(let c=0;c<3;c++)mean[c]+=p[c]/samples.length;
  const cov=Array.from({length:3},()=>[0,0,0]);
  for(const p of samples)for(let i=0;i<3;i++)for(let j=0;j<3;j++)cov[i][j]+=(p[i]-mean[i])*(p[j]-mean[j])/Math.max(1,samples.length-1);
  let axis=cov.map((r,i)=>r[i]).indexOf(Math.max(cov[0][0],cov[1][1],cov[2][2])),v=[0,0,0];v[axis]=1;
  for(let n=0;n<24;n++){const next=cov.map(row=>dot(row,v)),norm=Math.sqrt(dot(next,next));if(norm<1e-8)return null;v=next.map(x=>x/norm);}
  return {mean,v,variance:dot(v,cov.map(row=>dot(row,v))),total:cov[0][0]+cov[1][1]+cov[2][2]};
}
export function fitColorLine(data,w,h,r,level=255){
  const samples=[];let index=0;
  for(let y=Math.max(0,r.y-16);y<Math.min(h,r.y+r.h+16);y++)for(let x=Math.max(0,r.x-16);x<Math.min(w,r.x+r.w+16);x++){
    if(x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h)continue;
    if(index++%3)continue;const j=(y*w+x)*4;samples.push([data[j],data[j+1],data[j+2]]);
  }
  if(samples.length<80)return null;
  let active=samples,line,errors;
  for(let n=0;n<3;n++){
    line=principal(active);if(!line)return null;
    errors=samples.map(p=>{const d=p.map((v,c)=>v-line.mean[c]),along=dot(d,line.v);return Math.sqrt(Math.max(0,dot(d,d)-along*along));});
    const threshold=[...errors].sort((a,b)=>a-b)[Math.floor(errors.length*.85)];active=samples.filter((_,i)=>errors[i]<=threshold);
  }
  const d=line.mean.map(v=>level-v),along=dot(d,line.v),orth=d.map((v,c)=>v-along*line.v[c]);
  return {...line,orth,condition:Math.sqrt(dot(orth,orth)),error:Math.sqrt(errors.reduce((sum,e)=>sum+e*e,0)/(errors.length*3))};
}
function blur(data,w,h,channels=1,radius=1){
  const horizontal=new Float32Array(data.length),result=new Float32Array(data.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++){
    let sum=0,count=0;for(let xx=Math.max(0,x-radius);xx<=Math.min(w-1,x+radius);xx++){sum+=data[(y*w+xx)*channels+c];count++;}horizontal[(y*w+x)*channels+c]=sum/count;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++){
    let sum=0,count=0;for(let yy=Math.max(0,y-radius);yy<=Math.min(h-1,y+radius);yy++){sum+=horizontal[(yy*w+x)*channels+c];count++;}result[(y*w+x)*channels+c]=sum/count;
  }
  return result;
}
function morphology(mask,w,h,radius,dilate){
  const out=new Uint8Array(mask.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let value=dilate?0:1;
    for(let yy=y-radius;yy<=y+radius;yy++)for(let xx=x-radius;xx<=x+radius;xx++){
      const v=xx>=0&&xx<w&&yy>=0&&yy<h?mask[yy*w+xx]:0;
      value=dilate?Math.max(value,v):Math.min(value,v);
    }out[y*w+x]=value;
  }return out;
}
function repairBand(image,w,h,band){
  // Estimate background directions from known pixels on BOTH sides of the band.
  // Watermark-edge pixels are excluded from the structure tensor.
  const tensor=new Float32Array(w*h*4),luma=i=>(image[i*3]+2*image[i*3+1]+image[i*3+2])/4;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;let clean=true;
    for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)if(band[yy*w+xx])clean=false;
    if(!clean)continue;const gx=(luma(i+1)-luma(i-1))*.5,gy=(luma(i+w)-luma(i-w))*.5;
    tensor[i*4]=gx*gx;tensor[i*4+1]=gy*gy;tensor[i*4+2]=gx*gy;tensor[i*4+3]=1;
  }
  const structure=blur(tensor,w,h,4,7),directions=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]],indices=[];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(band[y*w+x])indices.push(y*w+x);
  const weights=new Float32Array(indices.length*8),neighbors=new Int32Array(weights.length),denominator=new Float32Array(indices.length);
  for(let k=0;k<indices.length;k++){
    const i=indices[k],valid=Math.max(.0001,structure[i*4+3]),tx=structure[i*4]/valid,ty=structure[i*4+1]/valid,cross=structure[i*4+2]/valid,total=tx+ty;
    const angle=.5*Math.atan2(2*cross,tx-ty),vx=-Math.sin(angle),vy=Math.cos(angle),coherence=Math.min(1,Math.hypot(tx-ty,2*cross)/(total+1e-6))*clamp((total-.5)/3,0,1);
    for(let d=0;d<8;d++){
      const [dx,dy]=directions[d],length=dx*dx+dy*dy,along=(vx*dx+vy*dy)/Math.sqrt(length),weight=((1-coherence)+coherence*(.02+along**8))/length;
      weights[k*8+d]=weight;neighbors[k*8+d]=i+dx+dy*w;denominator[k]+=weight;
    }
  }
  let current=image,next=image.slice();
  for(let iteration=0;iteration<180;iteration++){
    let change=0;
    for(let k=0;k<indices.length;k++)for(let c=0;c<3;c++){
      let sum=0;for(let d=0;d<8;d++)sum+=weights[k*8+d]*current[neighbors[k*8+d]*3+c];
      const i=indices[k]*3+c,value=sum/denominator[k];next[i]=value;change=Math.max(change,Math.abs(value-current[i]));
    }[current,next]=[next,current];if(change<.01)break;
  }
  return current;
}
export class OverlayCalibrator{
  constructor(r,level=255){this.r={...r};this.level=level;this.candidates=[];this.sampled=0;}
  observe(data,w,h,time){
    this.sampled++;
    const r=this.r,line=fitColorLine(data,w,h,r,this.level);
    if(!line||line.condition<18||line.error>2.2||line.variance<16||line.variance/Math.max(1,line.total)<.9)return false;
    const alpha=new Float32Array(r.w*r.h),valid=new Uint8Array(alpha.length),denom=dot(line.orth,line.orth);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4,d=[0,1,2].map(c=>data[j+c]-line.mean[c]);
      const a=dot(d,line.orth)/denom,along=dot(d,line.v);let residual=0;
      for(let c=0;c<3;c++)residual+=(d[c]-along*line.v[c]-a*line.orth[c])**2;
      alpha[i]=a;valid[i]=Math.sqrt(residual/3)<3.5;
    }
    this.candidates.push({alpha,valid,mean:line.mean,time,weight:Math.min(line.condition,100)**2/(1+line.error**2)});return true;
  }
  finalize(){
    const candidates=this.candidates;this.candidates=[];
    if(candidates.length<4)return null;
    let diversity=0;for(const a of candidates)for(const b of candidates)diversity=Math.max(diversity,Math.hypot(...a.mean.map((v,c)=>v-b.mean[c])));
    if(diversity<12)return null;
    const r=this.r,n=r.w*r.h,raw=new Float32Array(n);let opaquePixels=0;
    for(let i=0;i<n;i++){
      const values=candidates.filter(p=>p.valid[i]).map(p=>({a:p.alpha[i],weight:p.weight})).sort((a,b)=>a.a-b.a);
      if(values.length<Math.max(4,Math.ceil(candidates.length*.3)))continue;
      const total=values.reduce((sum,v)=>sum+v.weight,0);let sum=0,median=0;
      for(const v of values){sum+=v.weight;if(sum>=total*.5){median=v.a;break;}}
      const deviations=values.map(v=>({a:Math.abs(v.a-median),weight:v.weight})).sort((a,b)=>a.a-b.a);sum=0;let mad=0;
      for(const v of deviations){sum+=v.weight;if(sum>=total*.5){mad=v.a;break;}}
      if(median>.72&&mad<.06)opaquePixels++;
      if(median>.015&&median<.7&&mad<.06)raw[i]=median;
    }
    // A translucent antialiased outline cannot stand in for an opaque interior.
    if(opaquePixels>=Math.max(12,n*.002))return null;
    // Edge-preserving smoothing of the CALIBRATION map, never the video texture.
    const alpha=new Float32Array(n);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x;let sum=0,weight=0;
      for(let yy=Math.max(0,y-2);yy<=Math.min(r.h-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(r.w-1,x+2);xx++){
        const j=yy*r.w+xx,k=Math.exp(-((x-xx)**2+(y-yy)**2)/2-(raw[i]-raw[j])**2/(2*.025**2));sum+=raw[j]*k;weight+=k;
      }alpha[i]=sum/weight;
    }
    const seen=new Uint8Array(n),components=[];
    for(let start=0;start<n;start++)if(!seen[start]&&alpha[start]>.04){
      const queue=[start];seen[start]=1;
      for(let k=0;k<queue.length;k++){const i=queue[k],x=i%r.w,y=Math.floor(i/r.w);for(let yy=Math.max(0,y-1);yy<=Math.min(r.h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(r.w-1,x+1);xx++){const j=yy*r.w+xx;if(!seen[j]&&alpha[j]>.04){seen[j]=1;queue.push(j);}}}components.push(queue);
    }
    const largest=Math.max(0,...components.map(c=>c.length)),keep=new Uint8Array(n);
    for(const component of components)if(component.length>=Math.max(12,largest*.08))for(const i of component)keep[i]=1;
    const allowed=morphology(keep,r.w,r.h,1,true);
    for(let i=0;i<n;i++)if(!allowed[i]||alpha[i]<.025)alpha[i]=0;
    const values=[...alpha].filter(a=>a>.05).sort((a,b)=>a-b);if(values.length<40||values.length>n*.7)return null;
    const peak=values[Math.floor(values.length*.9)];
    if(peak>.65||peak<.06)return null;
    const support=morphology(Uint8Array.from(alpha,a=>a>.02),r.w,r.h,2,true),core=morphology(Uint8Array.from(alpha,a=>a>peak*.77),r.w,r.h,2,false);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if((x<2||y<2||x>=r.w-2||y>=r.h-2)&&support[y*r.w+x])return null;
    const corePixels=core.reduce((sum,v)=>sum+v,0),band=Uint8Array.from(support,(v,i)=>v&&!core[i]),bandPixels=band.reduce((sum,v)=>sum+v,0);
    if(corePixels<30||bandPixels+corePixels>n*.8)return null;
    // Compression noise in the estimated matte otherwise becomes fixed texture
    // in every recovered frame. Denoise only flat, well-inside matte regions.
    const denoised=alpha.slice();
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(core[y*r.w+x]){
      const values=[];
      for(let yy=Math.max(0,y-3);yy<=Math.min(r.h-1,y+3);yy++)for(let xx=Math.max(0,x-3);xx<=Math.min(r.w-1,x+3);xx++)if(core[yy*r.w+xx])values.push(alpha[yy*r.w+xx]);
      values.sort((a,b)=>a-b);const median=values[Math.floor(values.length/2)],deviations=values.map(v=>Math.abs(v-median)).sort((a,b)=>a-b);
      if(values.length>=12&&deviations[Math.floor(deviations.length/2)]<.018)denoised[y*r.w+x]=alpha[y*r.w+x]*.2+median*.8;
    }
    alpha.set(denoised);
    return new CalibratedOverlay(r,this.level,alpha,core,band,{sampledFrames:this.sampled,acceptedFrames:candidates.length,corePixels,bandPixels,peakAlpha:peak,boundaryMethod:'structure-guided'});
  }
}
export function paddedOverlayRect(r,w,h,padding=10){
  const x=Math.max(0,r.x-padding),y=Math.max(0,r.y-padding);
  return {x,y,w:Math.min(w,r.x+r.w+padding)-x,h:Math.min(h,r.y+r.h+padding)-y};
}
export class SelectionOverlayCalibrator{
  constructor(r,w,h){this.requested={...r};this.primary=new OverlayCalibrator(r);this.padded=new OverlayCalibrator(paddedOverlayRect(r,w,h));}
  get candidates(){return this.primary.candidates;}
  get sampled(){return this.primary.sampled;}
  observe(data,w,h,time){this.primary.observe(data,w,h,time);this.padded.observe(data,w,h,time);}
  finalize(){
    const primary=this.primary.finalize();
    if(primary){this.padded.candidates=[];return primary;}
    const model=this.padded.finalize();if(model)model.requestedRect=this.requested;return model;
  }
}
export class CalibratedOverlay{
  constructor(r,level,alpha,core,band,info){Object.assign(this,{r,level,alpha,core,band,info});}
  resetFrameState(){this.opacityGain=undefined;}
  frameGain(data,w,h,r){
    const line=fitColorLine(data,w,h,r,this.level);
    if(!line||line.condition<18||line.error>2.2||line.variance<16||line.variance/Math.max(1,line.total)<.9)return 1;
    const ratios=[],denominator=dot(line.orth,line.orth);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x;if(!this.core[i])continue;
      const j=((r.y+y)*w+r.x+x)*4,d=[0,1,2].map(c=>data[j+c]-line.mean[c]),a=dot(d,line.orth)/denominator,along=dot(d,line.v);
      const residual=Math.sqrt(d.reduce((sum,v,c)=>sum+(v-along*line.v[c]-a*line.orth[c])**2,0)/3);
      if(residual<3.5)ratios.push(a/this.alpha[i]);
    }
    if(ratios.length<Math.max(30,this.info.corePixels*.8))return 1;
    ratios.sort((a,b)=>a-b);const gain=ratios[Math.floor(ratios.length/2)];
    const deviations=ratios.map(v=>Math.abs(v-gain)).sort((a,b)=>a-b);
    const tolerance=Math.min(.15,.07+2*line.error/(line.condition*this.info.peakAlpha));
    if(deviations[Math.floor(deviations.length/2)]>tolerance||gain<.8||gain>1.2)return 1;
    return Math.abs(gain-1)<.015?1:clamp(gain,.88,1.12);
  }
  evidence(data,w,h,r){
    if(['x','y','w','h'].some(k=>r[k]!==this.r[k]))return false;
    const line=fitColorLine(data,w,h,r,this.level);
    if(line&&line.condition>=18&&line.error<=3.5){
      const ratios=[];
      for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
        const i=y*r.w+x;if(!this.core[i])continue;const j=((r.y+y)*w+r.x+x)*4,d=[0,1,2].map(c=>data[j+c]-line.mean[c]);ratios.push(dot(d,line.orth)/(dot(line.orth,line.orth)*this.alpha[i]));
      }
      ratios.sort((a,b)=>a-b);const gain=ratios[Math.floor(ratios.length/2)];return gain>=.65&&gain<=1.35;
    }
    const observed=new Float32Array(r.w*r.h*3),expected=new Float32Array(observed.length),mean=line?.mean??[128,128,128];
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4;for(let c=0;c<3;c++){observed[i*3+c]=data[j+c];expected[i*3+c]=this.alpha[i]*(this.level-mean[c]);}}
    const a=blur(observed,r.w,r.h,3),b=blur(expected,r.w,r.h,3);let product=0,aa=0,bb=0;
    for(let y=5;y<r.h-5;y++)for(let x=5;x<r.w-5;x++){
      const i=y*r.w+x;if(!this.band[i]&&!this.core[i])continue;
      for(let c=0;c<3;c++){let p=a[i*3+c],q=b[i*3+c];for(const j of [i-5,i+5,i-5*r.w,i+5*r.w]){p-=a[j*3+c]*.25;q-=b[j*3+c]*.25;}product+=p*q;aa+=p*p;bb+=q*q;}
    }
    return aa>50&&bb>50&&product/Math.sqrt(aa*bb)>.22&&product/bb>.25;
  }
  recover(data,w,h,r){
    if(!this.evidence(data,w,h,r)){this.resetFrameState();return null;}
    // Refine only a scalar opacity using visible background chroma. Preserve
    // source texture; never project the image itself onto the fitted color line.
    const measured=this.frameGain(data,w,h,r);
    this.opacityGain=this.opacityGain===undefined?measured:this.opacityGain*.8+measured*.2;
    const gain=this.opacityGain;
    const n=r.w*r.h;let current=new Float32Array(n*3);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4;
      const alpha=this.alpha[i]*gain;
      for(let c=0;c<3;c++)current[i*3+c]=clamp((data[j+c]-alpha*this.level)/(1-alpha),0,255);
    }
    current=repairBand(current,r.w,r.h,this.band);
    const tone=matchSmoothTone(current,r.w,r.h,this.core,this.band);current=tone.image;
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x;if(!this.band[i]&&!this.core[i])continue;const j=((r.y+y)*w+r.x+x)*4;for(let c=0;c<3;c++)data[j+c]=current[i*3+c];
    }
    return {core:this.info.corePixels,band:this.info.bandPixels,tone:tone.pixels};
  }
}
