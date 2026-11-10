// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Original multi-frame color-line calibration. No clean reference or logo asset.
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
    const r=this.r,n=r.w*r.h,raw=new Float32Array(n);
    for(let i=0;i<n;i++){
      const values=candidates.filter(p=>p.valid[i]).map(p=>({a:p.alpha[i],weight:p.weight})).sort((a,b)=>a.a-b.a);
      if(values.length<Math.max(4,Math.ceil(candidates.length*.3)))continue;
      const total=values.reduce((sum,v)=>sum+v.weight,0);let sum=0,median=0;
      for(const v of values){sum+=v.weight;if(sum>=total*.5){median=v.a;break;}}
      const deviations=values.map(v=>({a:Math.abs(v.a-median),weight:v.weight})).sort((a,b)=>a.a-b.a);sum=0;let mad=0;
      for(const v of deviations){sum+=v.weight;if(sum>=total*.5){mad=v.a;break;}}
      if(median>.015&&median<.7&&mad<.06)raw[i]=median;
    }
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
    return new CalibratedOverlay(r,this.level,alpha,core,band,{sampledFrames:this.sampled,acceptedFrames:candidates.length,corePixels,bandPixels,peakAlpha:peak});
  }
}
export class CalibratedOverlay{
  constructor(r,level,alpha,core,band,info){Object.assign(this,{r,level,alpha,core,band,info});}
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
    if(!this.evidence(data,w,h,r))return null;
    const n=r.w*r.h;let current=new Float32Array(n*3),next=new Float32Array(n*3);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4;
      for(let c=0;c<3;c++)current[i*3+c]=clamp((data[j+c]-this.alpha[i]*this.level)/(1-this.alpha[i]),0,255);
    }
    next.set(current);
    for(let it=0;it<120;it++){
      let delta=0;
      for(let y=1;y<r.h-1;y++)for(let x=1;x<r.w-1;x++){
        const i=y*r.w+x;if(!this.band[i])continue;
        for(let c=0;c<3;c++){const j=i*3+c,v=(current[j-3]+current[j+3]+current[j-r.w*3]+current[j+r.w*3])*.25;next[j]=v;delta=Math.max(delta,Math.abs(v-current[j]));}
      }[current,next]=[next,current];if(delta<.01)break;
    }
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x;if(!this.band[i]&&!this.core[i])continue;const j=((r.y+y)*w+r.x+x)*4;for(let c=0;c<3;c++)data[j+c]=current[i*3+c];
    }
    return {core:this.info.corePixels,band:this.info.bandPixels};
  }
}
