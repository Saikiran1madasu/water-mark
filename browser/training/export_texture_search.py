"""Export our weight-free nearest-texture arithmetic for browser WASM.
Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
"""
import json,hashlib
from pathlib import Path
import torch
class TextureSearch(torch.nn.Module):
 def forward(self,target,source):
  distance=((target*target).sum(1,keepdim=True)+(source*source).sum(1).unsqueeze(0)-2*target@source.T)/30
  distance=distance+torch.arange(source.shape[0],dtype=source.dtype).unsqueeze(0)*1e-7
  return torch.topk(distance,4,dim=1,largest=False,sorted=True)
root=Path('.runtime/nonlocal-gradient');path=root/'texture-search.onnx';torch.onnx.export(TextureSearch(),(torch.zeros(128,30),torch.zeros(256,30)),str(path),input_names=['target','source'],output_names=['cost','indices'],dynamic_axes={'target':{0:'targets'},'source':{0:'sources'},'cost':{0:'targets'},'indices':{0:'targets'}},opset_version=17,dynamo=False);j={'modelFile':path.name,'parameters':0,'trainedWeights':False,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()};(root/'search-graph.json').write_text(json.dumps(j,indent=2));print(j)
