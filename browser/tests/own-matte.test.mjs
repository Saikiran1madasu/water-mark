import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as ort from 'onnxruntime-web';
import {prepareOwnMatte,OwnMatteEngine,validateMatteProposal,combineRepairReports} from '../src/own-matte.js';
function fixture(gray=false){
 const w=96,h=80,r={x:36,y:28,w:20,h:24},data=new Uint8ClampedArray(w*h*4),model={alpha:new Float32Array(480).fill(.33),core:new Uint8Array(480).fill(1),band:new Uint8Array(480),evidence:()=>true,frameGain:()=>1};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const j=(y*w+x)*4,inside=x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h,t=x*.65+y*.2;for(let c=0;c<3;c++){const clean=gray?30+t:[30,22,15][c]+t*[1,.6,.3][c];data[j+c]=inside?clean*.7+255*.3:clean;}data[j+3]=211;}
 return {w,h,r,data,model};
}
test('original-model packing includes only its declared source support and no painted history',()=>{
 const f=fixture(),p=prepareOwnMatte(f.data,f.w,f.h,f.r,f.model);assert.equal(p.input.length,p.n*7);assert.equal(p.support.reduce((a,b)=>a+b,0),480);for(let i=0;i<p.n;i++){assert.equal(p.input[4*p.n+i],p.support[i]);if(!p.support[i])assert.equal(p.input[3*p.n+i],0);}assert.throws(()=>prepareOwnMatte(f.data,f.w,f.h,{...f.r,w:200},f.model),/Invalid/);
});
test('a physically supported correction qualifies, while a wrong matte and gray ambiguity fail',()=>{
 const f=fixture(),p=prepareOwnMatte(f.data,f.w,f.h,f.r,f.model),good=new Float32Array(p.n*2);good.fill(.3,0,p.n);assert(validateMatteProposal(f.data,f.w,f.h,f.r,f.model,p,good));const bad=good.slice();bad.fill(.6,0,p.n);assert(!validateMatteProposal(f.data,f.w,f.h,f.r,f.model,p,bad));const g=fixture(true),q=prepareOwnMatte(g.data,g.w,g.h,g.r,g.model);assert(!validateMatteProposal(g.data,g.w,g.h,g.r,g.model,q,good));
});
test('failed proposal validation leaves the frame untouched and permits the original fallback',async()=>{
 let disposed=0;class Tensor{constructor(type,data,dims){this.data=data;this.dims=dims;}dispose(){disposed++;}}
 const f=fixture(),before=f.data.slice(),session={run:async({input})=>{const n=input.dims[2]*input.dims[3],data=new Float32Array(2*n);data.fill(.6,0,n);return {matte:{type:'float32',dims:[1,2,input.dims[2],input.dims[3]],data,dispose(){disposed++;}}};},release:async()=>{}};
 const engine=new OwnMatteEngine({Tensor},session);assert.equal(await engine.process(f.data,f.w,f.h,f.r,f.model),null);assert.deepEqual(f.data,before);assert.equal(engine.report().frames,0);assert.equal(engine.report().ownRejectedProposals,1);assert.equal(disposed,2);await engine.dispose();
});
test('missing watermark evidence cannot paint the source',async()=>{
 const f=fixture(),before=f.data.slice(),engine=new OwnMatteEngine({}, {run(){throw Error('must not infer');},release:async()=>{}});f.model.evidence=()=>false;await engine.process(f.data,f.w,f.h,f.r,f.model);assert.deepEqual(f.data,before);assert.equal(engine.report().ownSkippedFrames,1);assert.equal(engine.report().preserved,480);await engine.dispose();
});
test('mixed original/support reports conserve frames and selected pixels',()=>{
 const result=combineRepairReports({frames:2,selected:200,preserved:100,decomposed:60,lighting:40,temporal:0,pattern:0,fallback:0},{frames:1,selected:100,preserved:40,decomposed:40,lighting:20,ownModelFrames:1});assert.equal(result.frames,3);assert.equal(result.selected,result.preserved+result.decomposed+result.lighting);assert.equal(result.ownModelFrames,1);assert.equal(result.decomposedCoverage,33.3);
});
test('the original trained graph runs through browser-compatible WASM and verifies its hash',async()=>{
 const engine=await OwnMatteEngine.create({runtime:ort,modelBytes:fs.readFileSync('public/models/own-matte-v1.onnx')});try{
  const f=fixture(),p=prepareOwnMatte(f.data,f.w,f.h,f.r,f.model),input=new ort.Tensor('float32',p.input,[1,7,p.rect.h,p.rect.w]);const output=await engine.session.run({input});try{assert.deepEqual(output.matte.dims,[1,2,p.rect.h,p.rect.w]);assert.equal(output.matte.type,'float32');assert(output.matte.data.every(v=>Number.isFinite(v)&&v>=0&&v<=.8));}finally{input.dispose();output.matte.dispose();}
 }finally{await engine.dispose();}
 await assert.rejects(()=>OwnMatteEngine.create({runtime:ort,modelBytes:new Uint8Array([1,2])}),/does not match/);
});
