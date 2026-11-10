import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist'),port=Number(process.env.PORT||4174);
const server=http.createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  // Explicit development-only review output. These routes do not exist on Pages
  // and are disabled on the normal studio server.
  if(process.env.BROWSER_TEST==='1'&&req.method==='POST'&&['/__test__/save-report','/__test__/save-export'].includes(pathname)){
    const allowed=['http://'+req.headers.host];
    if(req.headers.origin&&!allowed.includes(req.headers.origin)){res.writeHead(403).end();return;}
    try{
      const report=pathname.endsWith('save-report'),type=req.headers['content-type'];
      if(report?type!=='application/json':!['video/mp4','video/webm'].includes(type)){res.writeHead(415).end();return;}
      const limit=report?512*1024:64*1024*1024,chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>limit){res.writeHead(413).end();return;}chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);if(report){const value=JSON.parse(bytes.toString());if(!['PASS','FAIL'].includes(value.status))throw Error('Invalid test report.');}
      const name=report?'browser-v02-verification.json':`browser-v02-evaluation.${type==='video/mp4'?'mp4':'webm'}`;
      fs.mkdirSync('.runtime',{recursive:true});fs.writeFileSync(path.join('.runtime',name),bytes);
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({saved:name}));
    }catch{res.writeHead(400).end('Could not save local test output.');}return;
  }
  let file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(process.env.BROWSER_TEST==='1'&&pathname==='/tests-runner.js'){file=path.resolve('tests/runner.js');}
  // Test fixtures stay on loopback and are excluded from the production bundle.
  if(process.env.BROWSER_TEST==='1'&&pathname.startsWith('/__test__/')){
    const fixture=pathname.slice('/__test__/'.length);
    if(fixture==='real.mp4'&&process.env.BROWSER_TEST_VIDEO)file=process.env.BROWSER_TEST_VIDEO;
    else if(['runner.html','timing-audio.mp4','worker-before.js'].includes(fixture))file=path.resolve('tests',fixture);
    else{res.writeHead(404).end();return;}
  }else if(pathname!=='/tests-runner.js'&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  const size=fs.statSync(file).size,type=({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.mp4':'video/mp4','.txt':'text/plain'})[path.extname(file)]||'application/octet-stream';
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  if(range){const start=Number(range[1]),end=range[2]?Math.min(size-1,Number(range[2])):size-1;if(start>end||start>=size){res.writeHead(416).end();return;}res.writeHead(206,{'Content-Type':type,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});fs.createReadStream(file,{start,end}).pipe(res);}
  else{res.writeHead(200,{'Content-Type':type,'Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(file).pipe(res);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Browser studio: http://localhost:${server.address().port}/`));
