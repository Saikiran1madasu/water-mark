// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Bounded derivative matching across the reconstructed contour. Solve the
// biharmonic correction with conjugate gradients; core and exterior stay fixed.
export function matchBoundaryCurvature(image,w,h,band){
 const indices=[],lookup=new Int32Array(w*h).fill(-1);
 for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)if(band[y*w+x]){lookup[y*w+x]=indices.length;indices.push(y*w+x);}
 if(!indices.length)return image;
 const offsets=[-1,1,-w,w,-w-1,-w+1,w-1,w+1,-2,2,-2*w,2*w],coefficients=[-8,-8,-8,-8,2,2,2,2,1,1,1,1];
 const neighbors=new Int32Array(indices.length*12),b=new Float64Array(indices.length*3);
 for(let k=0;k<indices.length;k++){
  for(let d=0;d<12;d++)neighbors[k*12+d]=lookup[indices[k]+offsets[d]];
  for(let c=0;c<3;c++){
   let value=20*image[indices[k]*3+c];for(let d=0;d<12;d++)value+=coefficients[d]*image[(indices[k]+offsets[d])*3+c];b[k*3+c]=-value;
  }
 }
 const apply=(v,out)=>{
  for(let k=0;k<indices.length;k++)for(let c=0;c<3;c++){
   let sum=20*v[k*3+c];for(let d=0;d<12;d++){const j=neighbors[k*12+d];if(j>=0)sum+=coefficients[d]*v[j*3+c];}out[k*3+c]=sum;
  }
 };
 const solution=new Float64Array(b.length),residual=b.slice(),direction=b.slice(),product=new Float64Array(b.length);
 let squared=residual.reduce((sum,v)=>sum+v*v,0);
 for(let iteration=0;iteration<120&&squared>b.length*1e-6;iteration++){
  apply(direction,product);let denominator=0;for(let i=0;i<b.length;i++)denominator+=direction[i]*product[i];if(denominator<=1e-14)break;
  const step=squared/denominator;let nextSquared=0;
  for(let i=0;i<b.length;i++){solution[i]+=step*direction[i];residual[i]-=step*product[i];nextSquared+=residual[i]*residual[i];}
  const beta=nextSquared/squared;for(let i=0;i<b.length;i++)direction[i]=residual[i]+beta*direction[i];squared=nextSquared;
 }
 const out=image.slice();
 for(let k=0;k<indices.length;k++)for(let c=0;c<3;c++){const j=indices[k]*3+c;out[j]=Math.max(0,Math.min(255,image[j]+Math.max(-6,Math.min(6,solution[k*3+c]))));}
 return out;
}
