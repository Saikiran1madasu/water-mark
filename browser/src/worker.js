// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
import {Input,ALL_FORMATS,BlobSource,Output,Mp4OutputFormat,WebMOutputFormat,BufferTarget,Conversion,Quality,canEncodeVideo,VideoSampleSink} from 'mediabunny';
import {BrowserRepair,boxAt,selection} from './repair.js';
import {prepareRepair,prepareOverlay} from './prepare.js';
import {SelectionOverlayCalibrator} from './overlay.js';
import {combineRepairReports} from './own-matte.js';
let conversion=null;
const send=(type,detail={})=>self.postMessage({type,...detail});
self.onmessage=async({data:message})=>{
  if(message.type==='capabilities'){
    const supported=typeof VideoDecoder!=='undefined'&&typeof VideoEncoder!=='undefined'&&typeof OffscreenCanvas!=='undefined';
    send('capabilities',{supported,reason:supported?'':'This browser cannot process video. Open this page in a recent Chrome or Edge browser over HTTPS or localhost.'});return;
  }
  if(message.type!=='process')return;
  let input,engine,neural,restorer;
  try{
    const {file,box,options,keys=[],preview=false,previewStart=0}=message;
    if(!['detail','seamless','balanced','own','motion','restore'].includes(options.mode))throw Error('This repair mode is no longer available. Refresh the page and choose an original repair mode.');
    if(file.size>200*1024*1024)throw Error('For browser processing, use a video smaller than 200 MB.');
    input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
    const track=await input.getPrimaryVideoTrack();if(!track)throw Error('No video track found.');
    if(!await track.canDecode())throw Error('This video codec cannot be decoded by your browser. Try an H.264 MP4.');
    const width=track.displayWidth,height=track.displayHeight,duration=await input.computeDuration();
    if(!Number.isFinite(duration)||duration<=0)throw Error('The clip has no readable duration.');
    if(duration>180&&!preview)throw Error('This browser edition currently supports full exports up to 3 minutes. Trim the source or try a preview.');
    if(width*height>1920*1080||Math.max(width,height)>1920)throw Error('Use a video up to 1080p for this browser edition.');
    if(width%2||height%2)throw Error('Use a video with even width and height for export.');
    let codec='avc',extension='mp4';
    if(!await canEncodeVideo('avc',{width,height})){
      codec='vp9';extension='webm';
      if(!await canEncodeVideo('vp9',{width,height}))throw Error('Your browser has no supported video encoder. Try a recent Chrome or Edge browser.');
    }
    const target=new BufferTarget(),output=new Output({target,format:extension==='mp4'?new Mp4OutputFormat({fastStart:'in-memory'}):new WebMOutputFormat()});
    const start=preview?Math.min(Math.max(0,previewStart),Math.max(0,duration-3)):0;
    const end=preview?Math.min(duration,start+3):duration;
    engine=new BrowserRepair({...options,mode:options.mode==='own'?'seamless':options.mode==='restore'?'motion':options.mode});
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw Error('Could not create the frame processing canvas.');
    let lastProgress=0;
    conversion=await Conversion.init({input,output,trim:{start,end},video:videoTrack=>videoTrack===track?{
      codec,quality:new Quality(options.quality==='high'?'very-high':'high'),forceTranscode:true,
      process:async sample=>{
        sample.draw(ctx,0,0,width,height);
        const image=ctx.getImageData(0,0,width,height);
        const original=restorer?image.data.slice():null;
        // Conversion normalizes trimmed samples to the output timeline.
        const currentBox=boxAt(sample.timestamp+start,box,keys);
        let result;
        if(neural){
          const requested=selection(width,height,currentBox,options.margin??3),candidate=keys.length?null:overlay.model,identity=candidate?.requestedRect??candidate?.r;
          const model=identity&&['x','y','w','h'].every(k=>identity[k]===requested[k])?candidate:null;
          result=model?await neural.process(image.data,width,height,model.r,model):null;
          if(!result)result=engine.process(image.data,width,height,currentBox);
        }else result=engine.process(image.data,width,height,currentBox);
        if(restorer){
          const model=engine.globalOverlay;
          if(model&&result.estimatedMask){
            const refined=await restorer.refineRepair(original,image.data,width,height,result.rect,model,{preserveMask:result.motionMask});
            if(refined){engine.recordRGBRefinement(refined,result);image.data.set(refined.data);}
            else engine.stats.rgbSkippedFrames=(engine.stats.rgbSkippedFrames??0)+1;
          }else engine.stats.rgbSkippedFrames=(engine.stats.rgbSkippedFrames??0)+1;
        }
        ctx.putImageData(image,0,0);
        if(performance.now()-lastProgress>150){send('progress',{progress:Math.min(.97,sample.timestamp/(end-start)),frames:engine.stats.frames+(neural?.stats.frames??0),method:result.method});lastProgress=performance.now();}
        return canvas;
      },
    }:{discard:true}});
    const dropped=conversion.discardedTracks.filter(item=>item.reason!=='discarded_by_user');
    if(!conversion.isValid||dropped.length)throw Error('The browser cannot preserve every audio/video track in this export. Try an H.264 MP4 with AAC audio. No silent export was produced.');
    let overlay={model:null,sampled:0,accepted:0};
    if(options.mode!=='balanced'&&!keys.length){
      send('progress',{phase:'calibration',progress:0,frames:0});
      const calibrator=new SelectionOverlayCalibrator(selection(width,height,box,options.margin??3),width,height);
      const times=Array.from({length:24},(_,i)=>i*duration/24);
      overlay=await prepareOverlay(calibrator,new VideoSampleSink(track).samplesAtTimestamps(times),sample=>{
        sample.draw(ctx,0,0,width,height);return {data:ctx.getImageData(0,0,width,height).data,width,height};
      },frames=>send('progress',{phase:'calibration',progress:0,frames}));
    }
    if(options.mode==='own'){
      const {OwnMatteEngine}=await import('./own-matte.js');
      neural=await OwnMatteEngine.create({onPhase:label=>send('progress',{phase:'model',label,progress:0,frames:0})});
    }else{
      send('progress',{phase:'analysis',progress:0,frames:0});
      await prepareRepair(engine,new VideoSampleSink(track).samples(start,Math.min(end,start+2)),sample=>{
      sample.draw(ctx,0,0,width,height);
      return {data:ctx.getImageData(0,0,width,height).data,width,height};
      },time=>boxAt(time,box,keys),frames=>send('progress',{phase:'analysis',progress:0,frames}));
    }
    if(options.mode==='restore'){
      const {loadOriginalRGBRefiner}=await import('./rgb-refiner.js');
      restorer=await loadOriginalRGBRefiner(label=>send('progress',{phase:'model',label,progress:0,frames:0}));
    }
    engine.globalOverlay=overlay.model;engine.stats.globalModelSamples=overlay.sampled;engine.stats.globalModelAccepted=overlay.accepted;
    let sizeExceeded=false;
    const stop=target.on('write',({end})=>{if(end>256*1024*1024&&!sizeExceeded){sizeExceeded=true;void conversion.cancel();}});
    try{await conversion.execute();}finally{stop();}
    if(sizeExceeded)throw Error('The output exceeds the browser memory limit. Use a shorter video or balanced quality.');
    if(!target.buffer)throw Error('The browser did not produce a video file.');
    const buffer=target.buffer,stats=neural?combineRepairReports(engine.report(),neural.report()):engine.report();
    self.postMessage({type:'complete',buffer,extension,mime:extension==='mp4'?'video/mp4':'video/webm',stats,duration:end-start,width,height,preview,mode:options.mode},[buffer]);
  }catch(error){send('error',{message:error.message||String(error)});}
  finally{engine?.dispose();try{await neural?.dispose();}finally{try{await restorer?.dispose();}finally{input?.dispose();conversion=null;}}}
};
