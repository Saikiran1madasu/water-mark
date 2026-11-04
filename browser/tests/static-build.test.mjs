import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('the browser source has no server job calls or localhost engine connection',()=>{
 const app=fs.readFileSync('src/app.js','utf8'),worker=fs.readFileSync('src/worker.js','utf8');
 assert(!app.includes('/api/jobs'));assert(!app.includes('/api/health'));assert(!app.includes('MSK_CONFIG'));
 assert(!worker.includes('fetch('));assert(app.includes("new URL('./browser-worker.js',import.meta.url)"));
});
test('production HTML uses a relative browser module and has no backend config script',()=>{
 const html=fs.readFileSync('public/index.html','utf8');assert(html.includes('type="module" src="./browser-app.js"'));assert(!html.includes('src="./config.js"'));assert(!/\b(src|href)="\/(?!\/)/.test(html));
});
test('playable comparison ships all actual export assets and identifies the clean reference',()=>{
 const html=fs.readFileSync('public/index.html','utf8');
 for(const suffix of ['', '-repaired','-previous','-clean'])assert(fs.statSync('public/examples/pattern-lighting'+suffix+'.mp4').size>1000);
 const info=JSON.parse(fs.readFileSync('public/examples/pattern-lighting.json','utf8'));assert.equal(info.referencePassedToEngine,false);assert.equal(info.frames,96);
 assert(html.includes('id="example-comparison"'));assert(html.includes('clean reference'));assert(!html.includes('local-motion-clean.mp4'));assert(html.includes('href="./examples/pattern-lighting-clean.mp4"'));
});
