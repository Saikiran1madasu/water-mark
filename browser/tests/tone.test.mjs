import test from 'node:test';import assert from 'node:assert/strict';import {matchSmoothTone} from '../src/tone.js';
const w=70,h=74,n=w*h,core=new Uint8Array(n),band=new Uint8Array(n);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=Math.abs(x-35)+Math.abs(y-37);core[y*w+x]=d<18;band[y*w+x]=d>=18&&d<24;}
function fixture(frame=0,texture=false){const reference=new Float32Array(n*3),observed=new Float32Array(n*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
  const i=y*w+x,j=i*3+c,value=40+c*12+.12*x+.08*y+.001*x*y+2*Math.sin(frame*.2)+.5*Math.sin(x*1.7+y*.9+frame*.1)+(texture?18*((x>>2)%2):0);
  reference[j]=value;observed[j]=value+(core[i]?3.5:band[i]?1.8:0);
 }return {reference,observed};}
function error(a,b){let sum=0,count=0;for(let i=0;i<n;i++)if(core[i])for(let c=0;c<3;c++){sum+=Math.abs(a[i*3+c]-b[i*3+c]);count++;}return sum/count;}
test('smooth tone matching reduces a faint residual without changing known pixels or fine texture',()=>{
 const {reference,observed}=fixture(),result=matchSmoothTone(observed,w,h,core,band);
 assert(result.pixels>0);assert(error(result.image,reference)<error(observed,reference)*.35);
 for(let i=0;i<n;i++)if(!core[i]&&!band[i])for(let c=0;c<3;c++)assert.equal(result.image[i*3+c],observed[i*3+c]);
 // Fine spatial contrast remains in the result instead of being blurred away.
 let before=0,after=0;for(let y=33;y<40;y++)for(let x=30;x<40;x++){const j=(y*w+x)*3;before+=Math.abs(reference[j+3]-reference[j]);after+=Math.abs(result.image[j+3]-result.image[j]);}
 assert(Math.abs(after-before)/before<.15);
});
test('a textured boundary cannot justify smooth tone replacement',()=>{
 const {observed}=fixture(0,true),result=matchSmoothTone(observed,w,h,core,band);assert.equal(result.pixels,0);assert.deepEqual(result.image,observed);
});
test('smooth tone correction remains stable through a changing-light sequence',()=>{
 let previous=null,maxResidualChange=0;
 for(let f=0;f<36;f++){
  const {reference,observed}=fixture(f),result=matchSmoothTone(observed,w,h,core,band),residual=result.image.map((v,i)=>v-reference[i]);
  assert(error(result.image,reference)<1.3);
  if(previous){let sum=0,count=0;for(let i=0;i<n;i++)if(core[i])for(let c=0;c<3;c++){sum+=Math.abs(residual[i*3+c]-previous[i*3+c]);count++;}maxResidualChange=Math.max(maxResidualChange,sum/count);}
  previous=residual;
 }assert(maxResidualChange<.08);
});
test('a strong line inside the repaired area is not replaced by the smooth fitted surface',()=>{
 const {observed}=fixture();for(let y=29;y<45;y++)for(let x=32;x<=38;x++)for(let c=0;c<3;c++)observed[(y*w+x)*3+c]+=35;
 const result=matchSmoothTone(observed,w,h,core,band);
 for(let y=32;y<42;y++)for(let x=33;x<=37;x++)for(let c=0;c<3;c++)assert.equal(result.image[(y*w+x)*3+c],observed[(y*w+x)*3+c]);
});
