import test from 'node:test';import assert from 'node:assert/strict';
import {OverlayCalibrator,SelectionOverlayCalibrator,paddedOverlayRect,regularizeCore} from '../src/overlay.js';
import {OverlayCalibrator as PreviousCalibrator} from '../reference/browser-before-plateau/overlay.js';
import {CalibratedOverlay as PreviousOverlay} from '../reference/browser-before-adaptive/overlay.js';import {prepareOverlay} from '../src/prepare.js';import {BrowserRepair} from '../src/repair.js';
import {CalibratedOverlay as IsotropicOverlay} from '../reference/browser-before-directional/overlay.js';
const w=120,h=100,r={x:40,y:28,w:40,h:46},box={x:r.x/w,y:r.y/h,w:r.w/w,h:r.h/h};
function fixture(n,{opacity=.3,gray=false,shift=0,mark=true}={}){
 const clean=new Uint8ClampedArray(w*h*4),data=new Uint8ClampedArray(clean.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4,t=35+x*.65+y*.2+(x>60?32:0)+5*Math.sin(y*.3+n*.2),palette=n<4?[20,30,40]:[45,18,32];
  for(let c=0;c<3;c++)clean[i+c]=gray?t:palette[c]+t*[1,.65,.35][c];clean[i+3]=255;
  const d=Math.abs(x-60-shift)+Math.abs(y-51),a=mark?Math.min(opacity,Math.max(0,(13-d)*opacity/2)):0;
  for(let c=0;c<3;c++)data[i+c]=clean[i+c]*(1-a)+255*a;data[i+3]=255;
 }return {data,clean,width:w,height:h};
}
function calibrate(options={}){const cal=new OverlayCalibrator(r);for(let n=0;n<8;n++)cal.observe(fixture(n,options).data,w,h,n);return cal.finalize();}
test('multi-scene matting recovers an actual sharp background edge through a translucent mark',()=>{
 const model=calibrate();assert(model);assert(model.info.acceptedFrames>=4);
 for(const n of [1,5,12]){
  const {data,clean}=fixture(n),original=data.slice();assert(model.recover(data,w,h,r));let error=0,count=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const j=(y*w+x)*4,inside=x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h,i=inside?(y-r.y)*r.w+x-r.x:-1;
   if(inside&&model.core[i])for(let c=0;c<3;c++){error+=Math.abs(data[j+c]-clean[j+c]);count++;}
   if(!inside||(!model.core[i]&&!model.band[i]))for(let c=0;c<4;c++)assert.equal(data[j+c],original[j+c]);
  }
  assert(error/count<1.8,`core reference error ${error/count}`);
  const left=(51*w+58)*4,right=(51*w+63)*4;assert(data[right]-data[left]>25,'the vertical edge must survive rather than flatten into a patch');
 }
});
test('opaque marks, absent marks and unidentifiable grayscale color lines are rejected',()=>{
 assert.equal(calibrate({opacity:1}),null);assert.equal(calibrate({opacity:.85}),null);assert.equal(calibrate({mark:false}),null);assert.equal(calibrate({gray:true}),null);
});
test('calibration cannot paint a missing or displaced logo or a different selection',()=>{
 const model=calibrate();assert(model);
 for(const options of [{mark:false},{shift:14}]){const {data}=fixture(7,options),original=data.slice();assert.equal(model.recover(data,w,h,r),null);assert.deepEqual(data,original);}
 const {data}=fixture(7),original=data.slice();assert.equal(model.recover(data,w,h,{...r,x:r.x+1}),null);assert.deepEqual(data,original);
});
test('integrated inversion keeps only original history and accounts for its recovered pixels',()=>{
 const model=calibrate(),engine=new BrowserRepair({margin:0}),f=fixture(5),original=f.data.slice();engine.globalOverlay=model;
 const result=engine.process(f.data,w,h,box);assert.equal(result.method,'deblend');assert.deepEqual(engine.history[0].data,original);
 const s=engine.report();assert.equal(s.frames,1);assert.equal(s.globalInverseFrames,1);assert(s.decomposedCoverage>0);assert.equal(s.selected,s.preserved+s.decomposed+s.temporal+s.pattern+s.lighting+s.fallback);
});
test('directional boundary repair preserves edges better than isotropic smoothing',()=>{
 const model=calibrate(),baseline=new IsotropicOverlay(model.r,model.level,model.alpha,model.core,model.band,model.info);
 for(const n of [1,5,12]){
  const f=fixture(n),current=f.data.slice(),old=f.data.slice();assert(model.recover(current,w,h,r));assert(baseline.recover(old,w,h,r));let after=0,before=0;
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(model.band[y*r.w+x]&&Math.abs(x+r.x-60)<=3)for(let c=0;c<3;c++){
   const j=((r.y+y)*w+r.x+x)*4+c;after+=Math.abs(current[j]-f.clean[j]);before+=Math.abs(old[j]-f.clean[j]);
  }
  assert(after<before*.8,'the repaired boundary should retain the real line rather than average it away');
 }
});
test('sparse preparation closes duplicates and missing/failed samples without inflating calibration',async()=>{
 const closed=[];let returned=false;const cal={candidates:[],observe(){this.candidates.push(1);},finalize(){return 'ready';}};
 async function* samples(){try{yield null;for(const timestamp of [0,0,1])yield {timestamp,close(){closed.push(timestamp);}};}finally{returned=true;}}
 const result=await prepareOverlay(cal,samples(),()=>({data:new Uint8ClampedArray(),width:1,height:1}));assert.equal(result.sampled,2);assert.equal(result.accepted,2);assert.equal(result.model,'ready');assert.deepEqual(closed,[0,0,1]);assert(returned);
 let failedClosed=false;
 async function* failure(){yield {timestamp:0,close(){failedClosed=true;}};}
 await assert.rejects(()=>prepareOverlay(cal,failure(),()=>{throw Error('read failed');}),/read failed/);assert(failedClosed);
});

