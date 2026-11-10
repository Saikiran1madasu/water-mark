// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
import {matchBoundaryCurvature} from './boundary.js';
function box(image,w,h,channels,r){
 const a=new Float32Array(image.length),out=new Float32Array(image.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++){let sum=0,n=0;for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){sum+=image[(y*w+xx)*channels+c];n++;}a[(y*w+x)*channels+c]=sum/n;}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++){let sum=0,n=0;for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r);yy++){sum+=a[(yy*w+x)*channels+c];n++;}out[(y*w+x)*channels+c]=sum/n;}
 return out;
}
export function refineSmoothStructure(image,w,h,core,band){
 const n=w*h,luma=Float32Array.from({length:n},(_,i)=>(image[i*3]+2*image[i*3+1]+image[i*3+2])/4),low=box(luma,w,h,1,1),detail=[];
 for(let i=0;i<n;i++)if(core[i])detail.push(Math.abs(luma[i]-low[i]));
 if(detail.length<30)return {image,mask:null,pixels:0};detail.sort((a,b)=>a-b);
 // Fine texture needs the recovered original, rather than smooth interpolation.
 const detailConfidence=Math.max(0,Math.min(1,(3-detail[Math.floor(detail.length*.9)])/.8));
 if(!detailConfidence)return {image,mask:null,pixels:0};
 const tensor=new Float32Array(n*3),magnitude=new Float32Array(n);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,gx=(luma[i+1]-luma[i-1])*.5,gy=(luma[i+w]-luma[i-w])*.5;tensor[i*3]=gx*gx;tensor[i*3+1]=gy*gy;tensor[i*3+2]=gx*gy;magnitude[i]=Math.hypot(gx,gy);}
 const structure=box(tensor,w,h,3,4),strong=new Uint8Array(n),protectedPixels=new Uint8Array(n),unknown=new Uint8Array(n),indices=[];
 for(let i=0;i<n;i++)if(core[i]){const a=structure[i*3],b=structure[i*3+1],cross=structure[i*3+2],coherence=Math.hypot(a-b,2*cross)/(a+b+1e-6);if(magnitude[i]>2&&coherence>.65)strong[i]=1;}
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(core[y*w+x])for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)if(strong[yy*w+xx])protectedPixels[y*w+x]=1;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if((core[i]||band[i])&&!protectedPixels[i]){unknown[i]=1;indices.push(i);}}
 let current=image.slice(),next=image.slice();
 for(let iteration=0;iteration<600;iteration++){
  let change=0;for(const i of indices)for(let c=0;c<3;c++){const value=(current[(i-1)*3+c]+current[(i+1)*3+c]+current[(i-w)*3+c]+current[(i+w)*3+c])*.25;next[i*3+c]=value;change=Math.max(change,Math.abs(value-current[i*3+c]));}
  [current,next]=[next,current];if(change<.002)break;
 }
 current=matchBoundaryCurvature(current,w,h,unknown);
 const differences=[];for(let i=0;i<n;i++)if(core[i]&&!protectedPixels[i])differences.push(Math.hypot(...[0,1,2].map(c=>current[i*3+c]-image[i*3+c]))/Math.sqrt(3));
 if(!differences.length)return {image,mask:null,pixels:0};differences.sort((a,b)=>a-b);
 // An inconsistent estimate cannot replace a hidden edge or object.
 const agreement=Math.max(0,Math.min(1,(8-differences[Math.floor(differences.length*.9)])/2));
 if(!agreement)return {image,mask:null,pixels:0};
 const mask=Uint8Array.from(core,(v,i)=>v&&!protectedPixels[i]);return {image:current,mask,allowed:unknown,confidence:detailConfidence*agreement,pixels:mask.reduce((sum,v)=>sum+v,0)};
}
export class StructureStabilizer{
 reset(){this.field=null;}
 apply(image,candidate,core){
  if(!candidate.pixels){this.reset();return {image,mask:null,pixels:0};}
  const field=new Float32Array(image.length),out=image.slice(),mask=new Uint8Array(core.length);let pixels=0;
  const previous=this.field?.length===image.length?this.field:null;
  for(let i=0;i<core.length;i++)if(candidate.allowed[i]){
   let changed=false;
   for(let c=0;c<3;c++){
    const j=i*3+c,target=(candidate.image[j]-image[j])*candidate.confidence;
    field[j]=previous?previous[j]*.7+target*.3:target;out[j]=Math.max(0,Math.min(255,image[j]+field[j]));
    if(Math.abs(out[j]-image[j])>.0001)changed=true;
   }
   if(core[i]&&changed){mask[i]=1;pixels++;}
  }
  this.field=field;return {image:out,mask,pixels};
 }
}
