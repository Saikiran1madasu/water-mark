"""Train original residual support with narrow holes and a deterministic diffuse fill."""
import json,time,sys,hashlib
from pathlib import Path
import numpy as np,torch
import torch.nn.functional as F
from own_contour_residual import OwnContourResidual
root=Path('.runtime/self-validation/contour-residual');root.mkdir(parents=True,exist_ok=True);torch.manual_seed(20261107);torch.set_num_threads(3);device='mps' if torch.backends.mps.is_available() else 'cpu';z=np.load('.runtime/own-model/patches.npz');train=torch.from_numpy(z['train'].transpose(0,3,1,2).copy());valid=torch.from_numpy(z['validation'].transpose(0,3,1,2).copy());net=OwnContourResidual().to(device);opt=torch.optim.AdamW(net.parameters(),lr=.0005,weight_decay=.00001);y,x=torch.meshgrid(torch.arange(128,device=device),torch.arange(128,device=device),indexing='ij');steps=int(sys.argv[1]) if len(sys.argv)>1 else 1200;kernel=torch.tensor([[0,.25,0],[.25,0,.25],[0,.25,0]],device=device).reshape(1,1,3,3).repeat(3,1,1,1)
def batch(data,ids,augment):
 clean=data[ids].to(device).float()/255;n=len(ids)
 if augment:
  if torch.rand(())<.5:clean=clean.flip(2)
  if torch.rand(())<.5:clean=clean.flip(3)
  clean=(clean*(.85+.3*torch.rand(n,1,1,1,device=device))+(torch.rand(n,3,1,1,device=device)-.5)*.04).clamp(0,1)
 cx=64+(torch.rand(n,1,1,device=device)-.5)*10;cy=64+(torch.rand(n,1,1,device=device)-.5)*10;rx=24+torch.rand(n,1,1,device=device)*8;ry=24+torch.rand(n,1,1,device=device)*8;p=.6+torch.rand(n,1,1,device=device)*.3;d=(abs(x-cx)/rx)**p+(abs(y-cy)/ry)**p
 outer=(d<(1.05+torch.rand(n,1,1,device=device)*.10));inner=d<(.65+torch.rand(n,1,1,device=device)*.2);mask=(outer&~inner).float().unsqueeze(1);coarse=clean*(1-mask)+.5*mask
 with torch.no_grad():
  for _ in range(80):coarse=coarse*(1-mask)+F.conv2d(coarse,kernel,padding=1,groups=3)*mask
 return torch.cat([coarse,mask],1),clean,mask

def evaluate():
 net.eval();errors=[0.,0.];count=0.;state=torch.random.get_rng_state();mpsstate=torch.mps.get_rng_state() if device=='mps' else None;torch.manual_seed(91142)
 with torch.no_grad():
  for s in range(0,len(valid),8):
   inp,clean,mask=batch(valid,torch.arange(s,min(len(valid),s+8)),False);out=net(inp);errors[0]+=float(((inp[:,:3]-clean).abs()*mask).sum().cpu());errors[1]+=float(((out-clean).abs()*mask).sum().cpu());count+=float(mask.sum().cpu())*3
 torch.random.set_rng_state(state)
 if mpsstate is not None:torch.mps.set_rng_state(mpsstate)
 net.train();return dict(baselineMAE=errors[0]/count*255,candidateMAE=errors[1]/count*255)
start=time.time();initial=evaluate();best=initial['candidateMAE'];beststep=0;history=[];torch.save(net.cpu().state_dict(),root/'best.pt');net.to(device);print(json.dumps(dict(parameters=sum(p.numel() for p in net.parameters()),device=device,initial=initial,steps=steps)),flush=True)
for step in range(steps):
 inp,clean,mask=batch(train,torch.randint(len(train),(8,)),True);out=net(inp);den=mask.sum()*3;loss=((out-clean).abs()*mask).sum()/den;grad=((out[:,:,:,1:]-out[:,:,:,:-1]-clean[:,:,:,1:]+clean[:,:,:,:-1]).abs()*mask[:,:,:,1:]).sum()/den+((out[:,:,1:,:]-out[:,:,:-1,:]-clean[:,:,1:,:]+clean[:,:,:-1,:]).abs()*mask[:,:,1:,:]).sum()/den;total=loss+.2*grad;opt.zero_grad();total.backward();torch.nn.utils.clip_grad_norm_(net.parameters(),2);opt.step()
 if (step+1)%100==0:
  item=dict(step=step+1,trainingMAE=float(loss.detach().cpu())*255,seconds=round(time.time()-start,1),validation=evaluate());history.append(item);print(json.dumps(item),flush=True)
  if item['validation']['candidateMAE']<best:best=item['validation']['candidateMAE'];beststep=step+1;torch.save(net.cpu().state_dict(),root/'best.pt');net.to(device)
net.load_state_dict(torch.load(root/'best.pt',map_location=device,weights_only=True));net.cpu().eval();path=root/'own-contour-residual-v1.onnx';torch.onnx.export(net,torch.zeros(1,4,128,128),str(path),input_names=['input'],output_names=['recovered'],opset_version=17,dynamo=False);report=dict(trainedFromScratch=True,externalPretrainedWeightsUsed=False,externalTeacherUsed=False,seed=20261107,parameters=sum(p.numel() for p in net.parameters()),steps=steps,selectedStep=beststep,initial=initial,history=history,seconds=time.time()-start,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),modelBytes=path.stat().st_size,limitations='One-video related-data research; frame interval 83..127 withheld; no invisible-removal guarantee. Not enabled in product.');(root/'training-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='history'}),flush=True)
