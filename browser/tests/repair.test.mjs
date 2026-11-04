import test from 'node:test';import assert from 'node:assert/strict';
import {BrowserRepair,boxAt,selection,footprint} from '../src/repair.js';
function scene(w=320,h=180){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;const dx=((x+24)%48)-24,dy=((y+24)%48)-24;const cross=(Math.abs(dx)<=1&&Math.abs(dy)<=4)||(Math.abs(dy)<=1&&Math.abs(dx)<=4);const v=220+x*.012+y*.018-(cross?22:0);data.set([v-5,v+2,v+4,255],i);}return data;}
function cover(data,w,r,level=255){for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)for(let c=0;c<3;c++)data[(y*w+x)*4+c]=level;}
function mae(a,b,w,r){let error=0;for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)for(let c=0;c<3;c++)error+=Math.abs(a[(y*w+x)*4+c]-b[(y*w+x)*4+c]);return error/(r.w*r.h*3);}
function outsideEqual(a,b,w,h,r){for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x<r.x||y<r.y||x>=r.x+r.w||y>=r.y+r.h){const i=(y*w+x)*4;for(let c=0;c<4;c++)assert.equal(a[i+c],b[i+c]);}}
test('pattern repair replaces an opaque logo without changing outside pixels',()=>{
 const w=320,h=180,box={x:.65,y:.5,w:.12,h:.22},r=selection(w,h,box,3),clean=scene(w,h),observed=clean.slice();cover(observed,w,r);const original=observed.slice(),engine=new BrowserRepair({mode:'detail',radius:4});const result=engine.process(observed,w,h,box);
 assert.equal(result.method,'pattern');assert(mae(observed,clean,w,r)<3);outsideEqual(observed,original,w,h,r);assert.equal(engine.report().frames,1);
});
test('smooth illumination repair avoids retaining the white rectangle',()=>{
 const w=160,h=96,clean=scene(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;clean.set([190+.04*x+.02*y,200+.04*x+.02*y,205+.04*x+.02*y,255],i);}
 const box={x:.5,y:.4,w:.15,h:.2},r=selection(w,h,box,3),observed=clean.slice();cover(observed,w,r);const original=observed.slice(),engine=new BrowserRepair();const result=engine.process(observed,w,h,box);
 assert.equal(result.method,'lighting');assert(mae(observed,clean,w,r)<1);outsideEqual(observed,original,w,h,r);
});
test('light and dark shape footprints preserve clean pixels in the selection',()=>{
 const w=160,h=100,r={x:50,y:25,w:40,h:50},clean=scene(w,h),plate=new Uint8ClampedArray(r.w*r.h*4);
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)plate.set(clean.slice(((r.y+y)*w+r.x+x)*4,((r.y+y)*w+r.x+x)*4+4),(y*r.w+x)*4);
 for(const level of [255,0]){const observed=clean.slice();for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(Math.abs(x-20)+Math.abs(y-25)<13)for(let c=0;c<3;c++)observed[((r.y+y)*w+r.x+x)*4+c]=level;const result=footprint(observed,w,r,plate);assert(result);assert(result.modified<r.w*r.h*.8);}
});
test('weak footprint evidence and full-area markings keep the safe full repair',()=>{
 const w=100,h=80,r={x:25,y:20,w:30,h:30},data=scene(w,h),plate=new Uint8ClampedArray(r.w*r.h*4).fill(220);cover(data,w,r);assert.equal(footprint(data,w,r,plate),null);
});
test('keyframe selection uses source timeline and interpolates size and position',()=>{
 const a={x:.1,y:.2,w:.1,h:.1},b={x:.3,y:.4,w:.2,h:.2},keys=[{time:1,box:a},{time:3,box:b}];assert.equal(boxAt(0,a,keys),a);assert.equal(boxAt(5,a,keys),b);assert(Math.abs(boxAt(2,a,keys).x-.2)<1e-9);assert(Math.abs(boxAt(2,a,keys).w-.15)<1e-9);
});
test('invalid, excessively large and tiny selections are rejected',()=>{
 for(const box of [{x:-.1,y:0,w:.1,h:.1},{x:.8,y:0,w:.5,h:.1},{x:0,y:0,w:.9,h:.9},{x:0,y:0,w:.001,h:.001}])assert.throws(()=>selection(320,180,box,0));
});
test('history holds only originals, remains bounded and coverage accounts for all pixels',()=>{
 const engine=new BrowserRepair({mode:'balanced',radius:2}),box={x:.5,y:.4,w:.1,h:.1};
 for(let n=0;n<4;n++){const data=scene(100,80),r=selection(100,80,box,3);cover(data,100,r);engine.process(data,100,80,box);assert.equal(engine.history[0].data[(r.y*100+r.x)*4],255);}
 assert.equal(engine.history.length,2);const s=engine.report();assert.equal(s.selected,s.preserved+s.pattern+s.lighting+s.temporal+s.fallback);engine.dispose();assert.equal(engine.history.length,0);
});
test('faint cross details cannot be discarded as color-fit outliers',()=>{
 const w=320,h=180,clean=scene(w,h),box={x:.65,y:.5,w:.12,h:.22},r=selection(w,h,box,3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=((x+24)%48)-24,dy=((y+24)%48)-24;if((Math.abs(dx)<=1&&Math.abs(dy)<=4)||(Math.abs(dy)<=1&&Math.abs(dx)<=4))for(let c=0;c<3;c++)clean[(y*w+x)*4+c]+=13;}
 const observed=clean.slice();cover(observed,w,r);const result=new BrowserRepair().process(observed,w,h,box);
 assert.equal(result.method,'pattern');assert(Math.abs(observed[(96*w+240)*4]-clean[(96*w+240)*4])<3);
});
test('clean moving background pixels are recovered from original history',()=>{
 const w=160,h=96,box={x:.45,y:.4,w:.08,h:.15},r=selection(w,h,box,0),engine=new BrowserRepair({radius:8,margin:0});let result,clean,data;
 for(let frame=0;frame<10;frame++){
  clean=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=Math.imul(x+frame*3+123,73856093)^Math.imul(y+73,19349663);v^=v>>>13;const i=(y*w+x)*4;clean.set([80+(v>>>0)%120,70+((v>>>5)>>>0)%130,90+((v>>>11)>>>0)%100,255],i);}
  data=clean.slice();cover(data,w,r);result=engine.process(data,w,h,box);
 }
 assert(result.recovered>r.w*r.h*.9);assert(mae(data,clean,w,r)<1);
});
test('isolated edge noise cannot force a rectangular replacement around a logo',()=>{
 const w=160,h=100,r={x:50,y:25,w:40,h:50},clean=scene(w,h),observed=clean.slice(),plate=new Uint8ClampedArray(r.w*r.h*4);
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const src=((r.y+y)*w+r.x+x)*4;plate.set(clean.slice(src,src+4),(y*r.w+x)*4);if(Math.abs(x-20)+Math.abs(y-25)<13)for(let c=0;c<3;c++)observed[src+c]=255;}
 for(const [x,y] of [[0,4],[39,9],[8,0],[20,49]])for(let c=0;c<3;c++)observed[((r.y+y)*w+r.x+x)*4+c]=250;
 const result=footprint(observed,w,r,plate);assert(result);assert(result.modified<r.w*r.h*.8);assert.equal(result.alpha[4*r.w],0);
});
