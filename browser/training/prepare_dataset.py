"""Prepare private, unmarked source crops; never copy source media to public/."""
import argparse,json
from pathlib import Path
import av
import numpy as np
parser=argparse.ArgumentParser();parser.add_argument('source');args=parser.parse_args()
rng=np.random.default_rng(20261105);train=[];valid=[];records=[];root=Path('.runtime/own-model');root.mkdir(parents=True,exist_ok=True)
with av.open(args.source) as container:
 for n,frame in enumerate(container.decode(video=0)):
  if n%6:continue
  rgb=frame.to_ndarray(format='rgb24')
  if rgb.shape[:2]!=(720,1280):raise ValueError('This documented experiment expects the supplied 1280x720 video; adapt the excluded watermark area explicitly for other sources.')
  group='validation' if 83<=n<=127 else 'training'
  for _ in range(12):
   x=int(rng.integers(0,896));y=int(rng.integers(0,592));patch=rgb[y:y+128,x:x+128].copy();(valid if group=='validation' else train).append(patch);records.append({'frame':n,'x':x,'y':y,'split':group})
np.savez_compressed(root/'patches.npz',train=np.stack(train),validation=np.stack(valid))
(root/'dataset.json').write_text(json.dumps({'seed':20261105,'note':'Only source x<1024; frame interval 83..127 held out. One-video research dataset.','trainingPatches':len(train),'validationPatches':len(valid),'patches':records},indent=2))
print(f'Prepared {len(train)} training and {len(valid)} validation patches; source footage remains private.')
