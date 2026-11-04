// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Estimate a fixed translucent overlay from independently reconstructed frames.
// The inverse uses CURRENT source pixels, never a previous painted frame.
export class TransparencyModel{
  constructor(){this.reset();}
  reset(){this.rect=null;this.level=null;this.frames=0;this.weights=null;this.dots=null;this.squares=null;this.counts=null;}
  compatible(r,shape){return this.rect&&shape&&this.level===shape.level&&['x','y','w','h'].every(k=>r[k]===this.rect[k]);}
  learn(data,w,r,plate,shape){
    if(!shape){return;}
    if(!this.compatible(r,shape)){this.reset();this.rect={...r};this.level=shape.level;this.weights=new Float64Array(r.w*r.h);this.dots=new Float64Array(r.w*r.h);this.squares=new Float64Array(r.w*r.h);this.counts=new Uint8Array(r.w*r.h);}
    // Freeze the calibration rather than fitting every new scene to its own guess.
    if(this.frames>=12)return;
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4;if(shape.alpha[i]===0)continue;
      let dot=0,weight=0,square=0;
      for(let c=0;c<3;c++){const d=this.level-plate[i*4+c],v=data[j+c]-plate[i*4+c];dot+=d*v;weight+=d*d;square+=v*v;}
      if(weight<300)continue;
      const alpha=dot/weight,residual=Math.max(0,square-dot*dot/weight);
      if(alpha<.025||alpha>.78||residual>18)continue;
      this.weights[i]+=weight;this.dots[i]+=dot;this.squares[i]+=square;
      this.counts[i]++;
    }
    this.frames++;
  }
  recover(data,w,r,plate,shape){
    if(this.frames<12||!this.compatible(r,shape))return {plate,pixels:0};
    let core=0,calibrated=0;
    for(let i=0;i<shape.alpha.length;i++)if(shape.alpha[i]>=.99){core++;const a=this.dots[i]/this.weights[i];if(this.counts[i]>=8&&this.weights[i]>=3600&&a>=.04&&a<=.7)calibrated++;}
    // Antialiasing around an opaque logo is not evidence that its interior is
    // transparent. Require substantial translucent support across the footprint.
    if(calibrated<Math.max(30,core*.35))return {plate,pixels:0};
    let result=null,pixels=0;
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4,weight=this.weights[i];
      if(shape.alpha[i]<.99||this.counts[i]<8||weight<3600)continue;
      const opacity=this.dots[i]/weight;
      if(opacity<.04||opacity>.7)continue;
      // Calibration variance and current RGB consistency must both agree.
      const variance=Math.max(0,this.squares[i]/weight-opacity*opacity);
      if(Math.sqrt(variance)>.055)continue;
      let error=0;const recovered=[];
      for(let c=0;c<3;c++){const expected=(1-opacity)*plate[i*4+c]+opacity*this.level;error+=(data[j+c]-expected)**2;recovered.push((data[j+c]-opacity*this.level)/(1-opacity));}
      const currentError=Math.sqrt(error/3);
      // Prefer the validated plate when the difference is only codec noise.
      // Moderate differences can be real current lighting hidden by the overlay.
      const strength=Math.min(1,Math.max(0,currentError-.5),Math.max(0,(12-currentError)/2));
      if(strength===0||recovered.some(v=>v<0||v>255))continue;
      if(!result)result=plate.slice();
      for(let c=0;c<3;c++)result[i*4+c]=plate[i*4+c]*(1-strength)+recovered[c]*strength;
      pixels++;
    }
    return {plate:result??plate,pixels};
  }
}
