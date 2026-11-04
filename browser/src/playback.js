// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
export function coordinatePlayback(players){
  const onPlay=event=>{for(const player of players)if(player!==event.currentTarget&&!player.paused)player.pause();};
  for(const player of players)player.addEventListener('play',onPlay);
  return ()=>{for(const player of players)player.removeEventListener('play',onPlay);};
}
// Render the comparison from presented video frames, not a guessed display-clock
// position that may run ahead of the decoder and repeat/skip a canvas frame.
export function createVideoFrameClock(video,draw,animation=globalThis){
  const native=typeof video.requestVideoFrameCallback==='function'&&typeof video.cancelVideoFrameCallback==='function';
  let active=false,handle=null,generation=0,lastFrame=-1;
  function schedule(token){
    if(!active||generation!==token)return;
    const callback=(_,metadata)=>{
      if(!active||generation!==token)return;handle=null;
      const time=native?metadata.mediaTime:video.currentTime,frame=native?time:Math.floor(time*24);
      if(frame!==lastFrame){draw(time);lastFrame=frame;}
      schedule(token);
    };
    handle=native?video.requestVideoFrameCallback(callback):animation.requestAnimationFrame(callback);
  }
  return {
    mode:native?'video-frame':'animation-frame',
    start(){if(active)return;active=true;lastFrame=-1;schedule(++generation);},
    stop(){active=false;generation++;if(handle!==null){if(native)video.cancelVideoFrameCallback(handle);else animation.cancelAnimationFrame(handle);handle=null;}},
  };
}
