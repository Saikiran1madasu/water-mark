import test from 'node:test';import assert from 'node:assert/strict';
import {matchFootprintBoundary} from '../src/blend.js';
test('outline correction matches local exposure while retaining donor texture',()=>{
 const w=48,r={x:0,y:0,w:48,h:48},data=new Uint8ClampedArray(w*w*4),plate=new Uint8ClampedArray(data.length),alpha=new Float32Array(w*w);
 for(let y=0;y<w;y++)for(let x=0;x<w;x++){
  const i=y*w+x,v=150+10*Math.sin(x*1.7)+8*Math.cos(y*.9);
  data.set([v+6,v+6,v+6,255],i*4);plate.set([v,v,v,255],i*4);
  if(Math.abs(x-24)+Math.abs(y-24)<10){alpha[i]=1;data.fill(255,i*4,i*4+3);}
 }
 const corrected=matchFootprintBoundary(data,w,r,plate,{alpha});
 let before=0,after=0;for(let i=0;i<alpha.length;i++)if(alpha[i]){before+=Math.abs(plate[i*4]-(150+10*Math.sin((i%w)*1.7)+8*Math.cos(Math.floor(i/w)*.9)+6));after+=Math.abs(corrected[i*4]-(150+10*Math.sin((i%w)*1.7)+8*Math.cos(Math.floor(i/w)*.9)+6));}else assert.equal(corrected[i*4],plate[i*4]);
 assert(after<before*.15);assert.equal(data[(24*w+24)*4],255);
});
test('outline matching cannot propagate unbounded exposure or mutate the plate',()=>{
 const r={x:0,y:0,w:12,h:12},plate=new Uint8ClampedArray(12*12*4).fill(100),data=new Uint8ClampedArray(plate.length).fill(250),alpha=new Float32Array(144);alpha[78]=1;
 const result=matchFootprintBoundary(data,12,r,plate,{alpha},8);assert.equal(result[78*4],108);assert.equal(plate[78*4],100);
});
