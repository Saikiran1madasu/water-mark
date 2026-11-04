// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// One decoder and clock render all comparison panels from the same media frame.
import {createVideoFrameClock} from './playback.js';
export function initExamplePlayer($,{toast,time}){
  const comparison=$('example-comparison'),master=$('example-master');
  const canvases=[$('example-original'),$('example-repaired'),$('example-clean')],contexts=canvases.map(canvas=>canvas.getContext('2d'));
  let playing=false,resumeAt=0,resumePlaying=false;
  function draw(frameTime=master.currentTime){
    if(typeof frameTime!=='number')frameTime=master.currentTime;
    if(master.readyState<2||!master.videoWidth)return;
    const width=master.videoWidth/3,height=master.videoHeight;
    for(let i=0;i<3;i++){
      if(canvases[i].width!==width||canvases[i].height!==height){canvases[i].width=width;canvases[i].height=height;}
      contexts[i].drawImage(master,i*width,0,width,height,0,0,width,height);canvases[i].dataset.frameTime=frameTime.toFixed(6);
    }
    $('example-current').textContent=time(master.currentTime);$('example-seek').value=master.duration?master.currentTime/master.duration*100:0;
  }
  const clock=createVideoFrameClock(master,draw);master.dataset.frameClock=clock.mode;
  function pause(){playing=false;master.pause();clock.stop();$('example-play').textContent='▶';$('example-play').setAttribute('aria-label','Play example comparison');draw();}
  async function play(){try{if(master.ended)master.currentTime=0;await master.play();playing=true;$('example-play').textContent='Ⅱ';$('example-play').setAttribute('aria-label','Pause example comparison');clock.start();}catch{pause();toast('Example playback could not start. Please try again after it loads.');}}
  $('show-example').onclick=()=>{comparison.open=true;comparison.scrollIntoView({behavior:'smooth',block:'center'});draw();};
  comparison.ontoggle=()=>{if(!comparison.open)pause();else draw();};
  $('example-play').onclick=()=>playing?pause():play();
  $('example-seek').oninput=event=>{if(Number.isFinite(master.duration))master.currentTime=Number(event.target.value)*master.duration/100;};
  master.onseeking=()=>{master.dataset.seekCount=String(Number(master.dataset.seekCount||0)+1);};
  master.onended=pause;
  master.onseeked=draw;master.onloadeddata=draw;master.onpause=()=>{if(playing)pause();};
  $('example-version').onchange=()=>{
    resumeAt=master.currentTime;resumePlaying=playing;pause();
    const previous=$('example-version').value==='previous';
    master.src=`./examples/pattern-lighting-comparison${previous?'-previous':''}.mp4`;
    $('example-repair-caption').textContent=previous?'Previous browser repair':'Updated browser repair';
  };
  master.onloadedmetadata=()=>{if(resumeAt){master.currentTime=Math.min(resumeAt,Math.max(0,master.duration-.001));resumeAt=0;}if(resumePlaying){resumePlaying=false;void play();}};
  $('example-zoom').onclick=()=>{const active=$('example-zoom').getAttribute('aria-pressed')!=='true';$('example-zoom').setAttribute('aria-pressed',String(active));$('example-zoom').textContent=active?'Show full video':'Zoom into watermark';$('example-panels').classList.toggle('zoomed',active);};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&playing)clock.start();});
  return {pause};
}
