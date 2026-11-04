// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Match the reconstructed plate to clean pixels around the actual logo outline.
// Only the low-frequency residual is diffused; donor texture remains intact.
export function matchFootprintBoundary(data,w,r,plate,shape,limit=12){
  if(!shape)return plate;
  const n=r.w*r.h,fixed=new Uint8Array(n);
  let residual=new Float32Array(n*3),next=new Float32Array(n*3),anchors=0;const mean=[0,0,0];
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
    const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4;
    fixed[i]=shape.alpha[i]===0;
    if(!fixed[i])continue;
    anchors++;
    for(let c=0;c<3;c++){residual[i*3+c]=Math.max(-limit,Math.min(limit,data[j+c]-plate[i*4+c]));mean[c]+=residual[i*3+c];}
  }
  if(anchors<n*.1)return plate;
  // Do not turn single-level codec noise into a fresh brightness correction.
  if(Math.max(...mean.map(v=>Math.abs(v/anchors)))<1.25)return plate;
  next.set(residual);
  for(let pass=0;pass<160;pass++){
    let change=0;
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x;if(fixed[i])continue;
      const count=(x>0)+(x+1<r.w)+(y>0)+(y+1<r.h);
      for(let c=0;c<3;c++){
        let sum=0;if(x)sum+=residual[(i-1)*3+c];if(x+1<r.w)sum+=residual[(i+1)*3+c];if(y)sum+=residual[(i-r.w)*3+c];if(y+1<r.h)sum+=residual[(i+r.w)*3+c];
        const v=sum/count;change=Math.max(change,Math.abs(v-residual[i*3+c]));next[i*3+c]=v;
      }
    }
    [residual,next]=[next,residual];if(change<.015)break;
  }
  const result=plate.slice();
  for(let i=0;i<n;i++)if(shape.alpha[i]>0)for(let c=0;c<3;c++)result[i*4+c]+=residual[i*3+c];
  return result;
}
