"""Known-reference temporal error; never treat low raw motion as correct output."""
from pathlib import Path
import av,numpy as np,json
root=Path(__file__).resolve().parents[1]
def crops(path,rect):
 x,y,w,h=rect
 with av.open(str(path)) as c:
  return np.stack([f.to_ndarray(format='rgb24')[y:y+h,x:x+w].astype(np.float32) for f in c.decode(video=0)])
rect=(538,265,44,50);clean=crops(root/'public/examples/pattern-lighting-clean.mp4',rect)
report={}
for name,file in [('before','pattern-lighting-previous.mp4'),('after','pattern-lighting-repaired.mp4')]:
 frames=crops(root/'public/examples'/file,rect);assert frames.shape==clean.shape
 error=frames-clean
 report[name]={'frames':len(frames),'selectedRegionMAE':float(np.abs(error).mean()),'temporalResidualMAE':float(np.abs(np.diff(error,axis=0)).mean()),'transitionTemporalResidualMAE':float(np.abs(np.diff(error[60:],axis=0)).mean())}
(root/'.runtime/stability-metrics.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
