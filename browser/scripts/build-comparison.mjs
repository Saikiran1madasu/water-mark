// Packaging only: these inputs are already exported by the browser engine.
import {spawnSync} from 'node:child_process';
for(const previous of [false,true]){
  const result=spawnSync('ffmpeg',['-v','error','-y','-i','public/examples/pattern-lighting.mp4','-i',`public/examples/pattern-lighting-${previous?'previous':'repaired'}.mp4`,'-i','public/examples/pattern-lighting-clean.mp4','-filter_complex','[0:v][1:v][2:v]hstack=inputs=3[v]','-map','[v]','-an','-c:v','libx264','-crf','10','-preset','medium','-g','24','-movflags','+faststart',`public/examples/pattern-lighting-comparison${previous?'-previous':''}.mp4`],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
