import test from 'node:test';import assert from 'node:assert/strict';
import {holdFootprint,contextChanged} from '../src/stability.js';import {BrowserRepair} from '../src/repair.js';
function setup(){const w=64,h=64,r={x:20,y:20,w:24,h:24},plate=new Uint8ClampedArray(r.w*r.h*4).fill(200),data=new Uint8ClampedArray(w*h*4).fill(200),alpha=new Float32Array(r.w*r.h);for(let y=7;y<17;y++)for(let x=7;x<17;x++){alpha[y*r.w+x]=1;for(let c=0;c<3;c++)data[((r.y+y)*w+r.x+x)*4+c]=255;}return {w,h,r,plate,data,shape:{alpha,level:255,modified:100}};}
test('small matte edge fluctuations do not switch the repaired area every frame',()=>{
 const {w,r,plate,data,shape}=setup(),current={...shape,alpha:shape.alpha.slice()};current.alpha[6*r.w+10]=1;
 const result=holdFootprint({shape,rect:r},current,data,w,r,plate);assert(result.held);assert.equal(result.shape,shape);
});
test('new watermark evidence outside the held matte forces a fresh mask',()=>{
 const {w,r,plate,data,shape}=setup(),current={...shape,alpha:shape.alpha.slice()};current.alpha[6*r.w+10]=1;for(let c=0;c<3;c++)data[((r.y+6)*w+r.x+10)*4+c]=255;
 const result=holdFootprint({shape,rect:r},current,data,w,r,plate);assert(!result.held);assert.equal(result.shape,current);
});
test('disappearing logo and moving selection cannot keep stale matte geometry',()=>{
 const {w,r,plate,data,shape}=setup();data.fill(200);assert(!holdFootprint({shape,rect:r},null,data,w,r,plate).held);
 assert(!holdFootprint({shape,rect:{...r,x:r.x+7}},shape,data,w,r,plate).held);
});
test('stable geometry still reconstructs current lighting rather than copying painted pixels',()=>{
 const w=160,h=100,box={x:.3,y:.25,w:.25,h:.5},engine=new BrowserRepair({margin:3});
 for(const brightness of [190,205]){const data=new Uint8ClampedArray(w*h*4).fill(brightness);for(let y=32;y<68;y++)for(let x=53;x<83;x++)if(Math.abs(x-68)+Math.abs(y-50)<13)for(let c=0;c<3;c++)data[(y*w+x)*4+c]=255;engine.process(data,w,h,box);assert(Math.abs(data[(50*w+68)*4]-brightness)<2);}
 assert(engine.report().stableMaskFrames>=1);
});
test('fractional pattern alignment is available without integer snapping',()=>{
 const w=320,h=180,box={x:.6,y:.5,w:.1,h:.16},data=new Uint8ClampedArray(w*h*4),clean=new Uint8ClampedArray(data.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=170+24*Math.sin(x*Math.PI*2/47.6)+19*Math.cos(y*Math.PI*2/43.4),i=(y*w+x)*4;data.set([v-3,v+2,v+4,255],i);}clean.set(data);
 for(let y=90;y<119;y++)for(let x=192;x<224;x++)for(let c=0;c<3;c++)data[(y*w+x)*4+c]=255;
 const engine=new BrowserRepair({margin:0});engine.process(data,w,h,box);assert(engine.report().subpixelFrames>0);let error=0;for(let y=90;y<119;y++)for(let x=192;x<224;x++)error+=Math.abs(data[(y*w+x)*4]-clean[(y*w+x)*4]);assert(error/(29*32)<2);
});