test('opacity adaptation follows a modest transparency change without flattening texture',()=>{
 const model=calibrate(),previous=new PreviousOverlay(model.r,model.level,model.alpha,model.core,model.band,model.info);
 for(const opacity of [.27,.33]){
  model.resetFrameState();const f=fixture(5,{opacity}),after=f.data.slice(),before=f.data.slice();
  assert(model.recover(after,w,h,r));assert(previous.recover(before,w,h,r));let a=0,b=0;
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(model.core[y*r.w+x])for(let c=0;c<3;c++){const j=((r.y+y)*w+r.x+x)*4+c;a+=Math.abs(after[j]-f.clean[j]);b+=Math.abs(before[j]-f.clean[j]);}
  assert(a<b*.4,`opacity ${opacity}: ${a} versus ${b}`);
 }
});
test('a tight selection retries with a bounded clean background ring and retains selection identity',()=>{
 const tight={x:47,y:38,w:27,h:27},plain=new OverlayCalibrator(tight),cal=new SelectionOverlayCalibrator(tight,w,h);
 for(let n=0;n<8;n++){const f=fixture(n);plain.observe(f.data,w,h,n);cal.observe(f.data,w,h,n);}
 assert.equal(plain.finalize(),null);const model=cal.finalize();assert(model);assert.deepEqual(model.requestedRect,tight);
 const engine=new BrowserRepair({margin:0}),f=fixture(5);engine.globalOverlay=model;
 assert.equal(engine.process(f.data,w,h,{x:tight.x/w,y:tight.y/h,w:tight.w/w,h:tight.h/h}).method,'deblend');
 assert.equal(model.recover(f.data,w,h,{...model.r,x:model.r.x+1}),null);
 assert.deepEqual(paddedOverlayRect({x:0,y:0,w:15,h:15},20,20),{x:0,y:0,w:20,h:20});
});

