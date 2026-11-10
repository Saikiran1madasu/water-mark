import {initExamplePlayer} from './example-player.js';
import {coordinatePlayback} from './playback.js';
// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
const $=id=>document.getElementById(id), video=$('source-video'), canvas=$('selection'), ctx=canvas.getContext('2d');
const requestedMode=new URL(window.location.href).searchParams.get('mode');
if(['detail','seamless','balanced','own','motion','restore'].includes(requestedMode))$('repair-mode').value=requestedMode;
let jobWorker=null,cancelJob=null;
const createWorker=()=>new Worker(new URL('./browser-worker.js?v=0.6.3',import.meta.url),{type:'module'});
let uploadLimit=200*1024*1024;
let file=null,objectURL=null,box=null,anchor=null,available=false,busy=false,loaded=false;let maskKeys=[];let examplePending=false;const exports=[];
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6500);}
function tab(name){for(const id of ['studio','projects','guide'])$(id).hidden=id!==name;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$('crumb').textContent={studio:'Cleanup studio',projects:'My exports',guide:'Quick guide'}[name];}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));$('help').onclick=()=>tab('guide');$('new-project').onclick=()=>{tab('studio');if(busy)return toast('Please wait for the current export to finish.');$('file-input').click();};
async function health(){
  available=false;
  $('processing-location').textContent='Private · on your device';
  $('engine-offline').hidden=true;$('connection-banner').hidden=true;
  const probe=createWorker();
  const timer=setTimeout(()=>{probe.terminate();$('engine-offline').hidden=false;$('engine-error').textContent='The browser engine could not start. Refresh this page in Chrome or Edge.';},15000);
  probe.onmessage=({data})=>{if(data.type!=='capabilities')return;clearTimeout(timer);available=data.supported;$('engine-status').textContent=available?'● Browser engine ready':'○ Browser unsupported';$('engine-offline').hidden=available;$('engine-error').textContent=data.reason||'';probe.terminate();update();};
  probe.onerror=()=>{clearTimeout(timer);probe.terminate();available=false;$('engine-offline').hidden=false;$('engine-error').textContent='Could not load the browser engine. Refresh the page and try again.';update();};
  probe.postMessage({type:'capabilities'});
}
health();
function update(){for(const id of ['example-play','example-version','example-seek'])$(id).disabled=busy;for(const id of ['play','seek','fullscreen'])$(id).disabled=!loaded||busy;$('remove').disabled=!available||!loaded||!box||busy;$('preview').disabled=$('remove').disabled;$('full-export').disabled=$('remove').disabled;$('repair-mode').disabled=busy;$('load-example').disabled=busy;$('clear').disabled=!box||busy;$('replace').disabled=busy;$('quality').disabled=busy;$('context-radius').disabled=busy;$('mask-margin').disabled=busy;$('mask-mode').disabled=busy;$('add-keyframe').disabled=busy||!box;document.querySelectorAll('#keyframe-list button').forEach(b=>b.disabled=busy);$('action-hint').textContent=busy?'Processing privately on your device · keep this tab open':!file?'Upload a video to get started':!loaded?'Loading video…':!box?'Select the watermark to continue':!available?'Use a browser with supported video processing':'Your original file stays untouched';$('selection-count').textContent=box?($('mask-mode').value==='keyframed'?maskKeys.length+(maskKeys.length===1?' position':' positions'):'1 area'):'0 areas';$('selection-empty').hidden=!!box;$('selection-info').hidden=!box;if(box)$('selection-info').textContent=`⌖ Watermark · ${Math.round(box.w*video.videoWidth)} × ${Math.round(box.h*video.videoHeight)} px`;$('step-select').classList.toggle('current',loaded);$('step-export').classList.toggle('current',busy);}
function time(s){if(!Number.isFinite(s))return '00:00';return `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;}
function draw(){const r=canvas.getBoundingClientRect();canvas.width=Math.round(r.width*devicePixelRatio);canvas.height=Math.round(r.height*devicePixelRatio);ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,r.width,r.height);if(!box)return;const x=box.x*r.width,y=box.y*r.height,w=box.w*r.width,h=box.h*r.height;ctx.fillStyle='rgba(201,245,111,.22)';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#c9f56f';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.fillStyle='#fff';for(const [px,py] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]])ctx.fillRect(px-3,py-3,6,6);}
new ResizeObserver(draw).observe($('video-holder'));
function point(e){const r=canvas.getBoundingClientRect();return {x:Math.min(.998,Math.max(.002,(e.clientX-r.left)/r.width)),y:Math.min(.998,Math.max(.002,(e.clientY-r.top)/r.height))};}
canvas.onpointerdown=e=>{if(!loaded||busy)return;video.pause();anchor=point(e);canvas.setPointerCapture(e.pointerId);$('selection-tip').hidden=true;};
canvas.onpointermove=e=>{if(!anchor)return;const p=point(e);box={x:Math.min(anchor.x,p.x),y:Math.min(anchor.y,p.y),w:Math.abs(p.x-anchor.x),h:Math.abs(p.y-anchor.y)};draw();};
function finish(){if(!anchor)return;anchor=null;if(!box||box.w*video.videoWidth<4||box.h*video.videoHeight<4)box=null;if(box&&$('mask-mode').value==='keyframed')saveKey();draw();update();}canvas.onpointerup=finish;canvas.onpointercancel=finish;
$('clear').onclick=()=>{box=null;maskKeys=[];renderKeys();draw();update();$('selection-tip').hidden=false;};
$('browse').onclick=$('replace').onclick=()=>$('file-input').click();$('file-input').onchange=e=>{if(e.target.files[0])load(e.target.files[0]);e.target.value='';};
function load(f){if(busy)return toast('Wait for the current export to finish.');if(f.size>uploadLimit)return toast(`Please choose a video smaller than ${Math.floor(uploadLimit/1024/1024)} MB.`);if(!f.type.startsWith('video/'))return toast('Please choose a video file.');resultVideo.pause();examplePlayer.pause();file=f;loaded=false;box=null;maskKeys=[];renderKeys();video.pause();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=URL.createObjectURL(f);video.src=objectURL;$('upload-view').hidden=true;$('video-holder').hidden=false;$('replace').hidden=false;$('example-note').hidden=!examplePending;$('file-tag').textContent=f.name;$('file-tag').title=f.name;$('result').hidden=true;$('progress-wrap').hidden=true;$('selection-tip').hidden=false;$('resolution').textContent='Reading…';update();}
video.onloadedmetadata=()=>{if(!Number.isFinite(video.duration)||!video.videoWidth){toast('This video cannot be read. Try an MP4 with H.264 video.');return;}loaded=true;if(examplePending){box={x:538/640,y:265/360,w:44/640,h:50/360};examplePending=false;$('selection-tip').hidden=true;}$('duration').textContent=time(video.duration);$('resolution').textContent=`${video.videoWidth} × ${video.videoHeight}`;$('play').disabled=$('seek').disabled=$('fullscreen').disabled=false;draw();update();};video.onerror=()=>{loaded=false;update();toast('Your browser cannot play this video. Try an H.264 MP4.');};video.ontimeupdate=()=>{if($('mask-mode').value==='keyframed'&&maskKeys.length){box=boxAt(video.currentTime);draw();update();}$('current-time').textContent=time(video.currentTime);$('seek').value=video.duration?video.currentTime/video.duration*100:0;};video.onplay=()=>$('play').textContent='Ⅱ';video.onpause=()=>$('play').textContent='▶';$('play').onclick=()=>video.paused?video.play().catch(()=>toast('Playback unavailable.')):video.pause();$('seek').oninput=e=>video.currentTime=Number(e.target.value)*video.duration/100;$('fullscreen').onclick=()=>video.requestFullscreen?.();
const zone=$('drop-zone');zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragging');};zone.ondragleave=()=>zone.classList.remove('dragging');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragging');if(e.dataTransfer.files[0])load(e.dataTransfer.files[0]);};
async function processVideo(preview=false){
  if(!file||!box||busy||!available)return;
  busy=true;video.pause();resultVideo.pause();examplePlayer.pause();update();$('result').hidden=true;$('progress-wrap').hidden=false;$('cancel-processing').hidden=false;$('progress-bar').style.width='0%';$('progress-label').textContent='Reading video on your device…';
  const worker=createWorker();jobWorker=worker;
  try{
    const result=await new Promise((resolve,reject)=>{
      cancelJob=()=>reject(new Error('Processing canceled. Your original video is unchanged.'));
      worker.onerror=()=>reject(new Error('The browser ran out of resources or could not process this video. Try a shorter 720p clip.'));
      worker.onmessage=({data})=>{
        if(data.type==='error')reject(new Error(data.message));
        if(data.type==='progress'){$('progress-bar').style.width=`${Math.round(data.progress*100)}%`;$('progress-label').textContent=data.phase==='model'?(data.label||'Loading our original repair model…'):data.phase==='calibration'?`Studying the watermark across your video · ${data.frames} frames checked`:data.phase==='analysis'?`Analyzing the watermark · ${data.frames} frames checked`:`Repairing in your browser · ${data.frames} frames · ${Math.round(data.progress*100)}%`;}
        if(data.type==='complete')resolve(data);
      };
      worker.postMessage({type:'process',file,box:{...box},keys:$('mask-mode').value==='keyframed'?maskKeys:[],preview,previewStart:video.currentTime,options:{mode:$('repair-mode').value,quality:$('quality').value,radius:Number($('context-radius').value),margin:Number($('mask-margin').value)}});
    });
    const blob=new Blob([result.buffer],{type:result.mime}),url=URL.createObjectURL(blob);
    $('result-video').src=url;$('download').href=url;$('download').download=`msk-browser-v063-${['own','seamless','motion','restore'].includes(result.mode)?result.mode+'-':''}${preview?'preview':'cleaned'}.${result.extension}`;
    $('result').hidden=false;$('full-export').hidden=!preview;$('download').textContent=preview?'↓ Download preview':'↓ Download video';$('result-heading').textContent=preview?'Your browser preview':'Your video is ready to review.';
    $('progress-bar').style.width='100%';$('progress-label').textContent='Export complete · processed on your device';
    const stats=result.stats;const calibration=result.mode==='own'?`Learned corrections accepted on ${stats.ownModelFrames} frames. The original standard repair handles frames where a better learned correction could not be verified.`:stats.globalInverseFrames?`Background recovery used on ${stats.globalInverseFrames} of ${stats.frames} frames.`:'Opacity calibration was unavailable. This export used estimated filling, which can leave a visible patch.';$('repair-report').hidden=false;$('repair-report').textContent=`MSK Browser Repair · 0.6.3 · ${{own:'Own learned repair',motion:'Original motion repair',restore:'Own reconstruction',seamless:'Seamless',detail:'Detail',balanced:'Fast'}[result.mode]??'Detail'} · ${stats.frames} frames · ${stats.preservedCoverage}% of selected pixels preserved · ${stats.temporalCoverage}% recovered from earlier clean frames · ${stats.decomposedCoverage??0}% recovered through an opacity estimate · ${(stats.patternCoverage+stats.lightingCoverage+stats.fallbackCoverage).toFixed(1)}% estimated background. ${calibration} Original-frame motion recovery: ${stats.motionSupportPixels??0} pixels across ${stats.motionSupportFrames??0} frames. ${stats.motionSubpixelFrames?`Fine alignment: ${stats.motionSubpixelPixels} original-pixel contributions across ${stats.motionSubpixelFrames} frames. `:''}Learned RGB cleanup: ${stats.rgbRefinedFrames??0} frames, ${stats.rgbRefinedPixels??0} pixels changed. ${stats.absentOverlayFrames?`${stats.absentOverlayFrames} frames kept their original pixels because the calibrated mark appeared absent. `:''}${stats.boundedOverlayFrames?`${stats.boundedOverlayFrames} uncertain frames used filling limited to the calibrated mark. `:''}${stats.rgbSkippedFrames?`${stats.rgbSkippedFrames} frames skipped learned cleanup. `:''}Tone matching: ${stats.toneMatchedFrames??0} frames. Seamless cleanup: ${stats.structuralCleanupFrames??0} frames. Resolution: ${result.width} × ${result.height}. Review the repair in motion; reconstructed detail is an estimate.`;
    exports.unshift({name:(preview?'Preview · ':'')+file.name,url,downloadName:$('download').download,extension:result.extension,bytes:blob.size});while(exports.length>1&&(exports.length>4||exports.reduce((n,item)=>n+item.bytes,0)>256*1024*1024)){URL.revokeObjectURL(exports.pop().url);}renderExports();$('result').scrollIntoView({behavior:'smooth',block:'center'});toast('Your video is ready. No video was uploaded.');
  }catch(error){$('progress-label').textContent='Export stopped';toast(error.message);}
  finally{worker.terminate();jobWorker=null;cancelJob=null;busy=false;$('cancel-processing').hidden=true;update();}
}
$('cancel-processing').onclick=()=>{jobWorker?.terminate();cancelJob?.();};
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
function renderExports(){$('export-count').textContent=exports.length;const list=$('exports-list');list.replaceChildren();for(const item of exports){const row=document.createElement('div');row.className='export-row';const name=document.createElement('span');name.textContent=item.name;const a=document.createElement('a');a.className='primary';a.textContent='↓ Download';a.href=item.url;a.download=item.downloadName||`msk-browser-v02-cleaned.${item.extension||'mp4'}`;row.append(name,a);list.append(row);}}

function boxAt(t){if(!maskKeys.length)return box;if(t<=maskKeys[0].time)return {...maskKeys[0].box};for(let i=1;i<maskKeys.length;i++){const left=maskKeys[i-1],right=maskKeys[i];if(t<=right.time){const f=(t-left.time)/(right.time-left.time);return Object.fromEntries(['x','y','w','h'].map(k=>[k,left.box[k]*(1-f)+right.box[k]*f]));}}return {...maskKeys[maskKeys.length-1].box};}
function saveKey(){if(!box||busy)return;const t=Math.round(video.currentTime*1000)/1000;const existing=maskKeys.findIndex(k=>Math.abs(k.time-t)<.04);if(existing>=0)maskKeys[existing]={time:t,box:{...box}};else{if(maskKeys.length>=32)return toast('Use up to 32 mask positions. Remove a position before adding another.');maskKeys.push({time:t,box:{...box}});}maskKeys.sort((a,b)=>a.time-b.time);renderKeys();}
function renderKeys(){const list=$('keyframe-list');list.replaceChildren();for(const key of maskKeys){const row=document.createElement('div');row.className='keyframe-row';const seek=document.createElement('button');seek.type='button';seek.textContent=`⌖ ${time(key.time)}.${Math.round((key.time%1)*100).toString().padStart(2,'0')}`;seek.onclick=()=>{if(!busy){video.pause();video.currentTime=key.time;box={...key.box};draw();}};const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remove mask keyframe at ${key.time} seconds`);remove.onclick=()=>{if(busy)return;maskKeys=maskKeys.filter(k=>k!==key);if(!maskKeys.length)box=null;renderKeys();draw();update();};row.append(seek,remove);list.append(row);}}
$('mask-mode').onchange=()=>{$('keyframe-controls').hidden=$('mask-mode').value!=='keyframed';if($('mask-mode').value==='keyframed'&&box&&!maskKeys.length)saveKey();update();};$('add-keyframe').onclick=()=>{saveKey();update();};

