import test from 'node:test';import assert from 'node:assert/strict';
import {repairTangents} from '../src/tangent-repair.js';import {estimateNormals} from '../src/tangent-normals.js';
const w=96,h=96,r={x:28,y:24,w:40,h:44},n=r.w*r.h;
function fixture(phase=0,flat=false){
 const clean=new Uint8ClampedArray(w*h*4),original=new Uint8ClampedArray(w*h*4),alpha=new Float32Array(n),band=new Uint8Array(n),core=new Uint8Array(n),nx=new Float32Array(n),ny=new Float32Array(n),confidence=new Float32Array(n);
 const opacity=x=>.3*Math.min(1,Math.max(0,(x-38)/3))*Math.min(1,Math.max(0,(58-x)/3));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const j=(y*w+x)*4,a=opacity(x),v=flat?100:100+15*Math.sin(y*.42+phase);for(let c=0;c<3;c++){clean[j+c]=v+c*5;original[j+c]=clean[j+c]*(1-a)+255*a;}clean[j+3]=original[j+3]=255;}
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=y*r.w+x,xx=x+r.x;alpha[i]=opacity(xx);band[i]=y>3&&y<r.h-4&&((xx>=38&&xx<=42)||(xx>=54&&xx<=58))?1:0;core[i]=alpha[i]>.29&&!band[i]?1:0;nx[i]=xx<48?1:-1;confidence[i]=band[i];}
 const model={r,alpha,band,core,tangentNormals:{nx,ny,confidence}},repaired=clean.slice();if(!flat)for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(band[y*r.w+x])for(let c=0;c<3;c++)repaired[((y+r.y)*w+x+r.x)*4+c]=100+c*5;
 return {clean,original,repaired,model};
}
test('source tangent gradients recover genuine crossing texture while preserving core, exterior and alpha',()=>{
 const f=fixture(),before=f.repaired.slice(),original=f.original.slice(),result=repairTangents(f.original,f.repaired,w,h,r,f.model);assert(result.pixels>0);let a=0,b=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const local=x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h?(y-r.y)*r.w+x-r.x:-1,j=(y*w+x)*4;for(let c=0;c<4;c++)if(local<0||!f.model.band[local]||c===3)assert.equal(result.data[j+c],before[j+c]);else{a+=Math.abs(result.data[j+c]-f.clean[j+c]);b+=Math.abs(before[j+c]-f.clean[j+c]);}}
 assert(a<b*.8,`${a} should improve ${b}`);assert.deepEqual(f.original,original);assert.deepEqual(f.repaired,before);
});
test('a flat original background cannot acquire a contour patch from tangent refinement',()=>{
 const f=fixture(0,true),result=repairTangents(f.original,f.repaired,w,h,r,f.model);assert.equal(result.pixels,0);assert.deepEqual(result.data,f.clean);
});
test('protected original-reference pixels remain fixed and corrections stay bounded',()=>{
 const f=fixture(),preserveMask=Uint8Array.from(f.model.band,(v,i)=>v&&i%2?1:0),before=f.repaired.slice(),result=repairTangents(f.original,f.repaired,w,h,r,f.model,{preserveMask,limit:3});
 assert(result.pixels>0);for(let i=0;i<n;i++){const j=((r.y+Math.floor(i/r.w))*w+r.x+i%r.w)*4;for(let c=0;c<3;c++){if(preserveMask[i])assert.equal(result.data[j+c],before[j+c]);assert(Math.abs(result.data[j+c]-before[j+c])<=3);}}
 assert.throws(()=>repairTangents(f.original,f.repaired,w,h,r,f.model,{preserveMask:new Uint8Array(1)}),/Invalid/);
 const invalid={...f.model,tangentNormals:{...f.model.tangentNormals,confidence:new Float32Array(n).fill(NaN)}};assert.throws(()=>repairTangents(f.original,f.repaired,w,h,r,invalid),/Invalid/);
});
test('source-derived normals distinguish a real fixed overlay from unrelated moving background gradients',()=>{
 const f=fixture(),frames=Array.from({length:12},(_,i)=>fixture(i*Math.PI/6).original),normals=estimateNormals(frames,w,h,r,f.model);assert(normals.accepted>20);
 const empty=estimateNormals(Array.from({length:12},(_,i)=>fixture(i*Math.PI/6).clean),w,h,r,f.model);assert.equal(empty.accepted,0);
 const none={...f.model,tangentNormals:null};assert.equal(repairTangents(f.original,f.repaired,w,h,r,none),null);
});
