import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {deploymentConfig,createJobStore} from '../deployment.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'msk-hosting-'));
const id='01234567-89ab-4cde-8fab-0123456789ab';

test('hosted settings allow only exact configured website origins',()=>{
  const config=deploymentConfig(root,{HOST:'0.0.0.0',ALLOWED_ORIGINS:'https://owner.github.io, https://studio.example',PUBLIC_URL:'https://engine.example',MSK_DATA_DIR:'/tmp/msk-test'});
  assert.equal(config.host,'0.0.0.0');assert.equal(config.origins.size,3);
  assert(config.origins.has('https://owner.github.io'));
  assert.throws(()=>deploymentConfig(root,{ALLOWED_ORIGINS:'https://owner.github.io/repository/'}));
  assert.throws(()=>deploymentConfig(root,{MAX_UPLOAD_MB:'-1'}));
  assert.throws(()=>deploymentConfig(root,{OUTPUT_RETENTION_HOURS:'nonsense'}));
});

test('completed exports survive restart, interrupted work fails honestly, expired files disappear',()=>{
  const dir=temp();
  try {
    let store=createJobStore(dir,3600000);
    const completed={id,status:'completed',createdAt:Date.now(),finishedAt:Date.now(),stats:{frames:144}};
    fs.writeFileSync(path.join(dir,id+'.mp4'),'video');store.save(completed);
    const interrupted={...completed,id:'11234567-89ab-4cde-8fab-0123456789ab',status:'processing'};
    fs.writeFileSync(path.join(dir,interrupted.id+'.input'),'private input');store.save(interrupted);
    store=createJobStore(dir,3600000);
    assert.equal(store.jobs.get(id).status,'completed');assert.equal(store.jobs.get(id).stats.frames,144);
    assert.equal(store.jobs.get(interrupted.id).status,'failed');
    assert.match(store.jobs.get(interrupted.id).error,/restarted/);
    assert(!fs.existsSync(path.join(dir,interrupted.id+'.input')));
    store.cleanup(Date.now()+3600001);
    assert.equal(store.jobs.size,0);assert.equal(fs.readdirSync(dir).length,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('Pages build requires a public HTTPS engine and works below a repository path',()=>{
  const build=(api,editorOnly='0')=>spawnSync(process.execPath,['scripts/build-pages.mjs'],{cwd:root,env:{...process.env,MSK_API_URL:api,MSK_EDITOR_ONLY:editorOnly},encoding:'utf8'});
  for(const invalid of ['','http://localhost:4173','https://user:secret@api.example','https://api.example/path'])assert.notEqual(build(invalid).status,0);
  assert.equal(build('','1').status,0);
  assert.match(fs.readFileSync(path.join(root,'.pages/config.js'),'utf8'),/"editorOnly":true/);
  assert.equal(build('https://api.example/').status,0);
  const config=fs.readFileSync(path.join(root,'.pages/config.js'),'utf8');assert.match(config,/https:\/\/api.example/);assert(!config.includes('localhost'));
  const html=fs.readFileSync(path.join(root,'.pages/index.html'),'utf8');
  assert(!/\b(?:src|href)="\/(?!\/)/.test(html));
  assert(html.includes('./config.js'));assert(html.indexOf('./config.js')<html.indexOf('./app.js'));
  assert(fs.existsSync(path.join(root,'.pages/.nojekyll')));
  fs.rmSync(path.join(root,'.pages'),{recursive:true,force:true});
});

test('hosted HTTP accepts Pages, rejects unrelated origins, restores range downloads',async()=>{
  const dir=temp(),store=createJobStore(dir,3600000);
  fs.writeFileSync(path.join(dir,id+'.mp4'),'0123456789');
  store.save({id,status:'completed',createdAt:Date.now(),finishedAt:Date.now(),stats:{frames:144}});
  const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0',HOST:'127.0.0.1',MSK_DATA_DIR:dir,PUBLIC_URL:'https://engine.example',ALLOWED_ORIGINS:'https://owner.github.io'},stdio:['ignore','pipe','pipe']});
  try {
    const address=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Server startup timed out')),20000);
      server.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}`));});
      server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});
    });
    const health=await fetch(address+'/api/health',{headers:{Origin:'https://owner.github.io'}});
    assert.equal(health.status,200);assert.equal(health.headers.get('access-control-allow-origin'),'https://owner.github.io');
    const status=await health.json();const ready=await fetch(address+'/api/ready');assert.equal(ready.status,status.available?200:503);
    assert.equal((await fetch(address+'/api/health',{headers:{Origin:'https://unrelated.example'}})).status,403);
    const cors=await fetch(address+'/api/jobs',{method:'OPTIONS',headers:{Origin:'https://owner.github.io','Access-Control-Request-Method':'POST'}});assert.equal(cors.status,204);
    const result=await fetch(address+'/outputs/'+id+'.mp4',{headers:{Origin:'https://owner.github.io',Range:'bytes=2-5'}});
    assert.equal(result.status,206);assert.equal(await result.text(),'2345');assert.match(result.headers.get('content-disposition'),/attachment/);
    assert.equal((await (await fetch(address+'/api/jobs/'+id)).json()).status,'completed');
  } finally {
    server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
});
