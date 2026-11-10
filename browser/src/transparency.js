// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Estimate a fixed translucent overlay from independently reconstructed frames.
// The inverse uses CURRENT source pixels, never a previous painted frame.
export class TransparencyModel{
  constructor(){this.reset();}
  reset(){this.rect=null;this.level=null;this.frames=0;this.weights=null;this.dots=null;this.squares=null;this.counts=null;this.minimumWeights=null;this.shape=null;}
  compatible(r,shape){return this.rect&&shape&&this.level===shape.level&&['x','y','w','h'].every(k=>r[k]===this.rect[k]);}
  learn(data,w,r,plate,shape){
    if(!shape){return;}
    if(!this.compatible(r,shape)){this.reset();this.rect={...r};this.level=shape.level;this.weights=new Float64Array(r.w*r.h);this.dots=new Float64Array(r.w*r.h);this.squares=new Float64Array(r.w*r.h);this.counts=new Uint8Array(r.w*r.h);this.minimumWeights=new Float64Array(r.w*r.h).fill(Infinity);}
    // Freeze the calibration rather than fitting every new scene to its own guess.
    if(this.frames>=12)return;
    this.shape=shape;
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4;if(shape.alpha[i]===0)continue;
      let dot=0,weight=0,square=0;
      for(let c=0;c<3;c++){const d=this.level-plate[i*4+c],v=data[j+c]-plate[i*4+c];dot+=d*v;weight+=d*d;square+=v*v;}
      if(weight<300)continue;
      const alpha=dot/weight,residual=Math.max(0,square-dot*dot/weight);
      if(alpha<.025||alpha>.78||residual>18)continue;
      this.weights[i]+=weight;this.dots[i]+=dot;this.squares[i]+=square;
      this.counts[i]++;
      this.minimumWeights[i]=Math.min(this.minimumWeights[i],weight);
    }
    this.frames++;
  }
  confirmFootprint(data,w,r,plate,measure){
    if(this.frames<12||!this.compatible(r,this.shape)){measure?.({reason:'calibration',frames:this.frames});return null;}
    const n=r.w*r.h,opacity=new Float32Array(n);let valid=0;
    for(let i=0;i<n;i++)if(this.counts[i]>=8&&this.weights[i]>=3600){
      const a=this.dots[i]/this.weights[i],variance=Math.max(0,this.squares[i]/this.weights[i]-a*a);
      if(a>=.025&&a<=.7&&Math.sqrt(variance)<=.055){opacity[i]=a;valid++;}
    }
    const modified=this.shape.modified??this.shape.alpha.reduce((count,a)=>count+(a>0),0);
    if(valid<Math.max(30,modified*.25)){measure?.({reason:'coverage',valid,modified});return null;}
    // Low-frequency lighting may defeat an absolute plate-error gate. Test the
    // CURRENT logo's spatial edge signature instead, without reusing old paint.
    let dot=0,expectedEnergy=0,observedEnergy=0;
    const expectedBase=new Float32Array(n*3),observedBase=new Float32Array(n*3);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)for(let c=0;c<3;c++){
      const i=y*r.w+x;expectedBase[i*3+c]=opacity[i]*(this.level-plate[i*4+c]);observedBase[i*3+c]=data[((r.y+y)*w+r.x+x)*4+c]-plate[i*4+c];
    }
    const lowPass=base=>{
      const result=new Float32Array(base.length);
      for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
        let count=0;const sum=[0,0,0];
        for(let yy=Math.max(0,y-2);yy<=Math.min(r.h-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(r.w-1,x+2);xx++){count++;for(let c=0;c<3;c++)sum[c]+=base[(yy*r.w+xx)*3+c];}
        for(let c=0;c<3;c++)result[(y*r.w+x)*3+c]=sum[c]/count;
      }
      return result;
    };
    const expectedImage=lowPass(expectedBase),observedImage=lowPass(observedBase);
    const radius=Math.max(3,Math.min(6,Math.floor(Math.min(r.w,r.h)/12)));
    for(let y=radius;y<r.h-radius;y++)for(let x=radius;x<r.w-radius;x++){
      const i=y*r.w+x;if(this.shape.alpha[i]===0)continue;
      const neighbors=[i-radius,i+radius,i-radius*r.w,i+radius*r.w];
      for(let c=0;c<3;c++){
        let expected=expectedImage[i*3+c];
        let observed=observedImage[i*3+c];
        for(const j of neighbors){
          expected-=.25*expectedImage[j*3+c];
          observed-=.25*observedImage[j*3+c];
        }
        dot+=expected*observed;expectedEnergy+=expected*expected;observedEnergy+=observed*observed;
      }
    }
    if(expectedEnergy<150||observedEnergy<150||dot<=0){measure?.({reason:'energy',expectedEnergy,observedEnergy,dot});return null;}
    const correlation=dot/Math.sqrt(expectedEnergy*observedEnergy),amplitude=dot/expectedEnergy;
    measure?.({reason:'signature',correlation,amplitude,valid});
    // Foreground lighting can add unrelated edges and lower normalized
    // correlation. Require a matching amplitude as well as positive structure.
    return correlation>=.55&&amplitude>=.65&&amplitude<=1.6?this.shape:null;
  }
  recover(data,w,r,plate,shape){
    if(this.frames<12||!this.compatible(r,shape))return {plate,pixels:0};
    let core=0,calibrated=0;
    for(let i=0;i<shape.alpha.length;i++)if(shape.alpha[i]>=.99){core++;const a=this.dots[i]/this.weights[i];if(this.counts[i]>=8&&this.weights[i]>=3600&&this.minimumWeights[i]>=3*32**2&&a>=.04&&a<=.7)calibrated++;}
    // Antialiasing around an opaque logo is not evidence that its interior is
    // transparent. Require substantial translucent support across the footprint.
    if(calibrated<Math.max(30,core*.35))return {plate,pixels:0};
    let result=null,pixels=0;
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x,j=((r.y+y)*w+r.x+x)*4,weight=this.weights[i];
      // Weak observations can locate the outline but cannot safely invert it.
      // Require 32 RGB levels RMS of separation in every fitted observation;
      // otherwise tiny plate errors can become a fixed opacity-shaped patch.
      if(shape.alpha[i]<.99||this.counts[i]<8||weight<3600||this.minimumWeights[i]<3*32**2)continue;
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
