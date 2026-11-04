// A known-clean changing-detail fixture. Neither engine receives the reference.
import fs from 'node:fs';
import {BrowserRepair as Current} from '../src/repair.js';
import {BrowserRepair as Previous} from '../reference/browser-before-boundary/repair.js';
const w=160,h=100,box={x:.3,y:.25,w:.25,h:.5},report={};
for(const [name,Engine] of [['before',Previous],['after',Current]]){
 const engine=new Engine({margin:3});let error=0,count=0;
 for(let frame=0;frame<24;frame++){
  const clean=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const v=170+x*.05+y*.03,i=(y*w+x)*4;clean.set([v-10,v,v+10,255],i);
   if(frame>=16&&Math.abs(x-68)+Math.abs(y-50)<9)for(let c=0;c<3;c++)clean[i+c]+=3;
  }
  const data=clean.slice();
  for(let y=25;y<75;y++)for(let x=48;x<88;x++)if(Math.abs(x-68)+Math.abs(y-50)<13)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;data[i]=data[i]*.65+255*.35;}
  engine.process(data,w,h,box);
  if(frame>=16)for(let y=43;y<57;y++)for(let x=61;x<75;x++)if(Math.abs(x-68)+Math.abs(y-50)<7)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;error+=Math.abs(data[i]-clean[i]);count++;}
 }
 report[name]={hiddenChangingDetailMAE:error/count,stats:engine.report()};
}
fs.writeFileSync('.runtime/transparency-detail-metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
