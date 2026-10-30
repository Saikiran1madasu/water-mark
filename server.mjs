import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url)), data=path.join(root,'.runtime');
fs.mkdirSync(data,{recursive:true});
const jobs=new Map(), port=Number(process.env.PORT||4173);
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
function command(bin,args){return new Promise((resolve,reject)=>{let out='',err='';const p=spawn(bin,args);p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err=(err+x).slice(-8000));p.on('error',reject);p.on('close',code=>code===0?resolve(out):reject(new Error(err||`${bin} failed`)));});}
let available=false;try{await command('ffmpeg',['-version']);available=true;}catch{}
async function processJob(job){
 try{
 job.status='inspecting';
 const meta=JSON.parse(await command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',job.input]));
 const video=meta.streams.find(s=>s.codec_type==='video');if(!video)throw Error('No video stream found.');
 if(Number(video.tags?.rotate||0)!==0||video.side_data_list?.some(s=>s.rotation))throw Error('Please export this rotated video upright before processing.');
 const {width:w,height:h}=video, b=job.box;
 const x=Math.max(1,Math.min(w-4,Math.round(b.x*w))),y=Math.max(1,Math.min(h-4,Math.round(b.y*h)));
 const bw=Math.min(w-x-2,Math.max(2,Math.round(b.w*w))),bh=Math.min(h-y-2,Math.max(2,Math.round(b.h*h)));
 if(bw<2||bh<2)throw Error('Select an area away from the very edge of the frame.');
 job.status='processing';job.duration=Number(meta.format.duration)||0;
 const args=['-y','-i',job.input,'-map','0:v:0','-map','0:a?','-vf',`delogo=x=${x}:y=${y}:w=${bw}:h=${bh}:show=0`,'-c:v','libx264','-preset','medium','-crf',job.quality==='high'?'17':'20','-pix_fmt','yuv420p','-fps_mode','vfr','-c:a','aac','-b:a','192k','-movflags','+faststart','-progress','pipe:1','-nostats',job.output];
 await new Promise((resolve,reject)=>{const p=spawn('ffmpeg',args);let err='',buffer='';job.process=p;p.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(line.startsWith('out_time_us=')){const sec=Number(line.split('=')[1])/1e6;job.progress=job.duration?Math.min(99,Math.round(sec/job.duration*100)):0;}}});p.stderr.on('data',x=>err=(err+x).slice(-4000));p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(err||'Processing failed.')));});
 job.status='completed';job.progress=100;
 }catch(e){job.status='failed';job.error=e.message;}
 finally{delete job.process;fs.rm(job.input,{force:true},()=>{});}
}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{available,engine:'FFmpeg spatial repair'});
 if(req.method==='POST'&&url.pathname==='/api/jobs'){
 if(!available)return json(res,503,{error:'FFmpeg is not installed on this machine.'});
 if([...jobs.values()].some(j=>['uploading','inspecting','processing'].includes(j.status)))return json(res,409,{error:'Another video is processing. Please wait.'});
 let box;try{box=JSON.parse(url.searchParams.get('box'));}catch{}
 if(!box||!['x','y','w','h'].every(k=>Number.isFinite(box[k]))||box.x<0||box.y<0||box.w<=0||box.h<=0||box.x+box.w>1.001||box.y+box.h>1.001)return json(res,400,{error:'Invalid selection.'});
 if(!req.headers['content-type']?.startsWith('video/'))return json(res,400,{error:'Upload a video file.'});
 const id=randomUUID(),job={id,status:'uploading',progress:0,box,quality:url.searchParams.get('quality'),input:path.join(data,`${id}.input`),output:path.join(data,`${id}.mp4`)};jobs.set(id,job);
 let bytes=0;const writer=fs.createWriteStream(job.input);let failed=false;
 req.on('data',chunk=>{bytes+=chunk.length;if(bytes>500*1024*1024){failed=true;req.destroy();writer.destroy();fs.rm(job.input,{force:true},()=>{});jobs.delete(id);}});
 req.pipe(writer);req.on('aborted',()=>{failed=true;writer.destroy();jobs.delete(id);fs.rm(job.input,{force:true},()=>{});});writer.on('error',()=>{failed=true;jobs.delete(id);if(!res.headersSent)json(res,500,{error:'Could not save upload.'});});
 writer.on('finish',()=>{if(!failed){json(res,202,{id});processJob(job);}});return;
 }
 const match=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
 if(req.method==='GET'&&match){const j=jobs.get(match[1]);return j?json(res,200,{id:j.id,status:j.status,progress:j.progress,error:j.error}):json(res,404,{error:'Job expired. Process your video again.'});}
 const download=url.pathname.match(/^\/outputs\/([a-f0-9-]+)\.mp4$/);
 let file;if(download){const j=jobs.get(download[1]);if(!j||j.status!=='completed')return json(res,404,{error:'Output unavailable.'});file=j.output;}else{file=path.join(root,'dist',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));if(!file.startsWith(path.join(root,'dist')+path.sep))return json(res,403,{error:'Forbidden'});}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});
 const size=fs.statSync(file).size,type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp4':'video/mp4','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream';
 const range=req.headers.range;
 if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m)return res.writeHead(416).end();const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;if(start>end||start>=size)return res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();res.writeHead(206,{'Content-Type':type,'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}else{res.writeHead(200,{'Content-Type':type,'Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(file).pipe(res);}
 }catch(e){if(!res.headersSent)json(res,500,{error:e.message});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Clearframe ready at http://localhost:${port}`));
