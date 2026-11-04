import {build} from 'esbuild';
await build({entryPoints:['tests/runner-entry.js'],bundle:true,format:'esm',outfile:'tests/runner.js',target:'es2022'});
await build({entryPoints:['tests/worker-before-entry.js'],bundle:true,format:'esm',outfile:'tests/worker-before.js',target:'es2022'});
