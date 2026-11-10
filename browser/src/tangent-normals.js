// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Estimate fixed-mark luma directions from multiple original samples.
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]??0;};
export function estimateNormals(frames,w,h,r,model){
 if(![w,h,r.x,r.y,r.w,r.h].every(Number.isInteger)||w<3||h<3||r.x<0||r.y<0||r.x+r.w>w||r.y+r.h>h||model.alpha.length!==r.w*r.h||model.band.length!==model.alpha.length||frames.some(f=>f.length!==w*h*4))throw Error('Invalid source-normal calibration buffers.');
 const n=r.w*r.h,nx=new Float32Array(n),ny=new Float32Array(n),confidence=new Float32Array(n),a=model.alpha,smooth=a.slice();let accepted=0;
 for(let y=1;y<r.h-1;y++)for(let x=1;x<r.w-1;x++){let sum=0;for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)sum+=a[yy*r.w+xx];smooth[y*r.w+x]=sum/9;}
 const Y=(data,x,y)=>{const j=(y*w+x)*4;return .299*data[j]+.587*data[j+1]+.114*data[j+2];};
 for(let y=1;y<r.h-1;y++)for(let x=1;x<r.w-1;x++){const i=y*r.w+x;if(!model.band[i])continue;const gx=(smooth[i+1]-smooth[i-1])*.5,gy=(smooth[i+r.w]-smooth[i-r.w])*.5,length=Math.hypot(gx,gy);if(length<.003)continue;const xx=r.x+x,yy=r.y+y,observations=[];
  for(const f of frames){const white=255-Y(f,xx,yy);if(white<40)continue;const scale=(1-a[i])/white,dx=(Y(f,xx+1,yy)-Y(f,xx-1,yy))*.5*scale,dy=(Y(f,xx,yy+1)-Y(f,xx,yy-1))*.5*scale;observations.push([dx,dy]);}
  if(observations.length<8)continue;const dx=median(observations.map(v=>v[0])),dy=median(observations.map(v=>v[1])),mag=Math.hypot(dx,dy);if(!Number.isFinite(mag)||mag<.008)continue;const ux=dx/mag,uy=dy/mag,agreement=(ux*gx+uy*gy)/length;if(agreement<.7)continue;
  const scatter=median(observations.map(v=>Math.abs(-uy*v[0]+ux*v[1])))/mag;if(scatter>.5)continue;
  nx[i]=ux;ny[i]=uy;confidence[i]=Math.min(1,mag/.03)*Math.max(0,1-scatter);accepted++;
 }
 return {nx,ny,confidence,accepted};
}
