// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Conservative low-frequency matching, fitted only to visible, unmodified pixels.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function solve(matrix,values){
 const a=matrix.map((row,i)=>[...row,...values[i]]),n=matrix.length;
 for(let k=0;k<n;k++){
  let pivot=k;for(let j=k+1;j<n;j++)if(Math.abs(a[j][k])>Math.abs(a[pivot][k]))pivot=j;
  if(Math.abs(a[pivot][k])<1e-8)return null;[a[k],a[pivot]]=[a[pivot],a[k]];
  const divisor=a[k][k];for(let j=k;j<n+3;j++)a[k][j]/=divisor;
  for(let i=0;i<n;i++)if(i!==k){const scale=a[i][k];for(let j=k;j<n+3;j++)a[i][j]-=scale*a[k][j];}
 }return a.map(row=>row.slice(n));
}
function lowpass(image,w,h,r=4){
 const horizontal=new Float32Array(image.length),out=new Float32Array(image.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
  let sum=0,n=0;for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){sum+=image[(y*w+xx)*3+c];n++;}horizontal[(y*w+x)*3+c]=sum/n;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
  let sum=0,n=0;for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r);yy++){sum+=horizontal[(yy*w+x)*3+c];n++;}out[(y*w+x)*3+c]=sum/n;
 }return out;
}
export function matchSmoothTone(image,w,h,core,band){
 const n=w*h,basis=Array.from({length:n},(_,i)=>{const x=(i%w)/w-.5,y=Math.floor(i/w)/h-.5;return [1,x,y,x*x,x*y,y*y];});
 const known=[];for(let i=0;i<n;i+=2)if(!core[i]&&!band[i])known.push(i);
 if(known.length<120)return {image,pixels:0};
 let active=known,coeff,errors;
 const predict=(i,c)=>basis[i].reduce((sum,v,k)=>sum+v*coeff[k][c],0);
 for(let iteration=0;iteration<4;iteration++){
  const matrix=Array.from({length:6},()=>Array(6).fill(0)),values=Array.from({length:6},()=>[0,0,0]);
  for(const i of active)for(let a=0;a<6;a++){
   for(let b=0;b<6;b++)matrix[a][b]+=basis[i][a]*basis[i][b];
   for(let c=0;c<3;c++)values[a][c]+=basis[i][a]*image[i*3+c];
  }
  coeff=solve(matrix,values);if(!coeff)return {image,pixels:0};
  errors=known.map(i=>Math.sqrt([0,1,2].reduce((sum,c)=>sum+(predict(i,c)-image[i*3+c])**2,0)/3));
  const ordered=[...errors].sort((a,b)=>a-b),limit=Math.max(1.25,ordered[Math.floor(ordered.length*.7)]);
  active=known.filter((_,k)=>errors[k]<=limit);
 }
 const ordered=[...errors].sort((a,b)=>a-b),median=ordered[Math.floor(ordered.length*.5)],upper=ordered[Math.floor(ordered.length*.7)];
 // Mixed edges and textures do not justify a smooth-background correction.
 const confidence=clamp((3.2-median)/.7,0,1)*clamp((5-upper),0,1);
 if(confidence<=0)return {image,pixels:0};
 const smooth=lowpass(image,w,h),correction=new Float32Array(image.length),weight=new Float32Array(n);let pixels=0;
 for(let i=0;i<n;i++)if(core[i]||band[i]){
  const delta=[0,1,2].map(c=>predict(i,c)-smooth[i*3+c]),error=Math.hypot(...delta)/Math.sqrt(3);
  // A real edge inconsistent with the fitted surface must survive unchanged.
  weight[i]=confidence*clamp((8-error)/3,0,1);
  for(let c=0;c<3;c++)correction[i*3+c]=clamp(delta[c],-6,6)*weight[i];
 }
 // Feather only the correction field; never blur recovered video texture.
 const feathered=lowpass(correction,w,h,2),out=image.slice(),mask=new Uint8Array(n);
 for(let i=0;i<n;i++)if(core[i]||band[i]){
  let changed=false;
  for(let c=0;c<3;c++){out[i*3+c]=clamp(image[i*3+c]+feathered[i*3+c]*weight[i],0,255);if(Math.abs(out[i*3+c]-image[i*3+c])>.0001)changed=true;}
  if(core[i]&&changed){pixels++;mask[i]=1;}
 }
 return {image:out,pixels,mask};
}
