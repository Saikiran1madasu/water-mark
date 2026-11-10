import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {once} from 'node:events';import readline from 'node:readline';
async function server(t,enabled){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msk-review-')),child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/serve.mjs',import.meta.url))],{cwd:dir,env:{...process.env,PORT:'0',BROWSER_TEST:enabled?'1':'0'},stdio:['ignore','pipe','ignore']}),lines=readline.createInterface({input:child.stdout});
 t.after(()=>{lines.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});});
 const [line]=await once(lines,'line');return {url:/http:\/\/localhost:\d+/.exec(line)[0],dir};
}
test('normal studio serving cannot accept or save development reports or exports',async t=>{
 const {url,dir}=await server(t,false);
 for(const endpoint of ['save-report','save-export']){const r=await fetch(url+'/__test__/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'PASS'})});assert.equal(r.status,404);}
 assert(!fs.existsSync(path.join(dir,'.runtime')));
});
test('local review saves fixed files only and rejects unrelated origins and formats',async t=>{
 const {url,dir}=await server(t,true),route=url+'/__test__/save-report';
 let response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'PASS',fixture:{frames:240}})});assert.equal(response.status,200);
 const saved=path.join(dir,'.runtime/browser-v02-verification.json');assert.equal(JSON.parse(fs.readFileSync(saved)).fixture.frames,240);
 response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify({status:'FAIL'})});assert.equal(response.status,403);assert.equal(JSON.parse(fs.readFileSync(saved)).status,'PASS');
 response=await fetch(url+'/__test__/save-export',{method:'POST',headers:{'Content-Type':'application/x-executable'},body:'unrelated'});assert.equal(response.status,415);
 response=await fetch(url+'/__test__/save-export',{method:'POST',headers:{'Content-Type':'video/mp4'},body:new Uint8Array([1,2,3])});assert.equal(response.status,200);assert.deepEqual(fs.readFileSync(path.join(dir,'.runtime/browser-v02-evaluation.mp4')),Buffer.from([1,2,3]));
});
