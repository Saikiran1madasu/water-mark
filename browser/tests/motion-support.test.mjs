import test from 'node:test';import assert from 'node:assert/strict';
import {estimateOriginalMotion,recoverOriginalMotion} from '../src/motion-support.js';
const w=128,h=112,r={x:46,y:38,w:34,h:36},n=r.w*r.h;
const support=Uint8Array.from({length:n},(_,i)=>Math.abs(i%r.w-17)+Math.abs(Math.floor(i/r.w)-18)<11),opacity=Float32Array.from(support,v=>v*.3);
function frame(shift=0,flat=false){const clean=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const xx=x+shift,j=(y*w+x)*4,v=flat?90:95+15*Math.sin(xx*.21+y*.08)+11*Math.cos(y*.19-xx*.07)+8*Math.sin(xx*.087+y*.31);clean.set([v,v*.8+15,v*.6+25,255],j);}const data=clean.slice();for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=y*r.w+x,j=((y+r.y)*w+x+r.x)*4;for(let c=0;c<3;c++)data[j+c]=data[j+c]*(1-opacity[i])+255*opacity[i];}return {clean,data};}
function request(current,previous){const repaired=current.clean.slice();for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(support[y*r.w+x])for(let c=0;c<3;c++)repaired[((y+r.y)*w+x+r.x)*4+c]+=2;return {original:current.data,repaired,w,h,r,support,opacity,history:[{data:previous.data,mask:r,overlaySupport:support,age:1}]};}
test('masked bidirectional motion identifies a translation from visible original pixels',()=>{
 const previous=frame(),current=frame(8),motion=estimateOriginalMotion(current.data,previous.data,w,h,r,support,r,support,24);assert(motion);assert.equal(motion.dx,8);assert.equal(motion.dy,0);assert.equal(motion.cycleError,0);
});
test('clean original donors reduce a repair bias without modifying source or exterior',()=>{
 const current=frame(8),previous=frame(),args=request(current,previous),before=args.repaired.slice(),original=current.data.slice(),result=recoverOriginalMotion(args);assert(result.pixels>10);
 let beforeError=0,afterError=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const inside=x>=r.x&&y>=r.y&&x<r.x+r.w&&y<r.y+r.h,i=inside?(y-r.y)*r.w+x-r.x:-1,j=(y*w+x)*4;for(let c=0;c<3;c++){if(i>=0&&result.mask[i]){beforeError+=Math.abs(before[j+c]-current.clean[j+c]);afterError+=Math.abs(args.repaired[j+c]-current.clean[j+c]);}if(i<0||!support[i])assert.equal(args.repaired[j+c],before[j+c]);}assert.equal(args.repaired[j+3],255);}
 assert(afterError<beforeError*.5);assert.deepEqual(current.data,original);
});
test('ambiguous flat backgrounds and unrelated original frames cannot supply motion',()=>{
 const a=frame(0,true),b=frame(8,true);assert.equal(estimateOriginalMotion(a.data,b.data,w,h,r,support,r,support,24),null);
 const c=frame(0),d=frame(8);for(let i=0;i<d.data.length;i+=4)for(let k=0;k<3;k++)d.data[i+k]=(i*13+k*71)%256;
 assert.equal(estimateOriginalMotion(c.data,d.data,w,h,r,support,r,support,24),null);
});
test('absence of a watermark and missing original-support provenance preserve the repair',()=>{
 const current=frame(8),previous=frame(),args=request(current,previous);args.original=current.clean;const before=args.repaired.slice();assert.equal(recoverOriginalMotion(args).pixels,0);assert.deepEqual(args.repaired,before);
 args.original=current.data;args.history[0].overlaySupport=null;assert.equal(recoverOriginalMotion(args).pixels,0);assert.deepEqual(args.repaired,before);
});

test('hidden donor pixels are excluded even when they contain a very different logo',()=>{
 const current=frame(8),previous=frame(),normal=request(current,previous);recoverOriginalMotion(normal);
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(support[y*r.w+x])previous.data.set([255,0,255,255],((r.y+y)*w+r.x+x)*4);
 const poisoned=request(current,previous),result=recoverOriginalMotion(poisoned);assert(result.pixels>10);assert.deepEqual(poisoned.repaired,normal.repaired);
});

