import test from 'node:test';import assert from 'node:assert/strict';import {illuminationPlate,lightingBoundary} from '../src/illumination.js';
test('curved lighting is predicted from clean boundary samples without a flat patch',()=>{
 const w=140,h=90,r={x:78,y:28,w:30,h:30},clean=new Uint8ClampedArray(w*h*4),observed=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=195+25*Math.exp(-((x-96)**2/700+(y-40)**2/500)),i=(y*w+x)*4;clean.set([v-15,v-3,v+4,255],i);}
 observed.set(clean);for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)for(let c=0;c<3;c++)observed[(y*w+x)*4+c]=255;
 const fit=illuminationPlate(observed,w,h,r);assert(fit);const plate=lightingBoundary(observed,w,h,r,fit.plate,fit.predict);let error=0;
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)for(let c=0;c<3;c++)error+=Math.abs(plate[(y*r.w+x)*4+c]-clean[((y+r.y)*w+x+r.x)*4+c]);assert(error/(r.w*r.h*3)<3);
});
