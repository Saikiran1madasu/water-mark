// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
const $=id=>document.getElementById(id), video=$('source-video'), canvas=$('selection'), ctx=canvas.getContext('2d');
const engineBase=String(window.MSK_CONFIG?.apiBase||'').replace(/\/$/,'');
let uploadLimit=500*1024*1024;
let file=null,objectURL=null,box=null,anchor=null,available=false,busy=false,loaded=false;let maskKeys=[];let examplePending=false;const exports=[];
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6500);}
function tab(name){for(const id of ['studio','projects','guide'])$(id).hidden=id!==name;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$('crumb').textContent={studio:'Cleanup studio',projects:'My exports',guide:'Quick guide'}[name];}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));$('help').onclick=()=>tab('guide');$('new-project').onclick=()=>{tab('studio');if(busy)return toast('Please wait for the current export to finish.');$('file-input').click();};
async function health(){
  const setupRequired=!!window.MSK_CONFIG?.editorOnly;
  $('retry-engine').hidden=setupRequired;
  $('setup-engine').hidden=!setupRequired;
  if(setupRequired){
    available=false;
    $('engine-status').textContent='○ Processing setup required';
    $('processing-location').textContent='Editor preview';
    $('engine-offline').hidden=false;
    $('connection-banner').hidden=false;
    $('connection-banner').textContent='This is an editor preview. A processing server must be connected before videos can be repaired.';
    $('engine-error').textContent='Online processing has not been set up. Reconnecting will not enable it.';
    update();return;
  }
  let reason='';
  try{
    const response=await fetch(engineBase+'/api/health',{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error();
    const state=await response.json();
    available=!!state.available&&state.version>=2;
    if(!available)reason='The processing service is not ready. Please try again shortly.';
    if(Number.isFinite(state.maxUploadBytes))uploadLimit=Math.min(500*1024*1024,state.maxUploadBytes);
    $('processing-location').textContent=state.deployment==='local'?'Processing on this computer':state.deployment==='hosted'?'Online video processing':'Video processing';
    $('local-engine-link').hidden=state.deployment!=='local';
  }catch{
    available=false;reason='Could not reach the processing service. Please reconnect or try again shortly.';
  }
  $('engine-status').textContent=available?'● Engine ready':'○ Service unavailable';
  $('engine-status').style.color=available?'#52705f':'#6c756f';
  $('engine-offline').hidden=available;
  $('connection-banner').hidden=available;
  $('connection-banner').textContent='The processing service is unavailable. Please reconnect or try again shortly.';
  $('engine-error').textContent=reason;
  update();
}
health();
function update(){$('remove').disabled=!available||!loaded||!box||busy;$('preview').disabled=$('remove').disabled;$('full-export').disabled=$('remove').disabled;$('repair-mode').disabled=busy;$('load-example').disabled=busy;$('clear').disabled=!box||busy;$('replace').disabled=busy;$('quality').disabled=busy;$('context-radius').disabled=busy;$('mask-margin').disabled=busy;$('mask-mode').disabled=busy;$('add-keyframe').disabled=busy||!box;document.querySelectorAll('#keyframe-list button').forEach(b=>b.disabled=busy);$('action-hint').textContent=busy?'Keep this window open while processing':!file?'Upload a video to get started':!loaded?'Loading video…':!box?'Select the watermark to continue':!available?(window.MSK_CONFIG?.editorOnly?'Online processing setup required':'Reconnect the processing service to continue'):'Your original file stays untouched';$('selection-count').textContent=box?($('mask-mode').value==='keyframed'?maskKeys.length+(maskKeys.length===1?' position':' positions'):'1 area'):'0 areas';$('selection-empty').hidden=!!box;$('selection-info').hidden=!box;if(box)$('selection-info').textContent=`⌖ Watermark · ${Math.round(box.w*video.videoWidth)} × ${Math.round(box.h*video.videoHeight)} px`;$('step-select').classList.toggle('current',loaded);$('step-export').classList.toggle('current',busy);}
function time(s){if(!Number.isFinite(s))return '00:00';return `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;}
function draw(){const r=canvas.getBoundingClientRect();canvas.width=Math.round(r.width*devicePixelRatio);canvas.height=Math.round(r.height*devicePixelRatio);ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,r.width,r.height);if(!box)return;const x=box.x*r.width,y=box.y*r.height,w=box.w*r.width,h=box.h*r.height;ctx.fillStyle='rgba(201,245,111,.22)';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#c9f56f';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.fillStyle='#fff';for(const [px,py] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]])ctx.fillRect(px-3,py-3,6,6);}
new ResizeObserver(draw).observe($('video-holder'));
function point(e){const r=canvas.getBoundingClientRect();return {x:Math.min(.998,Math.max(.002,(e.clientX-r.left)/r.width)),y:Math.min(.998,Math.max(.002,(e.clientY-r.top)/r.height))};}
canvas.onpointerdown=e=>{if(!loaded||busy)return;video.pause();anchor=point(e);canvas.setPointerCapture(e.pointerId);$('selection-tip').hidden=true;};
canvas.onpointermove=e=>{if(!anchor)return;const p=point(e);box={x:Math.min(anchor.x,p.x),y:Math.min(anchor.y,p.y),w:Math.abs(p.x-anchor.x),h:Math.abs(p.y-anchor.y)};draw();};
function finish(){if(!anchor)return;anchor=null;if(!box||box.w*video.videoWidth<4||box.h*video.videoHeight<4)box=null;if(box&&$('mask-mode').value==='keyframed')saveKey();draw();update();}canvas.onpointerup=finish;canvas.onpointercancel=finish;
$('clear').onclick=()=>{box=null;maskKeys=[];renderKeys();draw();update();$('selection-tip').hidden=false;};
$('browse').onclick=$('replace').onclick=()=>$('file-input').click();$('file-input').onchange=e=>{if(e.target.files[0])load(e.target.files[0]);e.target.value='';};
function load(f){if(busy)return toast('Wait for the current export to finish.');if(f.size>uploadLimit)return toast(`Please choose a video smaller than ${Math.floor(uploadLimit/1024/1024)} MB.`);if(!f.type.startsWith('video/'))return toast('Please choose a video file.');file=f;loaded=false;box=null;maskKeys=[];renderKeys();video.pause();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=URL.createObjectURL(f);video.src=objectURL;$('upload-view').hidden=true;$('video-holder').hidden=false;$('replace').hidden=false;$('example-note').hidden=!examplePending;$('file-tag').textContent=f.name;$('file-tag').title=f.name;$('result').hidden=true;$('progress-wrap').hidden=true;$('selection-tip').hidden=false;$('resolution').textContent='Reading…';update();}
video.onloadedmetadata=()=>{if(!Number.isFinite(video.duration)||!video.videoWidth){toast('This video cannot be read. Try an MP4 with H.264 video.');return;}loaded=true;if(examplePending){box={x:.46,y:.43,w:.06,h:.11};examplePending=false;$('selection-tip').hidden=true;}$('duration').textContent=time(video.duration);$('resolution').textContent=`${video.videoWidth} × ${video.videoHeight}`;$('play').disabled=$('seek').disabled=$('fullscreen').disabled=false;draw();update();};video.onerror=()=>{loaded=false;update();toast('Your browser cannot play this video. Try an H.264 MP4.');};video.ontimeupdate=()=>{if($('mask-mode').value==='keyframed'&&maskKeys.length){box=boxAt(video.currentTime);draw();update();}$('current-time').textContent=time(video.currentTime);$('seek').value=video.duration?video.currentTime/video.duration*100:0;};video.onplay=()=>$('play').textContent='Ⅱ';video.onpause=()=>$('play').textContent='▶';$('play').onclick=()=>video.paused?video.play().catch(()=>toast('Playback unavailable.')):video.pause();$('seek').oninput=e=>video.currentTime=Number(e.target.value)*video.duration/100;$('fullscreen').onclick=()=>video.requestFullscreen?.();
const zone=$('drop-zone');zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragging');};zone.ondragleave=()=>zone.classList.remove('dragging');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragging');if(e.dataTransfer.files[0])load(e.dataTransfer.files[0]);};
async function processVideo(preview=false){if(!file||!box||busy||!available)return;busy=true;video.pause();update();$('result').hidden=true;$('progress-wrap').hidden=false;$('progress-bar').style.width='0%';$('progress-label').textContent='Uploading video…';try{const r=await fetch(`${engineBase}/api/jobs?box=${encodeURIComponent(JSON.stringify(box))}&mode=${$('repair-mode').value}&preview=${preview?'1':'0'}&previewStart=${video.currentTime}&quality=${$('quality').value}&radius=${$('context-radius').value}&margin=${$('mask-margin').value}&keyframes=${encodeURIComponent(JSON.stringify($('mask-mode').value==='keyframed'?maskKeys:[]))}`,{method:'POST',headers:{'Content-Type':file.type},body:file});const j=await r.json();if(!r.ok)throw Error(j.error||'Upload failed.');let misses=0;while(true){await new Promise(resolve=>setTimeout(resolve,900));let status;try{const response=await fetch(`${engineBase}/api/jobs/${j.id}`);status=await response.json();if(!response.ok)throw Error(status.error);misses=0;}catch(e){if(++misses<4)continue;throw e;}$('progress-bar').style.width=`${status.progress||0}%`;$('progress-label').textContent=status.status==='inspecting'?'Inspecting video…':`${status.message||'Repairing'} · ${status.progress||0}%${status.coverage!==undefined?' · '+status.coverage+'% temporal coverage':''}`;if(status.status==='failed')throw Error(status.error||'Repair failed.');if(status.status==='completed'){const url=`${engineBase}/outputs/${j.id}.mp4`;$('result-video').src=url;$('download').href=url;$('result').hidden=false;$('progress-label').textContent=preview?'Preview complete':'Export complete';$('result-heading').textContent=preview?'Your 3-second preview':'Your video is ready to review.';$('full-export').hidden=!preview;$('download').textContent=preview?'↓ Download preview':'↓ Download video';$('download').download=preview?'msk-preview.mp4':'msk-cleaned.mp4';if(status.stats){const s=status.stats;$('repair-report').hidden=false;$('repair-report').textContent=`${s.engine} · ${s.temporalCoverage}% of masked pixels recovered from nearby frames · ${s.frames} frames processed · ${s.maskMode==='keyframed'?s.keyframes+' mask keyframes':'fixed mask'}. ${s.preservedSelectionCoverage?`${s.preservedSelectionCoverage}% of the selection kept its original background. `:''}${s.structureCoverage?`${s.structureCoverage}% rebuilt from matched patterns or surrounding lighting. `:''}${Math.max(0,Number(s.synthesizedCoverage??(100-s.temporalCoverage))-Number(s.structureCoverage||0)).toFixed(1)}% used other estimated fill. Coverage measures source use, not guaranteed accuracy.`;}exports.unshift({name:(preview?'Preview · ':'')+file.name,url});renderExports();$('result').scrollIntoView({behavior:'smooth',block:'center'});toast(preview?'Preview ready. Check it before processing the full video.':'Your repaired video is ready to review.');break;}}}catch(e){$('progress-label').textContent='Export could not complete';toast(e.message);}finally{busy=false;update();}};
function renderExports(){$('export-count').textContent=exports.length;const list=$('exports-list');list.replaceChildren();for(const item of exports){const row=document.createElement('div');row.className='export-row';const name=document.createElement('span');name.textContent=item.name;const a=document.createElement('a');a.className='primary';a.textContent='↓ Download';a.href=item.url;a.download='msk-cleaned.mp4';row.append(name,a);list.append(row);}}

function boxAt(t){if(!maskKeys.length)return box;if(t<=maskKeys[0].time)return {...maskKeys[0].box};for(let i=1;i<maskKeys.length;i++){const left=maskKeys[i-1],right=maskKeys[i];if(t<=right.time){const f=(t-left.time)/(right.time-left.time);return Object.fromEntries(['x','y','w','h'].map(k=>[k,left.box[k]*(1-f)+right.box[k]*f]));}}return {...maskKeys[maskKeys.length-1].box};}
function saveKey(){if(!box||busy)return;const t=Math.round(video.currentTime*1000)/1000;const existing=maskKeys.findIndex(k=>Math.abs(k.time-t)<.04);if(existing>=0)maskKeys[existing]={time:t,box:{...box}};else{if(maskKeys.length>=32)return toast('Use up to 32 mask positions. Remove a position before adding another.');maskKeys.push({time:t,box:{...box}});}maskKeys.sort((a,b)=>a.time-b.time);renderKeys();}
function renderKeys(){const list=$('keyframe-list');list.replaceChildren();for(const key of maskKeys){const row=document.createElement('div');row.className='keyframe-row';const seek=document.createElement('button');seek.type='button';seek.textContent=`⌖ ${time(key.time)}.${Math.round((key.time%1)*100).toString().padStart(2,'0')}`;seek.onclick=()=>{if(!busy){video.pause();video.currentTime=key.time;box={...key.box};draw();}};const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remove mask keyframe at ${key.time} seconds`);remove.onclick=()=>{if(busy)return;maskKeys=maskKeys.filter(k=>k!==key);if(!maskKeys.length)box=null;renderKeys();draw();update();};row.append(seek,remove);list.append(row);}}
$('mask-mode').onchange=()=>{$('keyframe-controls').hidden=$('mask-mode').value!=='keyframed';if($('mask-mode').value==='keyframed'&&box&&!maskKeys.length)saveKey();update();};$('add-keyframe').onclick=()=>{saveKey();update();};

$('remove').onclick=()=>processVideo(false);$('preview').onclick=()=>processVideo(true);$('full-export').onclick=()=>processVideo(false);
$('load-example').onclick=async()=>{if(busy)return;try{const r=await fetch('./examples/local-motion.mp4');if(!r.ok)throw Error('Example clip unavailable.');const blob=await r.blob();examplePending=true;load(new File([blob],'MSK-local-motion-example.mp4',{type:'video/mp4'}));toast('Generated local-motion test clip loaded with a preset selection.');}catch(e){examplePending=false;toast(e.message);}};

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