test('integrated motion repair keeps original history and conserves pixel coverage',async()=>{
 const {BrowserRepair}=await import('../src/repair.js'),{CalibratedOverlay}=await import('../src/overlay.js');
 const info={corePixels:support.reduce((s,v)=>s+v,0),bandPixels:0,peakAlpha:.3};
 const engine=new BrowserRepair({mode:'motion',margin:0,radius:8});engine.globalOverlay=new CalibratedOverlay(r,255,opacity,support,new Uint8Array(n),info);
 const box={x:r.x/w,y:r.y/h,w:r.w/w,h:r.h/h};let original;
 let firstPass;
 for(const shift of [0,8]){const f=frame(shift);original=f.data.slice();firstPass=engine.process(f.data,w,h,box);}
 const report=engine.report();assert(report.motionSupportPixels>10);assert(report.temporal>10);
 assert.equal(report.selected,report.preserved+report.decomposed+report.temporal+report.pattern+report.lighting+report.fallback);
 assert(report.decomposed>=0&&report.lighting>=0);assert.deepEqual(engine.history[0].data,original);assert.deepEqual(engine.history[0].overlaySupport,support);
 const changedMask=Uint8Array.from(support,(v,i)=>v&&!firstPass.motionMask?.[i]?1:0),changed=changedMask.reduce((s,v)=>s+v,0);
 engine.recordRGBRefinement({pixels:changed,changedMask},firstPass);const refined=engine.report();
 assert.equal(refined.selected,refined.preserved+refined.decomposed+refined.temporal+refined.pattern+refined.lighting+refined.fallback);assert(refined.decomposed>=0);assert.equal(refined.rgbRefinedFrames,1);assert.deepEqual(engine.history[0].data,original);
 engine.dispose();assert.equal(engine.history.length,0);
});

test('a local motion query survives an unrelated moving object outside its context',()=>{
 const previous=frame(),current=frame(8);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  if(x>=91)previous.data.set([20,40,180,255],(y*w+x)*4);
  if(x>=83)current.data.set([220,30,40,255],(y*w+x)*4);
 }
 assert.equal(estimateOriginalMotion(current.data,previous.data,w,h,r,support,r,support,24),null);
 const local=estimateOriginalMotion(current.data,previous.data,w,h,r,support,r,support,24,{x:46,y:56});
 assert(local);assert.equal(local.dx,8);assert.equal(local.dy,0);assert.equal(local.cycleError,0);
});

test('the wider search can recover clean source pixels after a larger displacement',()=>{
 const args=request(frame(32),frame()),result=recoverOriginalMotion(args);assert(result.pixels>20);
 assert(result.motions.some(m=>m.dx===32&&m.dy===0));
});

test('quarter-pixel matching improves fractional alignment and excludes hidden interpolation taps',async()=>{
 const {estimateOriginalMotion:integerMotion}=await import('../reference/browser-before-fine/motion-support.js');
 const current=frame(8.5),previous=frame(),fine=estimateOriginalMotion(current.data,previous.data,w,h,r,support,r,support,24),coarse=integerMotion(current.data,previous.data,w,h,r,support,r,support,24);
 assert(fine&&coarse);assert(Math.abs(fine.dx-8.5)<=.25);assert(Math.abs(fine.dy)<=.25);assert(fine.error<coarse.error*.75);
 const args=request(current,previous),result=recoverOriginalMotion(args);assert(result.subpixelPixels>10);
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(support[y*r.w+x])previous.data.set([255,0,255,255],((r.y+y)*w+r.x+x)*4);
 const poisoned=request(current,previous);recoverOriginalMotion(poisoned);assert.deepEqual(poisoned.repaired,args.repaired);
});
test('fine-only correction protects an already accurate reconstruction and explicit source references',()=>{
 const current=frame(8.5),previous=frame(),args=request(current,previous);args.fractionalOnly=true;args.repaired=current.clean.slice();const accurate=args.repaired.slice();
 assert.equal(recoverOriginalMotion(args).pixels,0);assert.deepEqual(args.repaired,accurate);
 const protectedArgs=request(current,previous);protectedArgs.fractionalOnly=true;protectedArgs.preserveMask=new Uint8Array(n).fill(1);const protectedBefore=protectedArgs.repaired.slice();
 assert.equal(recoverOriginalMotion(protectedArgs).pixels,0);assert.deepEqual(protectedArgs.repaired,protectedBefore);
 protectedArgs.preserveMask=new Uint8Array(1);assert.throws(()=>recoverOriginalMotion(protectedArgs),/Invalid original-frame motion buffers/);
});
