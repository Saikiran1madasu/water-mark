// Local diagnostic only: stream original frames, record method/mask transitions.
import {spawn} from 'node:child_process';import fs from 'node:fs';
import {BrowserRepair} from '../src/repair.js';
const file=process.argv[2];if(!file)throw Error('Provide a local 1280x720 diagnostic clip.');
const w=1280,h=720,size=w*h*4,box={x:1128/w,y:568/h,w:64/w,h:68/h};
const decoder=spawn('ffmpeg',['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgba','pipe:1']);
let bytes=0,n=0,buffer=Buffer.alloc(size),engine=new BrowserRepair({mode:'detail',radius:8,margin:3}),report=[];
const first=[];
let evidence=null;const confirm=engine.transparency.confirmFootprint.bind(engine.transparency);engine.transparency.confirmFootprint=(...args)=>confirm(...args,value=>{evidence=value;});
for await(const chunk of decoder.stdout){
 let offset=0;while(offset<chunk.length){const count=Math.min(size-bytes,chunk.length-offset);chunk.copy(buffer,bytes,offset,offset+count);offset+=count;bytes+=count;if(bytes<size)continue;
  if(n<12)first.push(new Uint8ClampedArray(buffer));
  if(n===11){for(const f of first)engine.process(f.slice(),w,h,box);engine.beginOutput(12);}
  // Replay the analysis frames as output only after calibration completes.
  const frames=n===11?first:n<11?[]:[new Uint8ClampedArray(buffer)];
  for(const data of frames){evidence=null;const old={...engine.stats},result=engine.process(data,w,h,box);report.push({frame:report.length,method:result.method,mask:engine.maskState?.shape.modified??null,donor:engine.hint,held:engine.stats.stableMaskFrames-old.stableMaskFrames,inverse:engine.stats.inverseRecoveredPixels-old.inverseRecoveredPixels,reset:engine.stats.sceneResets-old.sceneResets,preserved:result.preserved,recovered:result.recovered,evidence});}
  n++;bytes=0;
 }
}
fs.writeFileSync('.runtime/method-trace.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.slice(-30),null,2));
