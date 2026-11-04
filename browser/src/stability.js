// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Reuse validated geometry only. Never carry old reconstructed image pixels.
export function holdFootprint(previous,current,data,w,r,plate){
  if(!previous||previous.rect.w!==r.w||previous.rect.h!==r.h||Math.abs(previous.rect.x-r.x)>4||Math.abs(previous.rect.y-r.y)>4)return {shape:current,held:false};
  const old=previous.shape,area=r.w*r.h;let outsideNew=0,evidence=0,retained=0,square=0,uncovered=false;const errors=[];
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
    const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4;
    if(current&&current.alpha[i]>.95&&old.alpha[i]<.95)outsideNew++;
    let difference=0,sign=0;
    for(let c=0;c<3;c++){const d=data[j+c]-plate[i*4+c];difference+=d*d;sign+=d;}
    if(current&&current.alpha[i]>.95&&old.alpha[i]<.95&&Math.sqrt(difference/3)>6)uncovered=true;
    if(old.alpha[i]>.95&&Math.sqrt(difference/3)>4.5&&((old.level===255&&sign>0)||(old.level===0&&sign<0)))evidence++;
    if(old.alpha[i]===0){const error=Math.sqrt(difference/3);errors.push(error);square+=difference;retained++;}
  }
  if(uncovered||outsideNew>Math.max(6,area*.005)||evidence<Math.max(24,area*.02)||retained<area*.1)return {shape:current,held:false};
  errors.sort((a,b)=>a-b);
  if(Math.sqrt(square/(retained*3))>3.5||errors[Math.floor(errors.length*.9)]>7)return {shape:current,held:false};
  return {shape:old,held:true};
}
export function contextChanged(current,previous,w,h,r){
  if(!previous||previous.length!==current.length)return false;
  const means=[0,0,0],points=[],currentHist=new Uint32Array(48),previousHist=new Uint32Array(48);
  for(let y=Math.max(0,r.y-30);y<Math.min(h,r.y+r.h+30);y+=6)for(let x=Math.max(0,r.x-30);x<Math.min(w,r.x+r.w+30);x+=6){
    if(x>=r.x-3&&x<r.x+r.w+3&&y>=r.y-3&&y<r.y+r.h+3)continue;
    const i=(y*w+x)*4,d=[current[i]-previous[i],current[i+1]-previous[i+1],current[i+2]-previous[i+2]];points.push(d);for(let c=0;c<3;c++){means[c]+=d[c];currentHist[c*16+(current[i+c]>>4)]++;previousHist[c*16+(previous[i+c]>>4)]++;}
  }
  if(points.length<20)return true;
  for(let c=0;c<3;c++)means[c]/=points.length;
  let difference=0;for(const d of points)for(let c=0;c<3;c++)difference+=Math.abs(d[c]-means[c]);
  let histogramDifference=0;for(let i=0;i<48;i++)histogramDifference+=Math.abs(currentHist[i]-previousHist[i]);
  return difference/(points.length*3)>20&&histogramDifference/(points.length*6)>.35;
}
