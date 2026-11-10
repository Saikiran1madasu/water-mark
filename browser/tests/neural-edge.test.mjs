import test from 'node:test';import assert from 'node:assert/strict';import {alignNeuralEdge} from '../src/neural-edge.js';
function fixture({curved=false,contrast=75}={}){
 const w=96,h=96,n=w*h,mask=new Uint8Array(n).fill(255),source=new Float32Array(n*3),prediction=new Float32Array(n*3),truth=new Float32Array(n*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,hole=(x-48)**2+(y-48)**2<18**2;mask[i]=hole?0:255;const edge=48+.1*(y-48)+(curved?.015*(y-48)**2:0),bend=2*Math.exp(-Math.pow((y-48)/10,2));
  for(let c=0;c<3;c++){const p=45+c*15+contrast/(1+Math.exp(-(x-edge)/1.7));truth[c*n+i]=p;source[c*n+i]=hole?p*.7+255*.3:p;prediction[c*n+i]=hole?45+c*15+contrast/(1+Math.exp(-(x-edge-bend)/1.7)):p;}
 }return {w,h,n,mask,source,prediction,truth};
}
function error(image,f){let sum=0,count=0;for(let i=0;i<f.n;i++)if(!f.mask[i])for(let c=0;c<3;c++){sum+=Math.abs(image[c*f.n+i]-f.truth[c*f.n+i]);count++;}return sum/count;}
test('visible two-sided anchors reduce a generated bend without changing known pixels',()=>{
 const f=fixture(),r=alignNeuralEdge(f.source,f.prediction,f.mask,f.w,f.h);assert(r.pixels>0);assert(error(r.image,f)<error(f.prediction,f)*.3);
 for(let i=0;i<f.n;i++)if(f.mask[i])for(let c=0;c<3;c++)assert.equal(r.image[c*f.n+i],f.prediction[c*f.n+i]);
});
test('covered source pixels cannot determine the inferred edge',()=>{
 const f=fixture(),a=alignNeuralEdge(f.source,f.prediction,f.mask,f.w,f.h),changed=f.source.slice();for(let i=0;i<f.n;i++)if(!f.mask[i])for(let c=0;c<3;c++)changed[c*f.n+i]=(i*17+c*43)%255;
 const b=alignNeuralEdge(changed,f.prediction,f.mask,f.w,f.h);assert.deepEqual(b.image,a.image);assert.deepEqual(b.line,a.line);
});
test('a genuinely curved visible edge is not forced into a straight line',()=>{
 const f=fixture({curved:true}),r=alignNeuralEdge(f.source,f.prediction,f.mask,f.w,f.h);assert.equal(r.pixels,0);assert.equal(r.image,f.prediction);
});
test('missing opposing anchors and weak edges cannot trigger a geometry change',()=>{
 const f=fixture();for(let y=0;y<35;y++)f.mask.fill(0,y*f.w,(y+1)*f.w);assert.equal(alignNeuralEdge(f.source,f.prediction,f.mask,f.w,f.h).pixels,0);
 const weak=fixture({contrast:1});assert.equal(alignNeuralEdge(weak.source,weak.prediction,weak.mask,weak.w,weak.h).pixels,0);
});
test('empty masks preserve the proposal and malformed buffers are rejected',()=>{
 const f=fixture();f.mask.fill(255);assert.equal(alignNeuralEdge(f.source,f.prediction,f.mask,f.w,f.h).image,f.prediction);assert.throws(()=>alignNeuralEdge(f.source,f.prediction,f.mask.slice(1),f.w,f.h),/Invalid/);
});
