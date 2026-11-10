// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Original masked bidirectional matching with verified quarter-pixel refinement.
// Browser-native JavaScript;
// references are original decoded frames, never earlier reconstructed frames.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function pixel(data,w,x,y,c){const xx=x|0,yy=y|0,fx=x-xx,fy=y-yy,j=(yy*w+xx)*4;if(!fx&&!fy)return data[j+c];return data[j+c]*(1-fx)*(1-fy)+data[j+4+c]*fx*(1-fy)+data[j+w*4+c]*(1-fx)*fy+data[j+w*4+4+c]*fx*fy;}
const luma=(data,w,x,y)=>{if((x|0)===x&&(y|0)===y){const j=(y*w+x)*4;return (data[j]+2*data[j+1]+data[j+2])/4;}return (pixel(data,w,x,y,0)+2*pixel(data,w,x,y,1)+pixel(data,w,x,y,2))/4;};
function hidden(x,y,r,support,padding=2){
 if(x<r.x-padding||y<r.y-padding||x>=r.x+r.w+padding||y>=r.y+r.h+padding)return false;
 for(let yy=Math.max(r.y,Math.floor(y-padding));yy<=Math.min(r.y+r.h-1,Math.ceil(y+padding));yy++)for(let xx=Math.max(r.x,Math.floor(x-padding));xx<=Math.min(r.x+r.w-1,Math.ceil(x+padding));xx++)if(support[(yy-r.y)*r.w+xx-r.x])return true;
 return false;
}
function samples(data,w,h,r,support){
 const out=[];
 for(let y=Math.max(2,r.y-18);y<Math.min(h-2,r.y+r.h+18);y+=5)for(let x=Math.max(2,r.x-18);x<Math.min(w-2,r.x+r.w+18);x+=5){
  if(hidden(x,y,r,support,3))continue;const j=(y*w+x)*4;
  out.push({x,y,rgb:[data[j],data[j+1],data[j+2]],gx:luma(data,w,x+1,y)-luma(data,w,x-1,y),gy:luma(data,w,x,y+1)-luma(data,w,x,y-1)});
 }return out;
}
function score(points,source,w,h,r,support,dx,dy){
 let n=0,gradient=0,square=0,sumL=0,sumLL=0;const sum=[0,0,0];
 for(const p of points){const x=p.x+dx,y=p.y+dy;if(x<2||y<2||x>=w-2||y>=h-2||hidden(x,y,r,support,3))continue;
  const j=(y*w+x)*4;for(let c=0;c<3;c++){const d=p.rgb[c]-pixel(source,w,x,y,c);sum[c]+=d;square+=d*d;}
  const gx=luma(source,w,x+1,y)-luma(source,w,x-1,y),gy=luma(source,w,x,y+1)-luma(source,w,x,y-1);
  gradient+=(p.gx-gx)**2+(p.gy-gy)**2;const v=(p.rgb[0]+2*p.rgb[1]+p.rgb[2])/4;sumL+=v;sumLL+=v*v;n++;
 }
 if(n<Math.max(40,points.length*.65))return null;
 const offset=sum.map(v=>v/n);if(offset.some(v=>Math.abs(v)>8))return null;
 const error=Math.sqrt(Math.max(0,square/n-offset.reduce((s,v)=>s+v*v,0))/3),edgeError=Math.sqrt(gradient/(2*n)),variance=sumLL/n-(sumL/n)**2;
 if(variance<8)return null;
 return {dx,dy,error,edgeError,offset,score:error+edgeError*.5};
}
export function estimateOriginalMotion(current,previous,w,h,r,support,previousRect,previousSupport,maxShift=40,anchor=null){
 const around=(points,center)=>center?points.filter(p=>Math.abs(p.x-center.x)<=36&&Math.abs(p.y-center.y)<=36):points;
 const points=around(samples(current,w,h,r,support),anchor);if(points.length<60)return null;
 const coarse=[];
 for(let dy=-maxShift;dy<=maxShift;dy+=4)for(let dx=-maxShift;dx<=maxShift;dx+=4){const candidate=score(points,previous,w,h,previousRect,previousSupport,dx,dy);if(candidate)coarse.push(candidate);}
 coarse.sort((a,b)=>a.score-b.score);if(!coarse.length)return null;
 const refined=[],seen=new Set();
 for(const proposal of coarse.slice(0,4))for(let yy=-3;yy<=3;yy++)for(let xx=-3;xx<=3;xx++){
  const dx=proposal.dx+xx,dy=proposal.dy+yy,key=dx+','+dy;if(Math.abs(dx)>maxShift||Math.abs(dy)>maxShift||seen.has(key))continue;seen.add(key);
  const candidate=score(points,previous,w,h,previousRect,previousSupport,dx,dy);if(candidate)refined.push(candidate);
 }
 refined.sort((a,b)=>a.score-b.score);const integer=refined[0];let best=integer;
 if(best){const start=best;for(let yy=-3;yy<=3;yy++)for(let xx=-3;xx<=3;xx++){const dx=start.dx+xx*.25,dy=start.dy+yy*.25;if(Math.abs(dx)>maxShift||Math.abs(dy)>maxShift)continue;const candidate=score(points,previous,w,h,previousRect,previousSupport,dx,dy);if(candidate&&candidate.score<best.score)best=candidate;}}
 function validate(candidate){
  if(!candidate||candidate.error>1.75||candidate.edgeError>1.5)return null;
  const runner=refined.find(p=>Math.hypot(p.dx-candidate.dx,p.dy-candidate.dy)>=4);
  if(!runner||runner.score-candidate.score<.15)return null;
  const reversePoints=around(samples(previous,w,h,previousRect,previousSupport),anchor?{x:anchor.x+candidate.dx,y:anchor.y+candidate.dy}:null);let reverse=null;
  for(let yy=-3;yy<=3;yy++)for(let xx=-3;xx<=3;xx++){
   const proposal=score(reversePoints,current,w,h,r,support,-candidate.dx+xx,-candidate.dy+yy);
   if(proposal&&(!reverse||proposal.score<reverse.score))reverse=proposal;
  }
  if(!reverse||reverse.error>1.75||Math.hypot(reverse.dx+candidate.dx,reverse.dy+candidate.dy)>1)return null;
  return {...candidate,anchor,cycleError:Math.hypot(reverse.dx+candidate.dx,reverse.dy+candidate.dy)};
 }
 const alternative=validate(integer),fine=best===integer?alternative:validate(best);
 return fine?{...fine,integerAlternative:alternative&&(fine.dx!==alternative.dx||fine.dy!==alternative.dy)?alternative:null}:alternative;

}
function locallySupported(original,source,w,h,r,support,previousRect,previousSupport,x,y,motion){
 let count=0,error=0;const quadrants=new Set();
 for(let yy=y-20;yy<=y+20;yy+=4)for(let xx=x-20;xx<=x+20;xx+=4){
  const sx=xx+motion.dx,sy=yy+motion.dy;
  if(xx<1||yy<1||xx>=w-1||yy>=h-1||sx<1||sy<1||sx>=w-1||sy>=h-1||hidden(xx,yy,r,support,2)||hidden(sx,sy,previousRect,previousSupport,2))continue;
  const a=(yy*w+xx)*4,b=(sy*w+sx)*4;for(let c=0;c<3;c++)error+=(original[a+c]-pixel(source,w,sx,sy,c)-motion.offset[c])**2;
  quadrants.add((xx>=x?1:0)+(yy>=y?2:0));count++;
 }
 return count>=12&&quadrants.size>=3&&Math.sqrt(error/(count*3))<1.5;
}
export function recoverOriginalMotion({original,repaired,w,h,r,support,opacity,history,maxShift=80,fractionalOnly=false,preserveMask=null}){
 if(original.length!==w*h*4||repaired.length!==original.length||support.length!==r.w*r.h||opacity.length!==support.length||(preserveMask&&preserveMask.length!==support.length))throw Error('Invalid original-frame motion buffers.');
 const candidates=[],mask=new Uint8Array(support.length),fractionalMask=new Uint8Array(support.length),proposal=new Float32Array(support.length*3);
 for(const source of history.filter((_,i)=>i===0||i===2||i===6)){
  if(source.data.length!==original.length||!source.overlaySupport)continue;
  const reach=Math.min(maxShift,32+(source.age??1)*6),motion=estimateOriginalMotion(original,source.data,w,h,r,support,source.mask,source.overlaySupport,reach);
  if(motion){candidates.push({...motion,source});if(motion.integerAlternative)candidates.push({...motion.integerAlternative,source});}
  if(!motion||((!Number.isInteger(motion.dx)||!Number.isInteger(motion.dy))&&!motion.integerAlternative))for(const fraction of [.25,.75]){
   const anchor={x:r.x+r.w*fraction,y:r.y+r.h*.5};
   const local=estimateOriginalMotion(original,source.data,w,h,r,support,source.mask,source.overlaySupport,reach,anchor);
   if(local){candidates.push({...local,source});if(local.integerAlternative)candidates.push({...local.integerAlternative,source});}
  }
 }
 candidates.sort((a,b)=>a.score-b.score);
 for(const motion of candidates)for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
  const i=y*r.w+x;if(!support[i]||mask[i]||preserveMask?.[i]||(fractionalOnly&&Number.isInteger(motion.dx)&&Number.isInteger(motion.dy)))continue;const xx=r.x+x,yy=r.y+y,sx=xx+motion.dx,sy=yy+motion.dy;
  if(motion.anchor&&(Math.abs(xx-motion.anchor.x)>24||Math.abs(yy-motion.anchor.y)>24))continue;
  if(sx<1||sy<1||sx>=w-1||sy>=h-1||hidden(sx,sy,motion.source.mask,motion.source.overlaySupport,2))continue;
  if(!locallySupported(original,motion.source.data,w,h,r,support,motion.source.mask,motion.source.overlaySupport,xx,yy,motion))continue;
  const j=(yy*w+xx)*4,k=(sy*w+sx)*4,a=opacity[i];let error=0,baselineError=0,difference=0;
  for(let c=0;c<3;c++){const v=clamp(pixel(motion.source.data,w,sx,sy,c)+motion.offset[c],0,255);proposal[i*3+c]=v;error+=(original[j+c]-((1-a)*v+255*a))**2;difference=Math.max(difference,Math.abs(v-repaired[j+c]));baselineError+=(original[j+c]-((1-a)*repaired[j+c]+255*a))**2;}
// Fine alignment must materially improve current-frame compositing evidence.
  // Keep the independently validated integer alternative when that fails.
  const fractional=!Number.isInteger(motion.dx)||!Number.isInteger(motion.dy);
  if(fractional&&(Math.sqrt(baselineError/3)-Math.sqrt(error/3)<.5||error>baselineError*.64))continue;
  if(Math.sqrt(error/3)<=3&&difference<=8){mask[i]=1;fractionalMask[i]=fractional?1:0;}
 }
 // Isolated correspondences cannot create a flickering salt-and-pepper repair.
 const accepted=new Uint8Array(mask.length);let pixels=0,subpixelPixels=0;
 for(let y=1;y<r.h-1;y++)for(let x=1;x<r.w-1;x++){const i=y*r.w+x;if(!mask[i])continue;let neighbors=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)neighbors+=mask[i+dy*r.w+dx];if(neighbors<7)continue;
  const weight=neighbors/9,j=((r.y+y)*w+r.x+x)*4;for(let c=0;c<3;c++)repaired[j+c]=repaired[j+c]*(1-weight)+proposal[i*3+c]*weight;accepted[i]=1;pixels++;subpixelPixels+=fractionalMask[i];
 }
 return {pixels,subpixelPixels,mask:accepted,motions:candidates.map(({dx,dy,error,cycleError})=>({dx,dy,error,cycleError}))};
}
