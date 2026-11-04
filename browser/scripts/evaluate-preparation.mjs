// Known-clean startup fixture; the clean pixels are only used for scoring.
import fs from 'node:fs';import {BrowserRepair} from '../src/repair.js';import {prepareRepair} from '../src/prepare.js';
const w=160,h=100,box={x:.3,y:.25,w:.25,h:.5};
function frame(n){
 const clean=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=170+x*.05+y*.03,i=(y*w+x)*4;clean.set([v-10,v,v+10,255],i);if(Math.abs(x-68)+Math.abs(y-50)<9)for(let c=0;c<3;c++)clean[i+c]+=n%2?3:-3;}
 const data=clean.slice();for(let y=25;y<75;y++)for(let x=48;x<88;x++)if(Math.abs(x-68)+Math.abs(y-50)<13)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;data[i]=data[i]*.65+255*.35;}
 return {data,clean,width:w,height:h};
}
const report={};
for(const warm of [false,true]){
 const engine=new BrowserRepair();
 if(warm){async function* samples(){for(let n=0;n<12;n++)yield {timestamp:n/24,n,close(){}};}await prepareRepair(engine,samples(),s=>frame(s.n),()=>box);}
 let error=0,count=0;
 for(let n=0;n<12;n++){const f=frame(n);engine.process(f.data,w,h,box);for(let y=44;y<56;y++)for(let x=62;x<74;x++)if(Math.abs(x-68)+Math.abs(y-50)<6)for(let c=0;c<3;c++){const i=(y*w+x)*4+c;error+=Math.abs(f.data[i]-f.clean[i]);count++;}}
 report[warm?'prepared':'cold']={firstTwelveFramesMAE:error/count,stats:engine.report()};
}
fs.writeFileSync('.runtime/preparation-metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
