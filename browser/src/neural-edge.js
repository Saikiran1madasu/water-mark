// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Constrain a generated near-vertical edge using two-sided visible anchors.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function alignNeuralEdge(source,prediction,mask,w,h){
 const n=w*h;if(!Number.isInteger(w)||!Number.isInteger(h)||source.length!==n*3||prediction.length!==n*3||mask.length!==n)throw Error('Invalid edge-alignment frame.');if(w<8||h<8)return {image:prediction,pixels:0};
 const luma=Float32Array.from({length:n},(_,i)=>(source[i]+2*source[n+i]+source[2*n+i])/4),generated=Float32Array.from({length:n},(_,i)=>(prediction[i]+2*prediction[n+i]+prediction[2*n+i])/4);
 let x0=w,y0=h,x1=0,y1=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!mask[y*w+x]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
 if(x0>x1)return {image:prediction,pixels:0};
 const gx=(a,x,y)=>(a[y*w+x+2]+2*a[y*w+x+1]-2*a[y*w+x-1]-a[y*w+x-2])/8;
 const gradient=(a,x,y)=>(gx(a,x,y-1)+2*gx(a,x,y)+gx(a,x,y+1))/4;
 const points=[],lo=Math.max(3,y0-14),hi=Math.min(h-4,y1+14),left=Math.max(3,x0-14),right=Math.min(w-4,x1+14);
 for(let y=lo;y<=hi;y++){
  const candidates=[];
  for(let x=left;x<=right;x++){
   let known=true;for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-3;xx<=x+3;xx++)if(!mask[yy*w+xx])known=false;if(!known)continue;
   const g=gradient(luma,x,y),m=Math.abs(g);if(m<1.5)continue;
   const a=Math.abs(gradient(luma,x-1,y)),b=Math.abs(gradient(luma,x+1,y));if(m<a||m<b)continue;
   const denominator=a-2*m+b,offset=Math.abs(denominator)>1e-5?clamp(.5*(a-b)/denominator,-.5,.5):0;candidates.push({x:x+offset,y,m,sign:Math.sign(g)});
  }
  candidates.sort((a,b)=>b.m-a.m);const keep=[];for(const c of candidates){if(keep.every(p=>Math.abs(p.x-c.x)>5))keep.push(c);if(keep.length===3)break;}points.push(...keep);
 }
 const top=points.filter(p=>p.y<y0-3),bottom=points.filter(p=>p.y>y1+3);let best=null;
 for(const p of top)for(const q of bottom){
  if(p.sign!==q.sign)continue;let slope=(q.x-p.x)/(q.y-p.y),intercept=p.x-slope*p.y;if(Math.abs(slope)>.5)continue;
  let inliers=points.filter(v=>v.sign===p.sign&&Math.abs(v.x-slope*v.y-intercept)<1.2);
  if(inliers.length<22||inliers.filter(v=>v.y<y0).length<6||inliers.filter(v=>v.y>y1).length<6)continue;
  const meanY=inliers.reduce((s,v)=>s+v.y,0)/inliers.length,meanX=inliers.reduce((s,v)=>s+v.x,0)/inliers.length;
  let cov=0,variance=0;for(const v of inliers){cov+=(v.y-meanY)*(v.x-meanX);variance+=(v.y-meanY)**2;}slope=cov/variance;intercept=meanX-slope*meanY;
  const rms=Math.sqrt(inliers.reduce((s,v)=>s+(v.x-slope*v.y-intercept)**2,0)/inliers.length);if(rms>.55)continue;
  let hidden=0;for(let y=y0;y<=y1;y++){const x=Math.round(slope*y+intercept);if(x>=0&&x<w&&!mask[y*w+x])hidden++;}if(hidden<10)continue;
  const strength=inliers.reduce((s,v)=>s+Math.min(6,v.m),0)/inliers.length,score=inliers.length*strength/(1+rms*rms);
  if(!best||score>best.score)best={slope,intercept,sign:p.sign,strength,rms,score,hidden,inliers:inliers.length};
 }
 if(!best)return {image:prediction,pixels:0};
 const shifts=new Float32Array(h),valid=new Uint8Array(h);
 for(let y=y0;y<=y1;y++){
  const expected=best.slope*y+best.intercept;let winner=null;
  for(let x=Math.max(3,Math.floor(expected-4));x<=Math.min(w-4,Math.ceil(expected+4));x++){
   const g=gradient(generated,x,y)*best.sign;if(g<best.strength*.4)continue;if(!winner||g>winner.g)winner={x,g};
  }
  if(!winner)continue;
  const x=winner.x,a=gradient(generated,x-1,y)*best.sign,b=winner.g,c=gradient(generated,x+1,y)*best.sign,den=a-2*b+c,sub=Math.abs(den)>1e-5?clamp(.5*(a-c)/den,-.5,.5):0;
  const shift=x+sub-expected;if(Math.abs(shift)>2.5)continue;shifts[y]=shift;valid[y]=1;
 }
 const distance=Uint16Array.from(mask,v=>v?0:1000);
 for(let y=1;y<h;y++)for(let x=1;x<w;x++){const i=y*w+x;distance[i]=Math.min(distance[i],distance[i-1]+1,distance[i-w]+1);}
 for(let y=h-2;y>=0;y--)for(let x=w-2;x>=0;x--){const i=y*w+x;distance[i]=Math.min(distance[i],distance[i+1]+1,distance[i+w]+1);}
 const out=prediction.slice();let pixels=0;
 for(let y=y0;y<=y1;y++)if(valid[y]){
  let shift=0,weight=0;for(let yy=Math.max(y0,y-2);yy<=Math.min(y1,y+2);yy++)if(valid[yy]){const v=3-Math.abs(y-yy);shift+=shifts[yy]*v;weight+=v;}shift/=weight;
  for(let x=x0;x<=x1;x++){const i=y*w+x;if(mask[i])continue;
   const delta=shift*Math.min(1,distance[i]/3)*Math.max(0,1-Math.abs(x-best.slope*y-best.intercept)/18);if(Math.abs(delta)<.05)continue;
   const xx=clamp(x+delta,0,w-1),a=Math.floor(xx),b=Math.min(w-1,a+1),t=xx-a;
   let changed=false;for(let c=0;c<3;c++){const j=c*n+i;out[j]=Math.round(prediction[c*n+y*w+a]*(1-t)+prediction[c*n+y*w+b]*t);changed||=out[j]!==prediction[j];}if(changed)pixels++;
  }
 }
 return {image:out,pixels,line:best};
}
