import test from 'node:test';import assert from 'node:assert/strict';import {matchBoundaryCurvature} from '../src/boundary.js';
const w=54,h=50,n=w*h;
test('curved lighting crosses a repaired contour without the harmonic shoulder',()=>{
 const reference=new Float32Array(n*3),band=new Uint8Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,d=Math.abs(x-27)+Math.abs(y-25);band[i]=d>10&&d<20;
  for(let c=0;c<3;c++)reference[i*3+c]=40+c*15+.025*x*x+.018*y*y+.012*x*y;
 }
 let current=reference.slice(),next=current.slice();
 for(let k=0;k<500;k++){
  for(let i=w+1;i<n-w-1;i++)if(band[i])for(let c=0;c<3;c++)next[i*3+c]=(current[(i-1)*3+c]+current[(i+1)*3+c]+current[(i-w)*3+c]+current[(i+w)*3+c])*.25;
  [current,next]=[next,current];
 }
 const result=matchBoundaryCurvature(current,w,h,band);let before=0,after=0;
 for(let i=0;i<n;i++)for(let c=0;c<3;c++){
  const j=i*3+c;if(band[i]){before+=Math.abs(current[j]-reference[j]);after+=Math.abs(result[j]-reference[j]);assert(Math.abs(result[j]-current[j])<=6.00001);}else assert.equal(result[j],reference[j]);
 }
 assert(after<before*.6,`${after} versus ${before}`);
});
test('sharp contrast remains bounded, known pixels stay fixed, and tiny images are unchanged',()=>{
 const image=Float32Array.from({length:n*3},(_,j)=>Math.floor(j/3)%w<27?4:251),band=new Uint8Array(n);
 for(let y=15;y<35;y++)for(let x=23;x<31;x++)band[y*w+x]=1;
 const result=matchBoundaryCurvature(image,w,h,band);
 for(let i=0;i<n;i++)for(let c=0;c<3;c++){const j=i*3+c;assert(Number.isFinite(result[j]));assert(result[j]>=0&&result[j]<=255);assert(Math.abs(result[j]-image[j])<=6.00001);if(!band[i])assert.equal(result[j],image[j]);}
 const tiny=new Float32Array(3*3*3);assert.equal(matchBoundaryCurvature(tiny,3,3,new Uint8Array(9).fill(1)),tiny);
});
