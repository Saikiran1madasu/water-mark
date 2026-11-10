// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Original contour-tangent gradient reconstruction. No pretrained engine.
const cache=new WeakMap();
function geometry(model,r){
 if(cache.has(model))return cache.get(model);
 const n=r.w*r.h,indices=[],lookup=new Int32Array(n).fill(-1);
 for(let y=1;y<r.h-1;y++)for(let x=1;x<r.w-1;x++){const i=y*r.w+x;if(model.band[i]){lookup[i]=indices.length;indices.push(i);}}
 const neighbors=indices.map(i=>[-1,1,-r.w,r.w].map(d=>lookup[i+d])),result={indices,neighbors};cache.set(model,result);return result;
}
export function repairTangents(original,repaired,w,h,r,model,{screen=.15,limit=12,lumaOnly=false,gain=1,normals=model.tangentNormals,preserveMask=null}={}){
 if(original.length!==w*h*4||repaired.length!==original.length||model.alpha.length!==r.w*r.h||model.band.length!==model.alpha.length||(preserveMask&&preserveMask.length!==model.alpha.length))throw Error('Invalid tangent reconstruction buffers.');
 const n=r.w*r.h;
 if(!normals)return null;
 if(normals.nx.length!==n||normals.ny.length!==n||normals.confidence.length!==n||![screen,limit,gain].every(Number.isFinite)||screen<=0||limit<0||limit>32||gain<=0)throw Error('Invalid tangent reconstruction parameters.');
 if(normals.nx.some(v=>!Number.isFinite(v))||normals.ny.some(v=>!Number.isFinite(v))||normals.confidence.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Invalid tangent source directions.');
 const geom=geometry(model,r),tx=Float32Array.from(normals.ny,v=>-v),ty=normals.nx,weight=normals.confidence,channels=lumaOnly?1:3;
 let indices=geom.indices,neighbors=geom.neighbors;
 if(preserveMask?.some(v=>v)){indices=indices.filter(i=>!preserveMask[i]);const lookup=new Int32Array(n).fill(-1);indices.forEach((i,k)=>lookup[i]=k);neighbors=indices.map(i=>[-1,1,-r.w,r.w].map(d=>lookup[i+d]));}
 const dx=new Float32Array(n*channels),dy=new Float32Array(n*channels),rhs=new Float64Array(indices.length*channels);
 const value=(data,x,y,c)=>{const j=((r.y+y)*w+r.x+x)*4;return lumaOnly?(data[j]*.299+data[j+1]*.587+data[j+2]*.114):data[j+c];};
 for(let y=1;y<r.h-1;y++)for(let x=1;x<r.w-1;x++){const i=y*r.w+x;if(!model.band[i]||!weight[i]||preserveMask?.[i])continue;
  const transmission=1-model.alpha[i]*gain;if(transmission<.2||transmission>1.05)continue;
  for(let c=0;c<channels;c++){
   const sx=(value(original,x+1,y,c)-value(original,x-1,y,c))*.5,sy=(value(original,x,y+1,c)-value(original,x,y-1,c))*.5,bx=(value(repaired,x+1,y,c)-value(repaired,x-1,y,c))*.5,by=(value(repaired,x,y+1,c)-value(repaired,x,y-1,c))*.5;
   const delta=((sx*tx[i]+sy*ty[i])/transmission-bx*tx[i]-by*ty[i])*weight[i];dx[i*channels+c]=delta*tx[i];dy[i*channels+c]=delta*ty[i];
  }
 }
 for(let k=0;k<indices.length;k++){const i=indices[k];for(let c=0;c<channels;c++)rhs[k*channels+c]=.5*(dx[(i-1)*channels+c]-dx[(i+1)*channels+c]+dy[(i-r.w)*channels+c]-dy[(i+r.w)*channels+c]);}
 const apply=(input,out)=>{for(let k=0;k<indices.length;k++)for(let c=0;c<channels;c++){let sum=(4+screen)*input[k*channels+c];for(const j of neighbors[k])if(j>=0)sum-=input[j*channels+c];out[k*channels+c]=sum;}};
 const solution=new Float64Array(rhs.length),residual=rhs.slice(),direction=rhs.slice(),product=new Float64Array(rhs.length);let squared=residual.reduce((s,v)=>s+v*v,0);
 for(let it=0;it<100&&squared>rhs.length*1e-6;it++){apply(direction,product);let denominator=0;for(let i=0;i<rhs.length;i++)denominator+=direction[i]*product[i];if(denominator<1e-12)break;const step=squared/denominator;let next=0;for(let i=0;i<rhs.length;i++){solution[i]+=step*direction[i];residual[i]-=step*product[i];next+=residual[i]*residual[i];}const beta=next/squared;for(let i=0;i<rhs.length;i++)direction[i]=residual[i]+beta*direction[i];squared=next;}
 const out=repaired.slice(),mask=new Uint8Array(n);let pixels=0;
 for(let k=0;k<indices.length;k++){const i=indices[k],j=((r.y+Math.floor(i/r.w))*w+r.x+i%r.w)*4;let changed=false;for(let c=0;c<3;c++){const delta=Math.max(-limit,Math.min(limit,solution[k*channels+(lumaOnly?0:c)]));out[j+c]=repaired[j+c]+delta;changed||=out[j+c]!==repaired[j+c];}if(changed){mask[i]=1;pixels++;}}
 return {data:out,mask,pixels};
}
