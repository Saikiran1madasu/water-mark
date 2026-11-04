import {build} from 'esbuild';
import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});
fs.cpSync('public','dist',{recursive:true});
await build({entryPoints:{'browser-app':'src/app.js','browser-worker':'src/worker.js'},bundle:true,format:'esm',outdir:'dist',target:'es2022',minify:true,sourcemap:true,legalComments:'eof'});
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])fs.copyFileSync(name,'dist/'+name);
fs.copyFileSync('node_modules/mediabunny/LICENSE','dist/MEDIABUNNY-LICENSE.txt');
fs.writeFileSync('dist/.nojekyll','');
console.log('Browser-only site built in dist. No processing server is required.');
