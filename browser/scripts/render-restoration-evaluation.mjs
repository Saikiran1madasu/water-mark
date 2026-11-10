// Development evaluation only. Production still uses browser WebCodecs.
// FFmpeg decodes/encodes; all reconstruction uses the current JavaScript engine.
import * as ort from 'onnxruntime-web';import {OriginalRGBRefiner,RGB_REFINER_SHA256} from '../src/rgb-refiner.js';
import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs';
import {selection} from '../src/repair.js';
const {SelectionOverlayCalibrator}=await import(process.env.CALIBRATOR_EVALUATION_MODULE||'../src/overlay.js');
const {BrowserRepair}=await import(process.env.REPAIR_EVALUATION_MODULE||'../src/repair.js');
const [source,output,boxJson]=process.argv.slice(2);if(!source||!output)throw Error('Provide a local source and output path.');
const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate,nb_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',source],{encoding:'utf8',maxBuffer:16*1024*1024});
if(probe.status)throw Error(probe.stderr);const meta=JSON.parse(probe.stdout),track=meta.streams[0],w=track.width,h=track.height,[num,den]=track.avg_frame_rate.split('/').map(Number),fps=num/den;
const times=meta.frames.map(f=>Number(f.best_effort_timestamp_time));
if(times.some((t,i)=>Math.abs(t-times[0]-i/fps)>.001))throw Error('This development driver is CFR-only; use the browser for VFR exports.');
const box=boxJson?JSON.parse(boxJson):{x:1128/1280,y:568/720,w:64/1280,h:68/720},r=selection(w,h,box,3),size=w*h*4;
async function* frames(){
 const child=spawn('ffmpeg',['-v','error','-i',source,'-f','rawvideo','-pix_fmt','rgba','pipe:1'],{stdio:['ignore','pipe','inherit']});const done=once(child,'close');let bytes=0,buffer=Buffer.alloc(size);
 for await(const chunk of child.stdout){let offset=0;while(offset<chunk.length){const n=Math.min(size-bytes,chunk.length-offset);chunk.copy(buffer,bytes,offset,offset+n);bytes+=n;offset+=n;if(bytes===size){yield new Uint8ClampedArray(buffer);bytes=0;buffer=Buffer.alloc(size);}}}
 const [code]=await done;if(code!==0||bytes)throw Error('Local decoding failed or produced an incomplete frame.');
}
const calibrationSamples=Number(process.env.CALIBRATION_SAMPLES||24);
if(!Number.isInteger(calibrationSamples)||calibrationSamples<4||calibrationSamples>240)throw Error('CALIBRATION_SAMPLES must be an integer from 4 to 240.');
// Private candidates can be evaluated without replacing the shipped graph.
const evaluationRoot=process.env.RGB_EVALUATION_MODEL_ROOT;
const evaluationModel=evaluationRoot?JSON.parse(fs.readFileSync(evaluationRoot+'/training-report.json','utf8')):null;
const checkpointSHA=evaluationModel?.sha256??RGB_REFINER_SHA256;
const checkpointPath=evaluationModel?evaluationRoot+'/'+evaluationModel.modelFile:'public/models/own-rgb-v3.onnx';
const restorer=await OriginalRGBRefiner.create({runtime:ort,modelBytes:fs.readFileSync(checkpointPath),expectedSHA256:checkpointSHA});
const engine=new BrowserRepair({mode:'motion',radius:8,margin:3}),calibrator=new SelectionOverlayCalibrator(r,w,h,{tangents:process.env.ENABLE_TANGENT_STAGE==='1'}),selected=new Set(Array.from({length:Math.min(calibrationSamples,times.length)},(_,i)=>Math.floor(i*times.length/Math.min(calibrationSamples,times.length))));const warm=[];let index=0;
for await(const data of frames()){if(selected.has(index))calibrator.observe(data,w,h,times[index]);if(index<12)warm.push(data);index++;}
const candidateCount=calibrator.candidates.length,model=calibrator.finalize(),accepted=model?.info.acceptedFrames??candidateCount;for(const data of warm)engine.process(data,w,h,box);engine.beginOutput(warm.length);warm.length=0;
engine.globalOverlay=model;engine.stats.globalModelSamples=calibrator.sampled;engine.stats.globalModelAccepted=accepted;
const encoder=spawn('ffmpeg',['-v','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${w}x${h}`,'-framerate',track.avg_frame_rate,'-i','pipe:0','-i',source,'-map','0:v:0','-map','1:a?','-c:v','libx264','-crf','16','-preset','medium','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output],{stdio:['pipe','ignore','inherit']});const encoded=once(encoder,'close');
for await(const data of frames()){
 const original=data.slice(),first=engine.process(data,w,h,box);
 if(model&&first.estimatedMask){const refined=await restorer.refineRepair(original,data,w,h,first.rect,model,{preserveMask:first.motionMask});if(refined){engine.recordRGBRefinement(refined,first);data.set(refined.data);}else engine.stats.rgbSkippedFrames=(engine.stats.rgbSkippedFrames??0)+1;}else engine.stats.rgbSkippedFrames=(engine.stats.rgbSkippedFrames??0)+1;
 const tangent=engine.refineTangents(original,data,w,h,first);if(tangent)data.set(tangent.data);
 await new Promise((resolve,reject)=>encoder.stdin.write(Buffer.from(data.buffer,data.byteOffset,data.byteLength),error=>error?reject(error):resolve()));
 if(engine.stats.frames%48===0)console.log(`${engine.stats.frames}/${times.length} frames evaluated`);
}
encoder.stdin.end();const [code]=await encoded;if(code!==0)throw Error('Local encoding failed.');
const report={mode:'restore',rgbModelSHA256:checkpointSHA,privateCandidate:Boolean(evaluationRoot||process.env.REPAIR_EVALUATION_MODULE||process.env.CALIBRATOR_EVALUATION_MODULE||process.env.ENABLE_TANGENT_STAGE==='1'),experimentalStage:process.env.ENABLE_TANGENT_STAGE==='1'?'source-tangents':null,runtime:'local evaluation of JavaScript reconstruction; FFmpeg media I/O, not a browser export',model:model?.info??null,sourceFrames:times.length,stats:engine.report()};
fs.writeFileSync(output+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));engine.dispose();await restorer.dispose();
