import test from 'node:test';import assert from 'node:assert/strict';import {refineSmoothStructure} from '../src/structure.js';
const w=56,h=54,n=w*h,core=new Uint8Array(n),band=new Uint8Array(n);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=Math.abs(x-28)+Math.abs(y-27);core[y*w+x]=d<12;band[y*w+x]=d>=12&&d<17;}
function fixture(time=0,texture=false){const reference=new Float32Array(n*3),image=new Float32Array(n*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){const i=y*w+x,j=i*3+c;reference[j]=50+c*12+x*.15+y*.1+.004*x*y+2*Math.sin(time*.1)+(texture?12*((x+y)%2):0);image[j]=reference[j]+(core[i]?2:band[i]?1:0);}
 return {reference,image};}
function error(a,b){let sum=0,count=0;for(let i=0;i<n;i++)if(core[i])for(let c=0;c<3;c++){sum+=Math.abs(a[i*3+c]-b[i*3+c]);count++;}return sum/count;}
test('smooth reconstruction removes a faint core-shaped patch while preserving the exterior',()=>{
 const {reference,image}=fixture(),result=refineSmoothStructure(image,w,h,core,band);assert(result.pixels>0);assert(error(result.image,reference)<error(image,reference)*.4);
 for(let i=0;i<n;i++)if(!core[i]&&!band[i])for(let c=0;c<3;c++)assert.equal(result.image[i*3+c],image[i*3+c]);
});
test('fine texture cannot be silently replaced by smooth interpolation',()=>{
 const {image}=fixture(0,true),result=refineSmoothStructure(image,w,h,core,band);assert.equal(result.pixels,0);assert.equal(result.image,image);
});
test('coherent real edges retained as anchors stay untouched',()=>{
 const {image}=fixture();for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)image[(y*w+x)*3+c]+=25/(1+Math.exp(-(x-28)/2));
 const result=refineSmoothStructure(image,w,h,core,band);assert(result.pixels>0);assert(result.pixels<core.reduce((s,v)=>s+v,0));
 let preserved=0;for(let i=0;i<n;i++)if(core[i]&&!result.mask[i]){preserved++;for(let c=0;c<3;c++)assert.equal(result.image[i*3+c],image[i*3+c]);}assert(preserved>20);
});
test('smooth reconstruction does not introduce instability under slowly changing lighting',()=>{
 let previous=null;
 for(let time=0;time<12;time++){const {reference,image}=fixture(time),result=refineSmoothStructure(image,w,h,core,band);assert(result.pixels>0);const residual=result.image.map((v,i)=>v-reference[i]);if(previous){let difference=0,count=0;for(let i=0;i<n;i++)if(core[i])for(let c=0;c<3;c++){difference+=Math.abs(residual[i*3+c]-previous[i*3+c]);count++;}assert(difference/count<.05);}previous=residual;}
});

test('correction history damps a noisy reversal and never leaks onto a newly protected pixel',async()=>{
 const {StructureStabilizer}=await import('../src/structure.js'),state=new StructureStabilizer(),core=new Uint8Array([1,1]),image=new Float32Array(6).fill(80);
 const candidate=value=>({image:new Float32Array(6).fill(value),confidence:1,pixels:1,allowed:new Uint8Array([1,0])});
 const first=state.apply(image,candidate(86),core),next=state.apply(image,candidate(74),core);assert(Math.abs(next.image[0]-first.image[0])<12);
 const protectedNow={image:new Float32Array(6).fill(84),confidence:1,pixels:1,allowed:new Uint8Array([0,1])},protectedResult=state.apply(image,protectedNow,core);
 for(let c=0;c<3;c++)assert.equal(protectedResult.image[c],image[c]);
 state.reset();const reset=state.apply(image,candidate(74),core);assert.equal(reset.image[0],74);
});
test('rejecting an unqualified frame clears the correction history',async()=>{
 const {StructureStabilizer}=await import('../src/structure.js'),state=new StructureStabilizer(),core=new Uint8Array([1]),image=new Float32Array([50,50,50]);
 state.apply(image,{image:new Float32Array([56,56,56]),confidence:1,pixels:1,allowed:new Uint8Array([1])},core);
 assert.equal(state.apply(image,{pixels:0},core).image,image);assert.equal(state.field,null);
 assert.equal(state.previousImage,null);
});

test('a bright moving object does not inherit the preceding background repair',async()=>{
 const {StructureStabilizer}=await import('../src/structure.js'),state=new StructureStabilizer();
 const core=new Uint8Array([1,1]),allowed=new Uint8Array([1,1]);
 // The first background needs a -6 correction. A bright object then occupies
 // its first pixel, while the second pixel still shows the same background.
 const background=new Float32Array([86,86,86,86,86,86]);
 state.apply(background,{image:new Float32Array(6).fill(80),confidence:1,pixels:2,allowed},core);
 const incoming=new Float32Array([120,130,140,86,86,86]);
 const result=state.apply(incoming,{image:new Float32Array([120,130,140,80,80,80]),confidence:1,pixels:2,allowed},core);
 assert.deepEqual([...result.image],[120,130,140,80,80,80]);
 // With fixed history the new object incorrectly becomes 115.8/125.8/135.8.
 assert.deepEqual([...incoming],[120,130,140,86,86,86]);
});