function texturedCalibration(n,gradient=false){
 const f=fixture(n);
 for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++){
  const j=(y*w+x)*4,d=Math.abs(x-60)+Math.abs(y-51),a=Math.min(.3,Math.max(0,(13-d)*.15))*(gradient?1+.3*(x-60)/13:1);
  const noise=gradient?0:2.5*Math.sin(x*.31+(n<4?y*.17:-y*.29));
  for(let c=0;c<3;c++){const clean=f.clean[j+c]+noise*[1,-1,.5][c];f.clean[j+c]=clean;f.data[j+c]=clean*(1-a)+255*a;}
 }return f;
}
test('background texture that does not repeat across scenes cannot become a fixed opacity blotch',()=>{
 const current=new OverlayCalibrator(r),previous=new PreviousCalibrator(r);
 for(let n=0;n<8;n++){const f=texturedCalibration(n);current.observe(f.data,w,h,n);previous.observe(f.data,w,h,n);}
 const a=current.finalize(),b=previous.finalize();assert(a&&b);assert(a.info.coreRegularizedPixels>0);assert(a.info.coreCrossSceneCorrelation<.3);
 let after=0,before=0;
 for(const n of [1,5,12]){
  const f=fixture(n),x=f.data.slice(),y=f.data.slice();a.resetFrameState();b.resetFrameState();assert(a.recover(x,w,h,r));assert(b.recover(y,w,h,r));
  for(let yy=0;yy<r.h;yy++)for(let xx=0;xx<r.w;xx++)if(a.core[yy*r.w+xx])for(let c=0;c<3;c++){const j=((yy+r.y)*w+xx+r.x)*4+c;after+=Math.abs(x[j]-f.clean[j]);before+=Math.abs(y[j]-f.clean[j]);}
 }assert(after<before*.9,`${after} versus ${before}`);
});
test('real opacity gradients repeating across independent backgrounds are retained',()=>{
 const current=new OverlayCalibrator(r);for(let n=0;n<8;n++){const f=texturedCalibration(n,true);current.observe(f.data,w,h,n);}
 const model=current.finalize();assert(model);assert(model.info.coreCrossSceneCorrelation>.75);assert.equal(model.info.coreRegularizedPixels,0);
 const values=[...model.alpha].filter((v,i)=>model.core[i]);assert(Math.max(...values)-Math.min(...values)>.025);
});

function plateauFixture(edge,deep){
 const w=26,h=26,core=new Uint8Array(w*h),alpha=new Float32Array(w*h);
 for(let y=4;y<22;y++)for(let x=4;x<22;x++){const i=y*w+x;core[i]=1;alpha[i]=x>=7&&x<19&&y>=7&&y<19?deep:edge;}
 const candidates=Array.from({length:4},(_,n)=>({mean:[n<2?n:50+n,0,0],weight:1,valid:new Uint8Array(w*h).fill(1),alpha:Float32Array.from(alpha,(v,i)=>v? .3+.01*Math.sin((n<2?i%w:Math.floor(i/w))*.7):0)}));
 return {w,h,core,alpha,candidates};
}
test('fading-edge bias uses a stable deep plateau without assuming a fixed opacity',()=>{
 for(const [edge,deep]of [[.29,.3],[.235,.25],[.48,.5]]){
  const f=plateauFixture(edge,deep),result=regularizeCore(f.alpha,f.core,f.candidates,f.w,f.h);
  assert(result.interiorQualified);assert(Math.abs(result.plateau-deep)<1e-6);
  for(let i=0;i<f.alpha.length;i++)if(!f.core[i])assert.equal(f.alpha[i],0);
 }
});
test('interior calibration rejects noise-sized, downward and excessive shifts',()=>{
 for(const [edge,deep]of [[.3,.301],[.3,.29],[.3,.36]]){
  const f=plateauFixture(edge,deep),result=regularizeCore(f.alpha,f.core,f.candidates,f.w,f.h);
  assert.equal(result.interiorQualified,false);assert(Math.abs(result.plateau-edge)<1e-6);
 }
 const unstable=plateauFixture(.29,.31);
 for(let y=7;y<19;y++)for(let x=7;x<19;x++)unstable.alpha[y*unstable.w+x]=(x+y)%2?.26:.31;
 assert.equal(regularizeCore(unstable.alpha,unstable.core,unstable.candidates,unstable.w,unstable.h).interiorQualified,false);
 const narrow=plateauFixture(.29,.3);
 for(let y=0;y<narrow.h;y++)for(let x=0;x<narrow.w;x++)if(x<9||x>=17||y<9||y>=17){narrow.core[y*narrow.w+x]=0;narrow.alpha[y*narrow.w+x]=0;}
 assert.equal(regularizeCore(narrow.alpha,narrow.core,narrow.candidates,narrow.w,narrow.h).interiorQualified,false);
});

