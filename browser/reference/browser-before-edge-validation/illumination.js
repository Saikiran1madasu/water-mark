// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Thin-plate illumination interpolation validated on withheld visible samples.
function linearSolve(matrix,rhs){
  const n=matrix.length,a=matrix.map((row,i)=>Float64Array.from([...row,...rhs[i]]));
  for(let k=0;k<n;k++){
    let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;
    [a[k],a[pivot]]=[a[pivot],a[k]];if(Math.abs(a[k][k])<1e-10)return null;
    const d=a[k][k];for(let j=k;j<n+3;j++)a[k][j]/=d;
    for(let i=0;i<n;i++)if(i!==k){const f=a[i][k];if(!f)continue;for(let j=k;j<n+3;j++)a[i][j]-=f*a[k][j];}
  }
  return a.map(row=>row.slice(n));
}
const kernel=(a,b)=>{const d=(a.x-b.x)**2+(a.y-b.y)**2;return d*.5*Math.log(d+1e-12);};
function fit(points){
  const n=points.length,matrix=Array.from({length:n+3},()=>Array(n+3).fill(0)),rhs=Array.from({length:n+3},()=>[0,0,0]);
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++)matrix[i][j]=kernel(points[i],points[j])+(i===j?1e-4:0);
    const basis=[1,points[i].x,points[i].y];for(let j=0;j<3;j++)matrix[i][n+j]=matrix[n+j][i]=basis[j];rhs[i]=points[i].rgb;
  }
  const coeff=linearSolve(matrix,rhs);if(!coeff)return null;
  return p=>{const result=[0,0,0];for(let i=0;i<n;i++){const k=kernel(p,points[i]);for(let c=0;c<3;c++)result[c]+=k*coeff[i][c];}for(let c=0;c<3;c++)result[c]+=coeff[n][c]+p.x*coeff[n+1][c]+p.y*coeff[n+2][c];return result;};
}
export function illuminationPlate(data,w,h,r){
  const scale=Math.max(r.w,r.h,32),points=[];
  for(let y=Math.max(0,r.y-12);y<Math.min(h,r.y+r.h+12);y+=4)for(let x=Math.max(0,r.x-12);x<Math.min(w,r.x+r.w+12);x+=4){
    if(x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h)continue;
    const i=(y*w+x)*4;points.push({x:(x-r.x)/scale,y:(y-r.y)/scale,rgb:[data[i],data[i+1],data[i+2]]});
  }
  if(points.length<24)return null;
  const selected=points.length>96?Array.from({length:96},(_,i)=>points[Math.floor(i*(points.length-1)/95)]):points;
  const train=selected.filter((_,i)=>i%7),test=selected.filter((_,i)=>i%7===0),trial=fit(train);if(!trial)return null;
  let error=0;for(const p of test){const rgb=trial(p);for(let c=0;c<3;c++)error+=(rgb[c]-p.rgb[c])**2;}
  if(Math.sqrt(error/(test.length*3))>5)return null;
  const predict=fit(selected);if(!predict)return null;
  const minimum=[0,1,2].map(c=>Math.min(...selected.map(p=>p.rgb[c]))-15),maximum=[0,1,2].map(c=>Math.max(...selected.map(p=>p.rgb[c]))+15);
  const plate=new Float32Array(r.w*r.h*4);
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
    const rgb=predict({x:x/scale,y:y/scale}),i=(y*r.w+x)*4;
    for(let c=0;c<3;c++){if(!Number.isFinite(rgb[c])||rgb[c]<minimum[c]||rgb[c]>maximum[c])return null;plate[i+c]=rgb[c];}plate[i+3]=255;
  }
  return {plate,predict:(x,y)=>predict({x:(x-r.x)/scale,y:(y-r.y)/scale})};
}
export function lightingBoundary(data,w,h,r,plate,predict,maxCorrection=12){
  const pw=r.w+2,ph=r.h+2;let current=new Float32Array(pw*ph*3),next=new Float32Array(current.length);
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++)if(x===0||y===0||x===pw-1||y===ph-1){
    const xx=Math.max(0,Math.min(w-1,r.x+x-1)),yy=Math.max(0,Math.min(h-1,r.y+y-1)),rgb=predict(xx,yy),j=(yy*w+xx)*4,i=(y*pw+x)*3;
    for(let c=0;c<3;c++)current[i+c]=Math.max(-maxCorrection,Math.min(maxCorrection,data[j+c]-rgb[c]));
  }
  // Start from a boundary interpolation, rather than a flat, differently shaded patch.
  for(let y=1;y<ph-1;y++)for(let x=1;x<pw-1;x++)for(let c=0;c<3;c++){
    const fx=x/(pw-1),fy=y/(ph-1);current[(y*pw+x)*3+c]=.5*((1-fx)*current[(y*pw)*3+c]+fx*current[(y*pw+pw-1)*3+c]+(1-fy)*current[x*3+c]+fy*current[((ph-1)*pw+x)*3+c]);
  }
  next.set(current);
  for(let iteration=0;iteration<120;iteration++){
    for(let y=1;y<ph-1;y++)for(let x=1;x<pw-1;x++)for(let c=0;c<3;c++){const i=(y*pw+x)*3+c;next[i]=.25*(current[i-3]+current[i+3]+current[i-pw*3]+current[i+pw*3]);}
    [current,next]=[next,current];
  }
  const result=new Uint8ClampedArray(plate.length);
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=(y*r.w+x)*4,j=((y+1)*pw+x+1)*3;for(let c=0;c<3;c++)result[i+c]=plate[i+c]+current[j+c];result[i+3]=255;}
  return result;
}
