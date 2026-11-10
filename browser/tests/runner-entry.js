import {Input,ALL_FORMATS,BlobSource,VideoSampleSink} from 'mediabunny';
const status=document.querySelector('#status'),outputs=document.querySelector('#outputs');
function assert(ok,message){if(!ok)throw Error(message);}
async function inspect(blob){const input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});try{const track=await input.getPrimaryVideoTrack(),audio=await input.getAudioTracks(),timestamps=[];for await(const sample of new VideoSampleSink(track).samples()){timestamps.push(sample.timestamp);sample.close();}return {width:track.displayWidth,height:track.displayHeight,audio:audio.length,frames:timestamps.length,timestamps,duration:await input.computeDuration()};}finally{input.dispose();}}
async function process(file,box,extra={}){const worker=new Worker(extra.previous?'/__test__/worker-before.js':'/browser-worker.js',{type:'module'});try{return await new Promise((resolve,reject)=>{worker.onerror=()=>reject(Error('Worker failed'));worker.onmessage=({data})=>{if(data.type==='progress')status.textContent=`Processing ${file.name}: ${data.frames} frames`;if(data.type==='error')reject(Error(data.message));if(data.type==='complete')resolve(data);};worker.postMessage({type:'process',file,box,options:{mode:'detail',radius:8,margin:3,quality:'high'},...extra});});}finally{worker.terminate();}}
function auditPlayback(player){
 const node=document.createElement('pre');node.id='playback-audit';node.textContent='Play the full diagnostic video to audit presentation.';outputs.append(node);
 const times=[];let seeks=0,waiting=0,handle=null;
 player.addEventListener('seeking',()=>seeks++);player.addEventListener('waiting',()=>{if(!player.paused)waiting++;});
 if(typeof player.requestVideoFrameCallback==='function'){
  const observe=(_,metadata)=>{if(!player.paused)times.push(metadata.mediaTime);if(!player.ended)handle=player.requestVideoFrameCallback(observe);};handle=player.requestVideoFrameCallback(observe);
 }
 player.addEventListener('ended',()=>{
  if(handle!==null)player.cancelVideoFrameCallback(handle);
  const q=typeof player.getVideoPlaybackQuality==='function'?player.getVideoPlaybackQuality():null;
  const repeated=times.filter((t,i)=>i&&Math.abs(t-times[i-1])<.000001).length,backward=times.flatMap((t,i)=>i&&t<times[i-1]-.000001?[{previous:times[i-1],current:t}]:[]);
  node.textContent=JSON.stringify({ended:player.ended,time:player.currentTime,duration:player.duration,seeks,waitingEvents:waiting,presentedCallbacks:times.length,repeatedFrameCallbacks:repeated,backwardFrameCallbacks:backward,mediaTimesNondecreasing:backward.length===0,decoderQuality:q?{total:q.totalVideoFrames,dropped:q.droppedVideoFrames,corrupted:q.corruptedVideoFrames}:null},null,2);
 });
}
function show(name,result){const blob=new Blob([result.buffer],{type:result.mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name+'.'+result.extension;a.textContent='Download '+name;outputs.append(a);if(name.startsWith('Diagnostic')){const player=document.createElement('video');player.controls=true;player.src=url;player.setAttribute('aria-label','Repaired diagnostic video');outputs.append(player);auditPlayback(player);}return blob;}
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;outputs.replaceChildren();
 try{
  const example=new File([await(await fetch('/examples/pattern-lighting.mp4')).blob()],'pattern-lighting.mp4',{type:'video/mp4'}),exampleBox={x:538/640,y:265/360,w:44/640,h:50/360};
  show('pattern-lighting-repaired',await process(example,exampleBox));

  const fixture=new File([await(await fetch('/__test__/timing-audio.mp4')).blob()],'timing-audio.mp4',{type:'video/mp4'}),box={x:144/320,y:74/180,w:24/320,h:26/180};
  const source=await inspect(fixture),full=await process(fixture,box),actual=await inspect(show('browser-audio-timing',full));
  assert(source.frames===actual.frames,'Frame count changed');assert(source.audio===actual.audio,'Audio track lost');assert(source.width===actual.width&&source.height===actual.height,'Dimensions changed');
  assert(full.stats.preparedFrames===12,'Full export did not prepare its bounded calibration');
  const maxTimestampError=Math.max(...source.timestamps.map((t,i)=>Math.abs((t-source.timestamps[0])-(actual.timestamps[i]-actual.timestamps[0]))));
  assert(maxTimestampError<.002,'Frame timestamp mismatch');
  const preview=await process(fixture,box,{preview:true,previewStart:1,keys:[{time:0,box},{time:2,box:{...box,x:.5}}]}),previewMeta=await inspect(show('browser-trimmed-preview',preview));
  assert(previewMeta.duration>=2.9&&previewMeta.duration<=3.15,'Preview duration mismatch');assert(previewMeta.audio===source.audio,'Preview audio lost');
  assert(preview.stats.preparedFrames===12,'Offset preview did not analyze source-timeline frames');
  const real=new File([await(await fetch('/__test__/real.mp4')).blob()],'diagnostic.mp4',{type:'video/mp4'}),realInput=await inspect(real),result=await process(real,{x:1128/1280,y:568/720,w:64/1280,h:68/720}),realOutput=await inspect(show('Diagnostic-browser-rebuilt',result));
  assert(realInput.frames===realOutput.frames,'Diagnostic frames lost');assert(realInput.audio===realOutput.audio,'Diagnostic audio lost');
  const report={status:'PASS',fixture:{frames:actual.frames,audio:actual.audio,maxTimestampError,preparedFrames:full.stats.preparedFrames},preview:{frames:previewMeta.frames,audio:previewMeta.audio,duration:previewMeta.duration,preparedFrames:preview.stats.preparedFrames},diagnostic:{...realOutput,timestamps:undefined,stats:result.stats}};
  if(result.buffer.byteLength>64*1024*1024)throw Error('The local review export exceeds the 64 MB test-save limit. Download it from the link instead.');
  const savedVideo=await fetch('/__test__/save-export',{method:'POST',headers:{'Content-Type':result.mime},body:result.buffer});assert(savedVideo.ok,'Could not save the browser export locally');
  const savedReport=await fetch('/__test__/save-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});assert(savedReport.ok,'Could not save the browser verification report locally');
  const json=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(json);a.download='browser-verification.json';a.textContent='Download verification report';outputs.append(a);
  status.textContent='PASS · Browser export and report saved locally for review.\n'+JSON.stringify(report,null,2);
 }catch(error){
  const report={status:'FAIL',message:error.message};
  status.textContent='FAIL: '+error.message;
  try{await fetch('/__test__/save-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});}catch{}
 }
 finally{document.querySelector('#run').disabled=false;}
};
