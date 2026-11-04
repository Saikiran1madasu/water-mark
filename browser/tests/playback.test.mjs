import test from 'node:test';import assert from 'node:assert/strict';
import {coordinatePlayback,createVideoFrameClock} from '../src/playback.js';
test('comparison clock draws the presented media time rather than the ahead-of-decoder clock',()=>{
 let callback,id=0;const drawn=[],video={get currentTime(){return .9;},set currentTime(_){throw Error('Playback must not seek');},requestVideoFrameCallback(cb){callback=cb;return id++;},cancelVideoFrameCallback(){}};
 const clock=createVideoFrameClock(video,time=>drawn.push(time));clock.start();callback(200,{mediaTime:.25});callback(240,{mediaTime:.291667});assert.deepEqual(drawn,[.25,.291667]);assert.equal(clock.mode,'video-frame');clock.stop();
});
test('pause cancels pending frame callbacks, and stale callbacks cannot repaint a restarted player',()=>{
 let cb,id=0,requests=0;const canceled=[],drawn=[],video={currentTime:0,requestVideoFrameCallback(fn){cb=fn;requests++;return id++;},cancelVideoFrameCallback(n){canceled.push(n);}};
 const clock=createVideoFrameClock(video,t=>drawn.push(t));clock.start();clock.start();assert.equal(requests,1);const stale=cb;clock.stop();assert.deepEqual(canceled,[0]);clock.start();stale(0,{mediaTime:5});assert.equal(drawn.length,0);cb(0,{mediaTime:.1});assert.deepEqual(drawn,[.1]);clock.stop();
});
test('fallback comparison rendering avoids duplicate draws within the same 24fps frame',()=>{
 let cb;const drawn=[],video={currentTime:0},animation={requestAnimationFrame(fn){cb=fn;return 1;},cancelAnimationFrame(){}};
 const clock=createVideoFrameClock(video,t=>drawn.push(t),animation);clock.start();cb();video.currentTime=.01;cb();video.currentTime=.05;cb();assert.deepEqual(drawn,[0,.05]);clock.stop();assert.equal(clock.mode,'animation-frame');
});
test('source, repaired result and packed example cannot play over one another',()=>{
 class Player extends EventTarget{paused=true;pauses=0;play(){this.paused=false;this.dispatchEvent(new Event('play'));}pause(){this.paused=true;this.pauses++;}}
 const source=new Player(),result=new Player(),example=new Player(),dispose=coordinatePlayback([source,result,example]);
 source.play();result.play();assert(source.paused);assert(!result.paused);assert.equal(source.pauses,1);
 example.play();assert(result.paused);assert(!example.paused);source.play();assert(example.paused);assert(!source.paused);
 dispose();result.play();assert(!source.paused);assert(!result.paused);
});
