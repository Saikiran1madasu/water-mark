import test from 'node:test';import assert from 'node:assert/strict';
import {TransparencyModel} from '../src/transparency.js';
import {BrowserRepair} from '../src/repair.js';
function fixture(opacity=.35){const w=32,r={x:0,y:0,w:32,h:32},plate=new Uint8ClampedArray(w*w*4),data=new Uint8ClampedArray(plate.length),alpha=new Float32Array(w*w);for(let y=0;y<w;y++)for(let x=0;x<w;x++){const i=y*w+x,v=160+x*.4+y*.15;plate.set([v-12,v,v+10,255],i*4);data.set(plate.subarray(i*4,i*4+4),i*4);if(Math.abs(x-16)+Math.abs(y-16)<10){alpha[i]=1;for(let c=0;c<3;c++)data[i*4+c]=data[i*4+c]*(1-opacity)+255*opacity;}}return {w,r,plate,data,shape:{alpha,level:255}};}
test('calibrated transparency recovers current hidden detail rather than painting its estimate',()=>{
 const model=new TransparencyModel(),f=fixture();for(let n=0;n<16;n++)model.learn(f.data,f.w,f.r,f.plate,f.shape);
 const data=f.data.slice(),clean=f.plate.slice();let paintedError=0;
 for(let i=0;i<f.shape.alpha.length;i++)if(f.shape.alpha[i])for(let c=0;c<3;c++){const detail=3*Math.sin(i*.7);clean[i*4+c]+=detail;data[i*4+c]=clean[i*4+c]*.65+255*.35;paintedError+=Math.abs(clean[i*4+c]-f.plate[i*4+c]);}
 const result=model.recover(data,f.w,f.r,f.plate,f.shape);assert(result.pixels>100);let recoveredError=0;
 for(let i=0;i<f.shape.alpha.length;i++)if(f.shape.alpha[i])for(let c=0;c<3;c++)recoveredError+=Math.abs(clean[i*4+c]-result.plate[i*4+c]);
 assert(recoveredError<paintedError*.4);
});
test('opaque marks, inconsistent new scenes and moving selections cannot use inversion',()=>{
 for(const opacity of [1,.35]){const model=new TransparencyModel(),f=fixture(opacity);for(let n=0;n<16;n++)model.learn(f.data,f.w,f.r,f.plate,f.shape);
  if(opacity===1)assert.equal(model.recover(f.data,f.w,f.r,f.plate,f.shape).pixels,0);
  assert.equal(model.recover(f.data,f.w,{...f.r,x:1},f.plate,f.shape).pixels,0);
  assert.equal(model.recover(new Uint8ClampedArray(f.data.length),f.w,f.r,f.plate,f.shape).pixels,0);
  assert.equal(model.recover(f.data,f.w,f.r,f.plate,null).pixels,0);
 }
});
test('a few high-contrast observations cannot masquerade as twelve reliable calibration frames',()=>{
 const model=new TransparencyModel(),opaque=fixture(1),translucent=fixture(.35);
 for(let n=0;n<11;n++)model.learn(opaque.data,opaque.w,opaque.r,opaque.plate,opaque.shape);
 model.learn(translucent.data,translucent.w,translucent.r,translucent.plate,translucent.shape);
 assert.equal(model.recover(translucent.data,translucent.w,translucent.r,translucent.plate,translucent.shape).pixels,0);
});
test('current logo edges retain the outline through a lighting change without reusing painted pixels',()=>{
 const model=new TransparencyModel(),f=fixture();for(let n=0;n<12;n++)model.learn(f.data,f.w,f.r,f.plate,f.shape);
 const data=f.data.slice();
 for(let i=0;i<f.shape.alpha.length;i++)for(let c=0;c<3;c++){
  const background=f.plate[i*4+c]-35;
  data[i*4+c]=f.shape.alpha[i]?background*.65+255*.35:background;
 }
 assert.equal(model.confirmFootprint(data,f.w,f.r,f.plate),f.shape);
 const clean=data.slice();for(let i=0;i<f.shape.alpha.length;i++)for(let c=0;c<3;c++)clean[i*4+c]=f.plate[i*4+c]-35;
 assert.equal(model.confirmFootprint(clean,f.w,f.r,f.plate),null,'a disappeared watermark must not retain its mask');
 assert.equal(model.confirmFootprint(data,f.w,{...f.r,x:1},f.plate),null,'changed selections invalidate the signature');
});
test('a shifted logo or unrelated strong background edge cannot validate stale geometry',()=>{
 const model=new TransparencyModel(),f=fixture();for(let n=0;n<12;n++)model.learn(f.data,f.w,f.r,f.plate,f.shape);
 for(const shifted of [true,false]){
  const data=f.plate.slice();for(let y=0;y<32;y++)for(let x=0;x<32;x++)for(let c=0;c<3;c++){
   const i=(y*32+x)*4+c;
   if(shifted&&Math.abs(x-21)+Math.abs(y-16)<10)data[i]=data[i]*.65+255*.35;
   if(!shifted&&x>y)data[i]-=50;
  }
  assert.equal(model.confirmFootprint(data,f.w,f.r,f.plate),null);
 }
});
test('full engine preserves new background detail visible through a translucent logo',()=>{
 const w=160,h=100,box={x:.3,y:.25,w:.25,h:.5},engine=new BrowserRepair({margin:3});let clean,data;
 for(let frame=0;frame<40;frame++){
  clean=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=170+x*.05+y*.03,i=(y*w+x)*4;clean.set([v-10,v,v+10,255],i);if(frame>=16&&Math.abs(x-68)+Math.abs(y-50)<9)for(let c=0;c<3;c++)clean[i+c]+=3;}
  data=clean.slice();for(let y=25;y<75;y++)for(let x=48;x<88;x++)if(Math.abs(x-68)+Math.abs(y-50)<13)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;data[i]=data[i]*.65+255*.35;}
  engine.process(data,w,h,box);
 }
 assert(engine.report().inverseRecoveredPixels>0);let error=0,count=0;
 for(let y=43;y<57;y++)for(let x=61;x<75;x++)if(Math.abs(x-68)+Math.abs(y-50)<7)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;error+=Math.abs(data[i]-clean[i]);count++;}
 assert(error/count<1,'hidden changing detail should be recovered from the translucent input');
});