test('uncertain fixed-mark motion frames preserve detail rather than repaint a rectangle',()=>{
 const model=calibrate(),engine=new BrowserRepair({mode:'motion',margin:0,radius:8});engine.globalOverlay=model;
 const absent=fixture(7,{mark:false}),before=absent.data.slice(),result=engine.process(absent.data,w,h,box);
 assert.equal(result.method,'uncertain · preserved');assert.deepEqual(absent.data,before);
 assert.deepEqual(engine.history[0].data,before);assert(engine.history[0].overlaySupport.some(v=>v));
 assert.equal(engine.report().uncertainOverlayFrames,1);assert.equal(engine.report().globalRejectedFrames,1);
 const report=engine.report();assert.equal(report.selected,report.preserved+report.decomposed+report.temporal+report.pattern+report.lighting+report.fallback);
 const present=fixture(5);assert.match(engine.process(present.data,w,h,box).method,/deblend/);assert.equal(engine.report().globalInverseFrames,1);
 const uncertain=fixture(5),original=uncertain.data.slice();model.evidence=()=>false;
 assert.equal(engine.process(uncertain.data,w,h,box).method,'bounded contour fill');
 let changed=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const local=x>=r.x&&y>=r.y&&x<r.x+r.w&&y<r.y+r.h?(y-r.y)*r.w+x-r.x:-1,j=(y*w+x)*4;
  const supported=local>=0&&(model.core[local]||model.band[local]);
  for(let c=0;c<4;c++){if(!supported||c===3)assert.equal(uncertain.data[j+c],original[j+c]);else changed+=uncertain.data[j+c]!==original[j+c];}
 }assert(changed>0);assert.equal(engine.report().boundedOverlayFrames,1);
 const boundedReport=engine.report();assert.equal(boundedReport.selected,boundedReport.preserved+boundedReport.decomposed+boundedReport.temporal+boundedReport.pattern+boundedReport.lighting+boundedReport.fallback);
 const moved=fixture(5),other={...box,x:box.x+.15};assert.notEqual(engine.process(moved.data,w,h,other).method,'uncertain · preserved');
 engine.dispose();
});

test('optional tangent calibration preserves the opacity model and releases bounded original samples',()=>{
 const plain=new SelectionOverlayCalibrator(r,w,h),guided=new SelectionOverlayCalibrator(r,w,h,{tangents:true});
 for(let n=0;n<8;n++){const f=fixture(n);plain.observe(f.data,w,h,n);guided.observe(f.data,w,h,n);}
 assert.equal(guided.normalSamples.length,8);assert(guided.normalSamples.reduce((s,f)=>s+f.data.byteLength,0)<4*1024*1024);
 const before=plain.finalize(),after=guided.finalize();assert(before&&after);assert.deepEqual(after.alpha,before.alpha);assert.deepEqual(after.core,before.core);assert.deepEqual(after.band,before.band);assert.equal(guided.normalSamples.length,0);
 const absent=new SelectionOverlayCalibrator(r,w,h,{tangents:true});for(let n=0;n<8;n++)absent.observe(fixture(n,{mark:false}).data,w,h,n);assert.equal(absent.finalize(),null);assert.equal(absent.normalSamples.length,0);
 const large=new SelectionOverlayCalibrator({x:0,y:0,w:140,h:80},160,100,{tangents:true});assert.equal(large.captureTangents,false);
});
