import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {deploymentConfig,createJobStore} from './deployment.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)), config=deploymentConfig(root), data=config.data;
const store=createJobStore(data,config.retentionMs),jobs=store.jobs,port=Number(process.env.PORT||4173);
setInterval(()=>store.cleanup(),60000).unref();
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
function command(bin,args){return new Promise((resolve,reject)=>{let out='',err='';const p=spawn(bin,args);p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err=(err+x).slice(-8000));const timer=setTimeout(()=>{err='Media preparation exceeded the server time limit.';p.kill('SIGKILL');},config.timeoutMs);p.on('error',error=>{clearTimeout(timer);reject(error);});p.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error(err||`${bin} failed`));});});}
const python=process.env.MSK_PYTHON||path.join(root,'.venv','bin','python');
let available=false;try{await command('ffmpeg',['-version']);await command('ffprobe',['-version']);await command(python,['-c','import av, cv2, numpy']);available=true;}catch{}
async function processJob(job){
 try{
 job.status='inspecting';job.message='Inspecting video';store.save(job);
 const meta=JSON.parse(await command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',job.input]));
 const video=meta.streams.find(s=>s.codec_type==='video');if(!video)throw Error('No video stream found.');
 if(Number(video.width)*Number(video.height)>config.maxPixels)throw Error('This video exceeds the server resolution limit.');
 if(!(Number(meta.format.duration)>0)||Number(meta.format.duration)>config.maxDuration)throw Error('This video exceeds the server duration limit or has no readable duration.');
 if(Number(video.tags?.rotate||0)!==0||video.side_data_list?.some(s=>s.rotation))throw Error('Please export this rotated video upright before processing.');
 if(video.pix_fmt?.includes('10')||video.color_transfer==='smpte2084'||video.color_transfer==='arib-std-b67')throw Error('Please convert HDR/10-bit video to SDR first. This engine currently supports 8-bit SDR.');
 job.status='processing';job.duration=Number(meta.format.duration)||0;
 let workingInput=job.input;
 if(job.preview){
   const start=Math.min(job.previewStart,Math.max(0,job.duration-3)),length=Math.min(3,job.duration-start);
   if(!(length>0))throw Error('Could not determine preview duration.');
   const at=t=>{const keys=job.keyframes;if(!keys.length)return job.box;if(t<=keys[0].time)return keys[0].box;for(let i=1;i<keys.length;i++){const a=keys[i-1],b=keys[i];if(t<=b.time){const f=(t-a.time)/(b.time-a.time);return Object.fromEntries(['x','y','w','h'].map(k=>[k,a.box[k]*(1-f)+b.box[k]*f]));}}return keys.at(-1).box;};
   if(job.keyframes.length){const keys=[{time:0,box:at(start)},...job.keyframes.filter(k=>k.time>start&&k.time<start+length).map(k=>({time:k.time-start,box:k.box})),{time:length,box:at(start+length)}];job.box=keys[0].box;job.keyframes=keys;}
   job.previewInput=path.join(data,`${job.id}.preview.mp4`);job.message='Preparing a 3-second preview';
   await command('ffmpeg',['-y','-ss',String(start),'-i',job.input,'-t',String(length),'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','fast','-crf','12','-fps_mode','vfr','-c:a','aac',job.previewInput]);
   workingInput=job.previewInput;job.previewRange={start,duration:length};
 }
 job.intermediate=path.join(data,`${job.id}.repaired.mp4`);
 const args=[path.join(root,'engine','temporal.py'),'--input',workingInput,'--output',job.intermediate,'--box',JSON.stringify(job.box),'--quality',job.quality==='high'?'high':'standard','--radius',String(job.radius),'--margin',String(job.margin),'--keyframes',JSON.stringify(job.keyframes),'--mode',job.mode];
 await new Promise((resolve,reject)=>{const p=spawn(python,args);let err='',buffer='',engineError='';job.process=p;
 const timer=setTimeout(()=>{engineError='Processing reached the server time limit. Try a shorter clip.';p.kill('SIGKILL');},config.timeoutMs);
 p.once('close',()=>clearTimeout(timer));p.once('error',()=>clearTimeout(timer));
 p.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){try{const event=JSON.parse(line);if(event.error)engineError=event.error;job.progress=event.progress??job.progress;job.message=event.stage==='repaired'?'Restoring audio':`Reconstructing background · ${event.frames||0} frames`;if(event.temporalCoverage!==undefined)job.coverage=event.temporalCoverage;if(event.stats)job.stats=event.stats;}catch{}}});
 p.stderr.on('data',x=>err=(err+x).slice(-4000));p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(engineError||err||'Temporal repair failed.')));});
 job.message='Restoring audio and finalizing export';job.progress=94;
 // Preserve the repaired video's presentation timestamps; audio is mapped from the original.
 await command('ffmpeg',['-y','-i',job.intermediate,'-i',workingInput,'-map','0:v:0','-map','1:a?','-map_metadata','1','-metadata:s:v:0','rotate=0','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',job.output]);
 if(job.stats)Object.assign(job.stats,{preview:job.preview,previewRange:job.previewRange});
 job.status='completed';job.progress=100;job.message=job.preview?'Preview complete':'Export complete';
 }catch(e){job.status='failed';job.error=e.message;fs.rm(job.output,{force:true},()=>{});}
 finally{job.finishedAt=Date.now();delete job.process;store.save(job);fs.rm(job.input,{force:true},()=>{});if(job.intermediate)fs.rm(job.intermediate,{force:true},()=>{});if(job.previewInput)fs.rm(job.previewInput,{force:true},()=>{});}
}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');
 const origin=req.headers.origin;
 const approvedOrigins=new Set(['https://clearframe-video-studio-oct30.learning-lea-6584.chatgpt.site',`http://localhost:${port}`,`http://127.0.0.1:${port}`,...config.origins]);
 if(origin){
   if(!approvedOrigins.has(origin))return json(res,403,{error:'This website is not allowed to use the processing server.'});
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
   res.setHeader('Access-Control-Allow-Private-Network','true');
 }
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Range','Access-Control-Max-Age':'600'});return res.end();}

 if(req.method==='GET'&&url.pathname==='/api/ready')return json(res,available?200:503,{available});
 if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{available,engine:'MSK Temporal Repair v2',version:2,revision:'2.2',pid:process.pid,deployment:config.host==='127.0.0.1'?'local':'hosted',maxUploadBytes:config.maxUploadBytes});
 if(req.method==='POST'&&url.pathname==='/api/jobs'){
 if(!available)return json(res,503,{error:'The processing engine is unavailable. The server operator needs to check its dependencies.'});
 if([...jobs.values()].some(j=>['uploading','inspecting','processing'].includes(j.status)))return json(res,409,{error:'Another video is processing. Please wait.'});
 let box;try{box=JSON.parse(url.searchParams.get('box'));}catch{}
 if(!box||!['x','y','w','h'].every(k=>Number.isFinite(box[k]))||box.x<0||box.y<0||box.w<=0||box.h<=0||box.x+box.w>1.001||box.y+box.h>1.001)return json(res,400,{error:'Invalid selection.'});
 if(!req.headers['content-type']?.startsWith('video/'))return json(res,400,{error:'Upload a video file.'});
 let keyframes;try{keyframes=JSON.parse(url.searchParams.get('keyframes')||'[]');}catch{return json(res,400,{error:'Invalid mask keyframes.'});}
 const validBox=b=>b&&['x','y','w','h'].every(k=>Number.isFinite(b[k]))&&b.x>=0&&b.y>=0&&b.w>0&&b.h>0&&b.x+b.w<=1.001&&b.y+b.h<=1.001;
 if(!Array.isArray(keyframes)||keyframes.length>32||!keyframes.every(k=>Number.isFinite(k.time)&&k.time>=0&&k.time<=86400&&validBox(k.box)))return json(res,400,{error:'Use up to 32 valid mask keyframes.'});
 keyframes.sort((a,b)=>a.time-b.time);
 if(keyframes.some((k,i)=>i>0&&k.time===keyframes[i-1].time))return json(res,400,{error:'Each keyframe needs a different time.'});
 const radius=Number(url.searchParams.get('radius')||12),margin=Number(url.searchParams.get('margin')||3);
 if(!Number.isInteger(radius)||radius<2||radius>24||!Number.isInteger(margin)||margin<0||margin>12)return json(res,400,{error:'Invalid context or mask margin.'});
 const mode=url.searchParams.get('mode')||'detail',preview=url.searchParams.get('preview')==='1',previewStart=Number(url.searchParams.get('previewStart')||0);
 if(!['detail','balanced'].includes(mode)||!Number.isFinite(previewStart)||previewStart<0||previewStart>86400)return json(res,400,{error:'Invalid repair mode or preview time.'});
 const id=randomUUID(),job={id,createdAt:Date.now(),status:'uploading',progress:0,box,radius,margin,keyframes,mode,preview,previewStart,quality:url.searchParams.get('quality'),input:path.join(data,`${id}.input`),output:path.join(data,`${id}.mp4`)};jobs.set(id,job);store.save(job);
 if(Number(req.headers['content-length'])>config.maxUploadBytes){store.remove(job);req.resume();return json(res,413,{error:'This video exceeds the server upload limit.'});}
 let bytes=0;const writer=fs.createWriteStream(job.input);let failed=false;
 req.on('data',chunk=>{bytes+=chunk.length;if(bytes>config.maxUploadBytes){failed=true;req.destroy();writer.destroy();fs.rm(job.input,{force:true},()=>{});store.remove(job);}});
 req.pipe(writer);req.on('aborted',()=>{failed=true;writer.destroy();store.remove(job);fs.rm(job.input,{force:true},()=>{});});writer.on('error',()=>{failed=true;store.remove(job);if(!res.headersSent)json(res,500,{error:'Could not save upload.'});});
 writer.on('finish',()=>{if(!failed){json(res,202,{id});processJob(job);}});return;
 }
 const match=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
 if(req.method==='GET'&&match){const j=jobs.get(match[1]);return j?json(res,200,{id:j.id,status:j.status,progress:j.progress,error:j.error,message:j.message,coverage:j.coverage,stats:j.stats}):json(res,404,{error:'Job expired. Process your video again.'});}
 const download=url.pathname.match(/^\/outputs\/([a-f0-9-]+)\.mp4$/);
 let file;if(download){const j=jobs.get(download[1]);if(!j||j.status!=='completed')return json(res,404,{error:'Output unavailable.'});file=j.output;}else{file=path.join(root,'dist',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));if(!file.startsWith(path.join(root,'dist')+path.sep))return json(res,403,{error:'Forbidden'});}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});
 if(download)res.setHeader('Content-Disposition','attachment; filename="msk-cleaned.mp4"');
 const size=fs.statSync(file).size,type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp4':'video/mp4','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream';
 const range=req.headers.range;
 if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m)return res.writeHead(416).end();const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;if(start>end||start>=size)return res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();res.writeHead(206,{'Content-Type':type,'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}else{res.writeHead(200,{'Content-Type':type,'Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(file).pipe(res);}
 }catch(e){if(!res.headersSent)json(res,500,{error:e.message});}
});
server.requestTimeout=30*60*1000;
server.listen(port,config.host,()=>console.log(`Clearframe ready at http://localhost:${server.address().port}`));
