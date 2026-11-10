import test from 'node:test';import assert from 'node:assert/strict';
import {prepareRGBRefinement,commitRGBRefinement,OriginalRGBRefiner,RGB_REFINER_SHA256} from '../src/rgb-refiner.js';
const w=160,h=160,r={x:45,y:45,w:70,h:74},n=r.w*r.h,model={alpha:new Float32Array(n).fill(.3),core:new Uint8Array(n),band:new Uint8Array(n)};
for(let y=16;y<48;y++)for(let x=20;x<50;x++)model.core[y*r.w+x]=1;
function fixture(){const original=new Uint8ClampedArray(w*h*4).fill(80),baseline=new Uint8ClampedArray(w*h*4).fill(70);for(let i=3;i<original.length;i+=4)original[i]=baseline[i]=255;return {original,baseline};}
test('RGB refinement packs separate source/repair inputs and the calibrated support',()=>{
 const {original,baseline}=fixture(),prepared=prepareRGBRefinement(original,baseline,w,h,r,model),pixels=128*128;
 assert.equal(prepared.input.length,pixels*8);assert(Math.abs(prepared.input[0]-80/255)<1e-7);assert(Math.abs(prepared.input[pixels*3]-70/255)<1e-7);
 const x=r.x+25-prepared.rect.x,y=r.y+20-prepared.rect.y,i=y*128+x;assert.equal(prepared.input[7*pixels+i],1);assert.equal(prepared.input[7*pixels],0);
});
test('RGB proposals preserve all pixels outside support, source data and alpha',()=>{
 const {original,baseline}=fixture(),prepared=prepareRGBRefinement(original,baseline,w,h,r,model),values=new Float32Array(128*128*3).fill(72/255),result=commitRGBRefinement(baseline,w,h,r,model,prepared,values);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const j=(y*w+x)*4,inside=x>=r.x&&y>=r.y&&x<r.x+r.w&&y<r.y+r.h,k=inside?(y-r.y)*r.w+x-r.x:-1;for(let c=0;c<3;c++)assert.equal(result[j+c],k>=0&&model.core[k]?72:70);assert.equal(result[j+3],255);}
 assert.equal(original[0],80);assert.equal(baseline[0],70);
});
test('invalid or excessive RGB results fail before modifying the repair',()=>{
 const {original,baseline}=fixture(),prepared=prepareRGBRefinement(original,baseline,w,h,r,model),before=baseline.slice();
 assert.throws(()=>commitRGBRefinement(baseline,w,h,r,model,prepared,new Float32Array(128*128*3).fill(1)),/bounded/);
 const bad=new Float32Array(128*128*3).fill(70/255);bad[bad.length-1]=NaN;assert.throws(()=>commitRGBRefinement(baseline,w,h,r,model,prepared,bad),/Invalid/);assert.deepEqual(baseline,before);
 assert.equal(prepareRGBRefinement(original,baseline,w,h,{x:0,y:0,w:120,h:120},{alpha:new Float32Array(14400),core:new Uint8Array(14400),band:new Uint8Array(14400)}),null);
});

test('paired self-calibration cancels a fixed learned outline without a clean reference',async()=>{
 const {original,baseline}=fixture();let disposed=0,runs=0;
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){disposed++;}}
 const session={async run({input}){runs++;const pixels=128*128,data=Float32Array.from({length:pixels*3},(_,j)=>input.data[3*pixels+j]+.01*input.data[7*pixels+j%pixels]);return {recovered:{type:'float32',dims:[1,3,128,128],data,dispose(){disposed++;}}};}};
 const engine=new OriginalRGBRefiner({Tensor},session),out=await engine.process(original,baseline,w,h,r,model,{selfCalibrate:true});
 assert.equal(runs,2);assert.equal(disposed,4);assert.deepEqual(out,baseline);assert.equal(original[0],80);
});

test('a failed counterfactual pass releases tensors and leaves the repair untouched',async()=>{
 const {original,baseline}=fixture(),before=baseline.slice();let runs=0,disposed=0;
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){disposed++;}}
 const session={async run(){if(++runs===2)throw Error('counterfactual failure');return {recovered:{type:'float32',dims:[1,3,128,128],data:new Float32Array(128*128*3).fill(70/255),dispose(){disposed++;}}};}};
 const engine=new OriginalRGBRefiner({Tensor},session);await assert.rejects(()=>engine.process(original,baseline,w,h,r,model,{selfCalibrate:true}),/counterfactual failure/);assert.equal(disposed,3);assert.deepEqual(baseline,before);
});

test('our pinned original RGB graph runs in WASM and preserves protected original references',async()=>{
 const fs=await import('node:fs'),ort=await import('onnxruntime-web'),bytes=fs.readFileSync('public/models/own-rgb-v3.onnx');
 await assert.rejects(()=>OriginalRGBRefiner.create({runtime:ort,modelBytes:bytes,expectedSHA256:'0'.repeat(64)}),/hash/);
 const engine=await OriginalRGBRefiner.create({runtime:ort,modelBytes:bytes,expectedSHA256:RGB_REFINER_SHA256});
 try{const {original,baseline}=fixture(),withBand={...model,band:new Uint8Array(n)};withBand.band[15*r.w+25]=1;const result=await engine.refineRepair(original,baseline,w,h,r,withBand,{preserveMask:new Uint8Array(n).fill(1)});assert.equal(result.pixels,0);assert.deepEqual(result.data,baseline);assert.equal(original[0],80);}finally{await engine.dispose();}
});

test('qualified cleanup can change the contour while preserving the inverted core',async()=>{
 const {original,baseline}=fixture(),withBand={...model,band:new Uint8Array(n)},bandIndex=15*r.w+25;withBand.band[bandIndex]=1;
 const engine=new OriginalRGBRefiner(null,null);engine.process=async()=>new Uint8ClampedArray(baseline.map((v,i)=>i%4===3?v:v+2));
 const result=await engine.refineRepair(original,baseline,w,h,r,withBand);
 assert.equal(result.pixels,1);assert.equal(result.changedMask[bandIndex],1);
 for(let i=0;i<n;i++)if(model.core[i]){const j=((r.y+Math.floor(i/r.w))*w+r.x+i%r.w)*4;for(let c=0;c<3;c++)assert.equal(result.data[j+c],baseline[j+c]);}
 const protectedResult=await engine.refineRepair(original,baseline,w,h,r,withBand,{preserveMask:withBand.band});assert.equal(protectedResult.pixels,0);
});
