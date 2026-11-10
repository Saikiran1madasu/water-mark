import * as ort from 'onnxruntime-web';
import {OwnMatteEngine,OWN_MODEL_SHA256,combineRepairReports} from '../src/own-matte.js';
// Development evaluation only. Production still uses browser WebCodecs.
// FFmpeg decodes/encodes; all reconstruction uses the current JavaScript engine.
import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs';
import {BrowserRepair,selection} from '../src/repair.js';import {SelectionOverlayCalibrator} from '../src/overlay.js';
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
const engine=await OwnMatteEngine.create({runtime:ort,modelBytes:fs.readFileSync('public/models/own-matte-v1.onnx')}),calibrator=new SelectionOverlayCalibrator(r,w,h),selected=new Set(Array.from({length:Math.min(calibrationSamples,times.length)},(_,i)=>Math.floor(i*times.length/Math.min(calibrationSamples,times.length))));let index=0;
for await(const data of frames()){if(selected.has(index))calibrator.observe(data,w,h,times[index]);index++;}
const candidateCount=calibrator.candidates.length,model=calibrator.finalize(),accepted=model?.info.acceptedFrames??candidateCount;
engine.stats.globalModelSamples=calibrator.sampled;engine.stats.globalModelAccepted=accepted;
const fallback=new BrowserRepair({mode:'seamless',margin:3,radius:8});fallback.globalOverlay=model;
const encoder=spawn('ffmpeg',['-v','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${w}x${h}`,'-framerate',track.avg_frame_rate,'-i','pipe:0','-i',source,'-map','0:v:0','-map','1:a?','-c:v','libx264','-crf','16','-preset','medium','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output],{stdio:['pipe','ignore','inherit']});const encoded=once(encoder,'close');
for await(const data of frames()){
 const result=model?await engine.process(data,w,h,model.r,model):null;if(!result)fallback.process(data,w,h,box);await new Promise((resolve,reject)=>encoder.stdin.write(Buffer.from(data.buffer,data.byteOffset,data.byteLength),error=>error?reject(error):resolve()));
 const evaluated=engine.stats.frames+fallback.stats.frames;if(evaluated%48===0)console.log(`${evaluated}/${times.length} frames evaluated`);
}
encoder.stdin.end();const [code]=await encoded;if(code!==0)throw Error('Local encoding failed.');
const report={mode:'own',runtime:'local evaluation of production JavaScript reconstruction; FFmpeg media I/O, not a browser export',supportingEngine:{model:'Original matte refiner v1',sha256:OWN_MODEL_SHA256,runtime:'ONNX Runtime Web 1.31.1, single-threaded WASM'},model:model?.info??null,sourceFrames:times.length,stats:combineRepairReports(fallback.report(),engine.report())};
fs.writeFileSync(output+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));fallback.dispose();await engine.dispose();
