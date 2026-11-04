import test from 'node:test';import assert from 'node:assert/strict';
import {prepareRepair} from '../src/prepare.js';import {BrowserRepair} from '../src/repair.js';
const w=160,h=100,box={x:.3,y:.25,w:.25,h:.5};
function frame(detail=0){
 const clean=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4,v=170+x*.05+y*.03;clean.set([v-10,v,v+10,255],i);
  if(Math.abs(x-68)+Math.abs(y-50)<9)for(let c=0;c<3;c++)clean[i+c]+=detail;
 }
 const data=clean.slice();for(let y=25;y<75;y++)for(let x=48;x<88;x++)if(Math.abs(x-68)+Math.abs(y-50)<13)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;data[i]=data[i]*.65+255*.35;}
 return {clean,data,width:w,height:h};
}
test('bounded preparation improves the first output frame without importing future donor history',async()=>{
 const engine=new BrowserRepair(),cold=new BrowserRepair(),closed=[];let returned=false;
 async function* samples(){try{for(let n=0;n<30;n++)yield {timestamp:10+n/24,n,close(){closed.push(n);}};}finally{returned=true;}}
 const times=[];
 const count=await prepareRepair(engine,samples(),s=>frame(s.n%2?3:-3),time=>{times.push(time);return box;});
 assert.equal(count,12);assert.equal(closed.length,12);assert(returned);assert.equal(engine.history.length,0);assert.equal(engine.hint,null);assert.equal(engine.maskState,null);assert.equal(engine.report().frames,0);assert.equal(engine.report().selected,0);assert(times[0]===10);
 const first=frame(3),baseline=first.data.slice();engine.process(first.data,w,h,box);cold.process(baseline,w,h,box);
 let improved=0,previous=0,counted=0;for(let y=44;y<56;y++)for(let x=62;x<74;x++)if(Math.abs(x-68)+Math.abs(y-50)<6)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;improved+=Math.abs(first.data[i]-first.clean[i]);previous+=Math.abs(baseline[i]-first.clean[i]);counted++;}
 assert(improved<previous*.5,`first frame error ${improved/counted} versus ${previous/counted}`);assert.equal(engine.report().frames,1);assert.equal(engine.report().preparedFrames,12);assert.equal(engine.history.length,1);
});
test('short clips keep their bounded unready calibration and can still export from frame one',async()=>{
 const engine=new BrowserRepair();let closed=0;
 async function* samples(){for(let n=0;n<4;n++)yield {timestamp:n/24,close(){closed++;}};}
 assert.equal(await prepareRepair(engine,samples(),()=>frame(),()=>box),4);assert.equal(closed,4);
 const first=frame();engine.process(first.data,w,h,box);assert.equal(engine.report().frames,1);assert.equal(engine.report().inverseRecoveredPixels,0);
});
test('analysis closes the active decoded frame and iterator if reading fails',async()=>{
 let closed=false,returned=false;
 async function* samples(){try{yield {timestamp:0,close(){closed=true;}};}finally{returned=true;}}
 await assert.rejects(()=>prepareRepair(new BrowserRepair(),samples(),()=>{throw Error('decode failed');},()=>box),/decode failed/);assert(closed);assert(returned);
});
