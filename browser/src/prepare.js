// Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
// Calibrate with a bounded look ahead, but do not use future frames as past donors.
export async function prepareRepair(engine,samples,readFrame,boxForTime,onProgress=()=>{}){
  let count=0;
  for await(const sample of samples){
    try{
      const {data,width,height}=readFrame(sample);
      engine.process(data,width,height,boxForTime(sample.timestamp));count++;
      onProgress(count);
    }finally{sample.close();}
    if(count===12)break;
  }
  engine.beginOutput(count);
  return count;
}
export async function prepareOverlay(calibrator,samples,readFrame,onProgress=()=>{}){
  const seen=new Set();let count=0;
  for await(const sample of samples){
    if(!sample)continue;
    try{
      if(seen.has(sample.timestamp))continue;seen.add(sample.timestamp);
      const {data,width,height}=readFrame(sample);calibrator.observe(data,width,height,sample.timestamp);onProgress(++count);
    }finally{sample.close();}
    if(count===24)break;
  }
  const accepted=calibrator.candidates.length,model=calibrator.finalize();return {model,sampled:count,accepted:model?.info?.acceptedFrames??accepted};
}
