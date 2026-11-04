// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Original browser repair: coherent pattern donors, illumination, clean history,
// conservative logo footprints and boundary-constrained fallback. No model weights.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const expanded=(r,n=2)=>({x:r.x-n,y:r.y-n,w:r.w+2*n,h:r.h+2*n});
const inside=(x,y,r)=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h;
const at=(w,x,y)=>(y*w+x)*4;
const lum=(a,i)=>(a[i]+2*a[i+1]+a[i+2])/4;
export function boxAt(time,box,keys=[]){
  if(!keys.length)return box;
  if(time<=keys[0].time)return keys[0].box;
  for(let i=1;i<keys.length;i++){const a=keys[i-1],b=keys[i];if(time<=b.time){const f=(time-a.time)/(b.time-a.time);return Object.fromEntries(['x','y','w','h'].map(k=>[k,a.box[k]+(b.box[k]-a.box[k])*f]));}}
  return keys.at(-1).box;
}
export function selection(w,h,box,margin=3){
  if(!box||!['x','y','w','h'].every(k=>Number.isFinite(box[k]))||box.x<0||box.y<0||box.w<=0||box.h<=0||box.x+box.w>1.00001||box.y+box.h>1.00001)throw Error('Draw a selection inside the video.');
  const x=clamp(Math.round(box.x*w)-margin,0,w-1),y=clamp(Math.round(box.y*h)-margin,0,h-1);
  const right=clamp(Math.round((box.x+box.w)*w)+margin,0,w),bottom=clamp(Math.round((box.y+box.h)*h)+margin,0,h);
  const r={x,y,w:right-x,h:bottom-y};
  if(r.w<4||r.h<4||r.w*r.h>w*h*.25||r.w*r.h>90000)throw Error('Select a smaller watermark (at most one quarter of the frame and 90,000 pixels).');
  return r;
}
function solve(a,b){
  const n=b.length,m=a.map((row,i)=>[...row,...b[i]]),channels=b[0].length;
  for(let j=0;j<n;j++){
    let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(m[i][j])>Math.abs(m[pivot][j]))pivot=i;
    [m[j],m[pivot]]=[m[pivot],m[j]];
    if(Math.abs(m[j][j])<1e-8)return null;
    const div=m[j][j];for(let k=j;k<n+channels;k++)m[j][k]/=div;
    for(let i=0;i<n;i++)if(i!==j){const f=m[i][j];for(let k=j;k<n+channels;k++)m[i][k]-=f*m[j][k];}
  }
  return m.map(row=>row.slice(n));
}
function fit(samples,values,n){
  const a=Array.from({length:n},()=>Array(n).fill(0)),b=Array.from({length:n},()=>[0,0,0]);
  for(let i=0;i<samples.length;i++){const p=samples[i].basis;for(let j=0;j<n;j++){for(let k=0;k<n;k++)a[j][k]+=p[j]*p[k];for(let c=0;c<3;c++)b[j][c]+=p[j]*values[i][c];}}
  return solve(a,b);
}
function predict(coeff,basis,c){let v=0;for(let j=0;j<coeff.length;j++)v+=coeff[j][c]*basis[j];return v;}
function points(data,w,h,r,pad=24,step=6){
  const list=[];
  for(let y=Math.max(3,r.y-pad);y<Math.min(h-3,r.y+r.h+pad);y+=step)for(let x=Math.max(3,r.x-pad);x<Math.min(w-3,r.x+r.w+pad);x+=step){
    if(inside(x,y,{x:r.x-2,y:r.y-2,w:r.w+4,h:r.h+4}))continue;
    const px=(x-r.x-r.w/2)/Math.max(24,r.w),py=(y-r.y-r.h/2)/Math.max(24,r.h),i=at(w,x,y);
    list.push({x,y,i,basis:[1,px,py,px*py,px*px,py*py],gx:lum(data,at(w,x+2,y))-lum(data,at(w,x-2,y)),gy:lum(data,at(w,x,y+2))-lum(data,at(w,x,y-2))});
  }
  return list;
}
function coarse(data,source,w,h,r,sourceMask,samples,dx,dy,whole){
  const shifted={x:r.x+dx,y:r.y+dy,w:r.w,h:r.h};
  if(shifted.x<0||shifted.y<0||shifted.x+shifted.w>w||shifted.y+shifted.h>h||(whole&&overlap(shifted,sourceMask)))return Infinity;
  let error=0,count=0,mean=0,square=0,tt=0,ss=0,dot=0,st=0,sv=0;
  for(let k=0;k<samples.length;k+=2){const p=samples[k],x=p.x+dx,y=p.y+dy;if(x<3||y<3||x>=w-3||y>=h-3||inside(x,y,expanded(sourceMask)))continue;
    const gx=lum(source,at(w,x+2,y))-lum(source,at(w,x-2,y)),gy=lum(source,at(w,x,y+2))-lum(source,at(w,x,y-2));
    error+=Math.abs(gx-p.gx)+Math.abs(gy-p.gy);tt+=p.gx*p.gx+p.gy*p.gy;ss+=gx*gx+gy*gy;dot+=p.gx*gx+p.gy*gy;st+=p.gx+p.gy;sv+=gx+gy;const diff=lum(data,p.i)-lum(source,at(w,x,y));mean+=diff;square+=diff*diff;count++;
  }
  if(count<Math.min(20,samples.length*.3))return Infinity;
  const correlation=(dot-st*sv/(count*2))/Math.sqrt(Math.max(1e-8,(tt-st*st/(count*2))*(ss-sv*sv/(count*2))));
  return whole?(1-correlation)*10+Math.sqrt(Math.max(0,square/count-(mean/count)**2))*.05:error/count+Math.sqrt(Math.max(0,square/count-(mean/count)**2))*.15;
}
function assess(data,source,w,h,r,sourceMask,samples,dx,dy,robust=false){
  const valid=[],values=[];
  for(const p of samples){const x=p.x+dx,y=p.y+dy;if(x<0||y<0||x>=w||y>=h||inside(x,y,expanded(sourceMask)))continue;const j=at(w,x,y);valid.push(p);values.push([data[p.i]-source[j],data[p.i+1]-source[j+1],data[p.i+2]-source[j+2]]);}
  if(valid.length<Math.min(35,samples.length*.65))return null;
  let coeff=fit(valid,values,3);if(!coeff)return null;
  // Codec ringing and small foreground occlusions should not decide motion.
  let chosen=valid.map((_,i)=>i);
  for(let pass=0;pass<(robust?2:0);pass++){
    const residual=valid.map((p,i)=>Math.sqrt(values[i].reduce((sum,v,c)=>sum+(v-predict(coeff,p.basis,c))**2,0)/3));
    const threshold=[...residual].sort((a,b)=>a-b)[Math.floor(residual.length*.85)];
    chosen=chosen.filter(i=>residual[i]<=Math.max(2.5,threshold));
    if(chosen.length<valid.length*.7)return null;
    coeff=fit(chosen.map(i=>valid[i]),chosen.map(i=>values[i]),3);if(!coeff)return null;
  }
  let square=0,maxTone=0;
  for(const i of chosen)for(let c=0;c<3;c++){const correction=predict(coeff,valid[i].basis,c);maxTone=Math.max(maxTone,Math.abs(correction));square+=(values[i][c]-correction)**2;}
  if(maxTone>36)return null;
  return {dx,dy,coeff,error:Math.sqrt(square/(chosen.length*3)),source};
}
function match(data,source,w,h,r,sourceMask,samples,reach,whole,hint){
  const shortlist=[];
  const consider=(dx,dy)=>{const score=coarse(data,source,w,h,r,sourceMask,samples,dx,dy,whole);if(!Number.isFinite(score))return;
    if(whole){const existing=shortlist.findIndex(p=>Math.hypot(p.dx-dx,p.dy-dy)<12);if(existing>=0){if(shortlist[existing].score<=score)return;shortlist.splice(existing,1);}}
    shortlist.push({dx,dy,score});shortlist.sort((a,b)=>a.score-b.score);if(shortlist.length>8)shortlist.pop();};
  const step=whole?8:4;
  for(let dy=-reach;dy<=reach;dy+=step)for(let dx=-reach;dx<=reach;dx+=step)consider(dx,dy);
  if(!whole)for(let offset=-reach;offset<=reach;offset++){consider(offset,0);consider(0,offset);}
  if(hint)consider(Math.round(hint.dx),Math.round(hint.dy));
  let best=null;const tested=new Set();
  for(const proposal of shortlist.slice(0,whole?6:4))for(let y=-step+1;y<step;y++)for(let x=-step+1;x<step;x++){
    const dx=proposal.dx+x,dy=proposal.dy+y,key=dx+','+dy;if(tested.has(key))continue;tested.add(key);
    const quick=coarse(data,source,w,h,r,sourceMask,samples,dx,dy,whole);if(!Number.isFinite(quick)||quick>proposal.score+2||(whole&&quick>3))continue;
    const candidate=assess(data,source,w,h,r,sourceMask,samples,dx,dy,!whole);if(!candidate)continue;
    let coverage=1;
    if(!whole){const ax=Math.max(r.x+dx,sourceMask.x),ay=Math.max(r.y+dy,sourceMask.y),bx=Math.min(r.x+dx+r.w,sourceMask.x+sourceMask.w),by=Math.min(r.y+dy+r.h,sourceMask.y+sourceMask.h);coverage=1-Math.max(0,bx-ax)*Math.max(0,by-ay)/(r.w*r.h);}
    const continuity=whole&&hint?Math.min(1,Math.hypot(dx-hint.dx,dy-hint.dy)/24)*.1:0;
    candidate.score=candidate.error+(whole?continuity+quick*.3:3*(1-coverage));candidate.coverage=coverage;
    if(!best||candidate.score<best.score)best=candidate;
  }
  return best;
}
function tile(data,w,h,r,donor){
  const plate=new Uint8ClampedArray(r.w*r.h*4);
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
    const basis=[1,(x-r.w/2)/Math.max(24,r.w),(y-r.h/2)/Math.max(24,r.h)],i=(y*r.w+x)*4,j=at(w,r.x+x+donor.dx,r.y+y+donor.dy);
    for(let c=0;c<3;c++)plate[i+c]=donor.source[j+c]+predict(donor.coeff,basis,c);plate[i+3]=255;
  }
  return plate;
}
function smooth(data,w,r,samples){
  if(samples.length<40)return null;
  let fine=0;for(const p of samples)fine+=Math.abs(p.gx)+Math.abs(p.gy);if(fine/samples.length>2.8)return null;
  const train=samples.filter((_,i)=>i%5),test=samples.filter((_,i)=>i%5===0);
  const values=train.map(p=>[data[p.i],data[p.i+1],data[p.i+2]]),coeff=fit(train,values,6);if(!coeff)return null;
  let error=0;for(const p of test)for(let c=0;c<3;c++)error+=(data[p.i+c]-predict(coeff,p.basis,c))**2;
  if(Math.sqrt(error/(test.length*3))>3.5)return null;
  const plate=new Uint8ClampedArray(r.w*r.h*4);
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const px=(x-r.w/2)/Math.max(24,r.w),py=(y-r.h/2)/Math.max(24,r.h),basis=[1,px,py,px*py,px*px,py*py],i=(y*r.w+x)*4;for(let c=0;c<3;c++)plate[i+c]=predict(coeff,basis,c);plate[i+3]=255;}
  return plate;
}
function harmonic(data,w,h,r,known=null,plate=null,iterations=75){
  const pw=r.w+2,ph=r.h+2,size=pw*ph;let current=new Float32Array(size*3),next=new Float32Array(size*3);const fixed=new Uint8Array(size);
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
    const i=y*pw+x,xx=clamp(r.x+x-1,0,w-1),yy=clamp(r.y+y-1,0,h-1),outside=x===0||y===0||x===pw-1||y===ph-1,inner=(y-1)*r.w+x-1;
    fixed[i]=outside||(known&&known[inner]);
    for(let c=0;c<3;c++){
      if(outside)current[i*3+c]=data[at(w,xx,yy)+c];
      else if(known&&known[inner])current[i*3+c]=plate[inner*4+c];
      else {const fx=x/(pw-1),fy=y/(ph-1);current[i*3+c]=.5*((1-fx)*data[at(w,clamp(r.x-1,0,w-1),yy)+c]+fx*data[at(w,clamp(r.x+r.w,0,w-1),yy)+c]+(1-fy)*data[at(w,xx,clamp(r.y-1,0,h-1))+c]+fy*data[at(w,xx,clamp(r.y+r.h,0,h-1))+c]);}
    }
  }
  next.set(current);
  for(let it=0;it<iterations;it++){
    for(let y=1;y<ph-1;y++)for(let x=1;x<pw-1;x++){const i=y*pw+x;if(fixed[i])continue;for(let c=0;c<3;c++)next[i*3+c]=(current[(i-1)*3+c]+current[(i+1)*3+c]+current[(i-pw)*3+c]+current[(i+pw)*3+c])*.25;}
    [current,next]=[next,current];
  }
  const out=new Uint8ClampedArray(r.w*r.h*4);
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=(y*r.w+x)*4,j=((y+1)*pw+x+1)*3;for(let c=0;c<3;c++)out[i+c]=current[j+c];out[i+3]=255;}
  return out;
}
export function footprint(data,w,r,plate){
  const area=r.w*r.h,candidates=[];
  for(const level of [255,0]){
    const core=new Uint8Array(area);let supported=0;
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=i*4,k=at(w,r.x+x,r.y+y);let denom=0,dot=0,strength=0;
      for(let c=0;c<3;c++){const d=level-plate[j+c],v=data[k+c]-plate[j+c];denom+=d*d;dot+=v*d;strength+=v*v;}
      const opacity=clamp(dot/Math.max(denom,1),0,1);let error=0;
      for(let c=0;c<3;c++)error+=(data[k+c]-plate[j+c]-opacity*(level-plate[j+c]))**2;
      if(opacity>.035&&strength/3>10&&error/3<9){core[i]=1;supported++;}
    }
    if(supported<Math.max(24,area*.025)||supported>area*.7)continue;
    let touches=false;for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(core[y*r.w+x]&&(x<2||y<2||x>=r.w-2||y>=r.h-2))touches=true;if(touches)continue;
    const alpha=new Float32Array(area);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(core[y*r.w+x])for(let yy=Math.max(0,y-5);yy<=Math.min(r.h-1,y+5);yy++)for(let xx=Math.max(0,x-5);xx<=Math.min(r.w-1,x+5);xx++)alpha[yy*r.w+xx]=Math.max(alpha[yy*r.w+xx],clamp((5.5-Math.hypot(xx-x,yy-y))/2,0,1));
    let modified=0,square=0,retained=0;for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=y*r.w+x;if(alpha[i]>0){modified++;continue;}const j=at(w,r.x+x,r.y+y);for(let c=0;c<3;c++)square+=(data[j+c]-plate[i*4+c])**2;retained++;}
    if(modified>area*.88||!retained||Math.sqrt(square/(retained*3))>4)continue;
    candidates.push({alpha,modified,supported});
  }
  candidates.sort((a,b)=>b.supported-a.supported);
  if(!candidates.length||(candidates.length>1&&candidates[1].supported>candidates[0].supported*.35))return null;
  return candidates[0];
}
export class BrowserRepair {
  constructor(options={}){this.options=options;this.history=[];this.hint=null;this.stats={frames:0,selected:0,preserved:0,temporal:0,pattern:0,lighting:0,fallback:0};}
  process(data,w,h,box){
    const r=selection(w,h,box,this.options.margin??3),samples=points(data,w,h,r,Math.min(36,Math.max(r.w,r.h)),Math.max(4,Math.floor(Math.sqrt(r.w*r.h)/10)));
    let donor=null,plate=null,method='fallback',recovered=0;
    let contrast=0;for(const p of samples)contrast+=Math.abs(p.gx)+Math.abs(p.gy);
    if(this.options.mode!=='balanced'&&contrast/Math.max(1,samples.length)>.5){
      donor=match(data,data,w,h,r,r,points(data,w,h,r,36,3),Math.min(192,Math.max(96,r.w*3,r.h*3)),true,this.hint);
      if(donor&&donor.error<3.2){plate=tile(data,w,h,r,donor);method='pattern';this.hint={dx:donor.dx,dy:donor.dy};}
    }
    if(!plate){this.hint=null;plate=smooth(data,w,r,samples);if(plate)method='lighting';}
    const known=new Uint8Array(r.w*r.h);
    if(!plate){
      plate=new Uint8ClampedArray(r.w*r.h*4);
      const temporal=[];
      for(const source of this.history.filter((_,i)=>i%2===0).slice(0,6)){
        const candidate=match(data,source.data,w,h,r,source.mask,samples,Math.min(48,12+source.age*4),false,null);
        if(candidate&&candidate.error<8&&candidate.coverage>.01)temporal.push({...candidate,mask:source.mask});
      }
      temporal.sort((a,b)=>a.score-b.score);
      for(const source of temporal)for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
        const i=y*r.w+x,xx=r.x+x+source.dx,yy=r.y+y+source.dy;if(known[i]||xx<0||yy<0||xx>=w||yy>=h||inside(xx,yy,expanded(source.mask)))continue;
        const j=at(w,xx,yy),basis=[1,(x-r.w/2)/Math.max(24,r.w),(y-r.h/2)/Math.max(24,r.h)];
        for(let c=0;c<3;c++)plate[i*4+c]=source.source[j+c]+predict(source.coeff,basis,c);plate[i*4+3]=255;known[i]=1;recovered++;
      }
      plate=harmonic(data,w,h,r,known,plate,this.options.mode==='balanced'?45:90);
    }
    const shape=method!=='fallback'?footprint(data,w,r,plate):null;
    let preserved=shape?shape.alpha.reduce((n,a)=>n+(a===0),0):0;
    const original=new Uint8ClampedArray(data);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=at(w,r.x+x,r.y+y),edge=Math.min(x+1,y+1,r.w-x,r.h-y);
      const disagreement=(Math.abs(data[j]-plate[i*4])+Math.abs(data[j+1]-plate[i*4+1])+Math.abs(data[j+2]-plate[i*4+2]))/3;
      const alpha=shape?shape.alpha[i]:disagreement<6?clamp(edge/Math.max(1,(this.options.margin??3)+1),0,1):1;
      for(let c=0;c<3;c++)data[j+c]=data[j+c]*(1-alpha)+plate[i*4+c]*alpha;
    }
    for(const source of this.history)source.age++;
    this.history.unshift({data:original,mask:r,age:1});
    const keep=Math.max(1,Math.min(this.options.radius??6,12,Math.floor(64*1024*1024/(w*h*4))));this.history.length=Math.min(this.history.length,keep);
    const modified=r.w*r.h-preserved;this.stats.frames++;this.stats.selected+=r.w*r.h;this.stats.preserved+=preserved;
    this.stats.temporal+=recovered;this.stats.pattern+=method==='pattern'?modified:0;this.stats.lighting+=method==='lighting'?modified:0;this.stats.fallback+=method==='fallback'?modified-recovered:0;
    return {data,rect:r,method,recovered,preserved};
  }
  report(){const pct=n=>+(100*n/Math.max(1,this.stats.selected)).toFixed(1);return {...this.stats,preservedCoverage:pct(this.stats.preserved),temporalCoverage:pct(this.stats.temporal),patternCoverage:pct(this.stats.pattern),lightingCoverage:pct(this.stats.lighting),fallbackCoverage:pct(this.stats.fallback)};}
  dispose(){this.history=[];}
}