$('remove').onclick=()=>processVideo(false);$('preview').onclick=()=>processVideo(true);$('full-export').onclick=()=>processVideo(false);
$('load-example').onclick=async()=>{if(busy)return;try{const r=await fetch('./examples/pattern-lighting.mp4');if(!r.ok)throw Error('Example clip unavailable.');const blob=await r.blob();examplePending=true;load(new File([blob],'MSK-pattern-lighting-example.mp4',{type:'video/mp4'}));toast('Generated pattern and lighting example loaded with a preset selection.');}catch(e){examplePending=false;toast(e.message);}};

$('retry-engine').onclick=health;

const resultVideo=$('result-video');
resultVideo.onloadedmetadata=()=>{$('result-duration').textContent=time(resultVideo.duration);$('result-play').disabled=$('result-seek').disabled=false;};
resultVideo.ontimeupdate=()=>{$('result-current').textContent=time(resultVideo.currentTime);$('result-seek').value=resultVideo.duration?resultVideo.currentTime/resultVideo.duration*100:0;};
resultVideo.onplay=()=>{$('result-play').textContent='Ⅱ';$('result-play').setAttribute('aria-label','Pause preview');};
function resetResultPlay(){$('result-play').textContent='▶';$('result-play').setAttribute('aria-label','Play preview');}
resultVideo.onpause=resetResultPlay;resultVideo.onended=resetResultPlay;
$('result-play').onclick=()=>resultVideo.paused?resultVideo.play().catch(()=>toast('Playback could not start. Try downloading the video.')):resultVideo.pause();
$('result-seek').oninput=e=>{if(Number.isFinite(resultVideo.duration))resultVideo.currentTime=Number(e.target.value)*resultVideo.duration/100;};
$('result-mute').onclick=()=>{resultVideo.muted=!resultVideo.muted;$('result-mute').setAttribute('aria-label',resultVideo.muted?'Unmute preview':'Mute preview');$('result-mute').setAttribute('aria-pressed',String(resultVideo.muted));$('result-mute').textContent=resultVideo.muted?'×♪':'♪';};
$('result-fullscreen').onclick=()=>{const player=$('result-player');if(player.requestFullscreen)player.requestFullscreen().catch(()=>toast('Fullscreen is unavailable in this browser.'));};
resultVideo.onclick=()=>$('result-play').click();resultVideo.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();$('result-play').click();}};

// One media clock prevents seeks between the comparison panels.
const examplePlayer=initExamplePlayer($,{toast,time});
coordinatePlayback([video,resultVideo,$('example-master')]);
