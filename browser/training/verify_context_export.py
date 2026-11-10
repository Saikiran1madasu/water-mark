"""Verify original context model preservation contract and create a WASM parity fixture."""
import json,hashlib,sys
from pathlib import Path
import numpy as np,torch,onnx
from own_context_fill import OwnContextFill
root=Path(sys.argv[1] if len(sys.argv)>1 else '.runtime/self-validation/context-band');torch.set_num_threads(2);torch.manual_seed(12411);model=OwnContextFill().eval();model.load_state_dict(torch.load(root/'best.pt',map_location='cpu',weights_only=True));rgb=torch.rand(1,3,128,128);mask=torch.zeros(1,1,128,128);mask[:,:,42:91,48:81]=1;inp=torch.cat([rgb*(1-mask)+.5*mask,mask],1)
with torch.no_grad():
 result=model(inp);identity=model(torch.cat([rgb,torch.zeros_like(mask)],1));assert torch.equal(identity,rgb);assert torch.equal(result*(1-mask),inp[:,:3]*(1-mask));assert torch.isfinite(result).all();assert result.min()>=0 and result.max()<=1
onnx.checker.check_model(onnx.load(root/'own-context-fill-v1.onnx'));inp.numpy().astype('float32').tofile(root/'parity-input.f32');result.numpy().astype('float32').tofile(root/'parity-expected.f32');(root/'contract-verification.json').write_text(json.dumps(dict(identityExact=True,outsideMaskExact=True,finiteAndInRange=True,onnxGraphValid=True,sha256=hashlib.sha256((root/'own-context-fill-v1.onnx').read_bytes()).hexdigest()),indent=2));print('Context model identity, preservation, finite range and ONNX graph checks passed.')
