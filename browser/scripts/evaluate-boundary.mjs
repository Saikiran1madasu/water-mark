// Development-only: independently decode fixtures to compare engine revisions.
import {spawnSync} from 'node:child_process';import fs from 'node:fs';
import {BrowserRepair as Current} from '../src/repair.js';
import {BrowserRepair as Previous} from '../reference/browser-before-boundary/repair.js';
const decode=file=>{const p=spawnSync('ffmpeg',['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgba','-'],{maxBuffer:1024**3});if(p.status)throw Error(p.stderr.toString());return p.stdout;};
const w=640,h=360,size=w*h*4,box={x:538/w,y:265/h,w:44/w,h:50/h};
const input=decode('public/examples/pattern-lighting.mp4'),clean=decode('public/examples/pattern-lighting-clean.mp4'),report={};
for(const [name,Engine] of [['before',Previous],['after',Current]]){
 const engine=new Engine({mode:'detail',radius:8,margin:3});let error=0,temporal=0,last=null,count=0;
 for(let n=0;n<input.length/size;n++){
  const data=new Uint8ClampedArray(input.subarray(n*size,(n+1)*size));engine.process(data,w,h,box);const residual=[];
  for(let y=265;y<315;y++)for(let x=538;x<582;x++)for(let c=0;c<3;c++){const i=(y*w+x)*4+c,d=data[i]-clean[n*size+i];error+=Math.abs(d);residual.push(d);count++;}
  if(last)for(let i=0;i<last.length;i++)temporal+=Math.abs(residual[i]-last[i]);last=residual;
 }
 report[name]={regionMAE:error/count,temporalResidualMAE:temporal/(count-last.length),stats:engine.report()};
}
fs.writeFileSync('.runtime/boundary-metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
