import test from 'node:test';import assert from 'node:assert/strict';
import {BrowserRepair} from '../src/repair.js';
import {BrowserRepair as Previous} from '../reference/browser-before-edge-validation/repair.js';
test('changing shadows preserve clean pixels around the logo instead of repainting a whole box',()=>{
 const w=160,h=100,box={x:.3,y:.25,w:.25,h:.5},current=new BrowserRepair(),previous=new Previous();let clean,result,baseline,observed;
 for(let n=0;n<16;n++){
  clean=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=170+x*.05+y*.03-(n>=12?45*Math.exp(-((x-59)**2/100+(y-48)**2/450)):0);clean.set([v-10,v,v+10,255],i);}
  observed=clean.slice();for(let y=25;y<75;y++)for(let x=48;x<88;x++)if(Math.abs(x-68)+Math.abs(y-50)<13)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;observed[i]=observed[i]*.65+255*.35;}
  result=observed.slice();baseline=observed.slice();current.process(result,w,h,box);previous.process(baseline,w,h,box);
 }
 let after=0,before=0;
 for(let y=22;y<78;y++)for(let x=45;x<91;x++)if(Math.abs(x-68)+Math.abs(y-50)>=22)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;after+=Math.abs(result[i]-clean[i]);before+=Math.abs(baseline[i]-clean[i]);}
 assert(before>100);assert(after<before*.25,'clean surrounding pixels should no longer be flattened into a patch');
 assert(result[(50*w+68)*4]<observed[(50*w+68)*4]-10,'the actual logo still needs removal');
 assert(current.report().contourFillFrames>=1);assert.equal(current.report().inverseRecoveredPixels,0,'geometry-only evidence must not enable opacity inversion');
 const stats=current.report();assert.equal(stats.selected,stats.preserved+stats.pattern+stats.lighting+stats.temporal+stats.fallback);
});
