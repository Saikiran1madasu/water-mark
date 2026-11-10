// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
import fs from 'node:fs';
import path from 'node:path';

export function deploymentConfig(root, env=process.env) {
  const positive=(name,fallback)=>{
    const value=Number(env[name]??fallback);
    if(!Number.isFinite(value)||value<=0)throw Error(`${name} must be a positive number.`);
    return value;
  };
  const origins=new Set();
  for(const value of [env.PUBLIC_URL,env.RENDER_EXTERNAL_URL,...(env.ALLOWED_ORIGINS||'').split(',')].filter(Boolean)) {
    const url=new URL(value.trim());
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('Use exact website origins in PUBLIC_URL and ALLOWED_ORIGINS.');
    origins.add(url.origin);
  }
  return {
    host:env.HOST||'127.0.0.1', data:path.resolve(env.MSK_DATA_DIR||path.join(root,'.runtime')), origins,
    maxUploadBytes:positive('MAX_UPLOAD_MB',500)*1024*1024,
    maxDuration:positive('MAX_DURATION_SECONDS',3600), maxPixels:positive('MAX_VIDEO_PIXELS',3840*2160),
    timeoutMs:positive('JOB_TIMEOUT_SECONDS',1200)*1000,
    retentionMs:positive('OUTPUT_RETENTION_HOURS',24)*3600000,
  };
}

export function createJobStore(data,retentionMs) {
  fs.mkdirSync(data,{recursive:true});
  const jobs=new Map();
  const valid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const files=id=>['.input','.preview.mp4','.repaired.mp4'];
  function save(job) {
    const {process,...record}=job;
    const filename=path.join(data,`${job.id}.job.json`);
    fs.writeFileSync(filename+'.tmp',JSON.stringify(record));
    fs.renameSync(filename+'.tmp',filename);
  }
  function remove(job) {
    for(const suffix of [...files(job.id),'.mp4','.job.json','.job.json.tmp'])fs.rmSync(path.join(data,job.id+suffix),{force:true});
    jobs.delete(job.id);
  }
  function cleanup(now=Date.now()) {
    for(const job of jobs.values())if(['completed','failed'].includes(job.status)&&now-(job.finishedAt||job.createdAt)>retentionMs)remove(job);
  }
  for(const name of fs.readdirSync(data)) {
    const id=name.replace(/\.job\.json$/,'');
    if(!name.endsWith('.job.json')||!valid.test(id))continue;
    let job;try{job=JSON.parse(fs.readFileSync(path.join(data,name),'utf8'));}catch{continue;}
    job.id=id;job.input=path.join(data,id+'.input');job.output=path.join(data,id+'.mp4');
    delete job.process;delete job.previewInput;delete job.intermediate;
    if(!['completed','failed'].includes(job.status)) {
      job.status='failed';job.error='The processing server restarted. Please upload your video again.';job.finishedAt=Date.now();
      fs.rmSync(job.output,{force:true});
    }
    if(job.status==='completed'&&!fs.existsSync(job.output)) {job.status='failed';job.error='This export is no longer available.';}
    job.createdAt=Number(job.createdAt)||fs.statSync(path.join(data,name)).mtimeMs;
    for(const suffix of files(id))fs.rmSync(path.join(data,id+suffix),{force:true});
    jobs.set(id,job);save(job);
  }
  cleanup();
  return {jobs,save,cleanup,remove};
}
