"""Private one-video self-supervised context-fill experiment. No product promotion by loss alone."""
import json,time,copy,hashlib,sys
from pathlib import Path
import numpy as np,torch
import torch.nn.functional as F
from own_context_fill import OwnContextFill
root=Path('.runtime/self-validation/context-band');root.mkdir(parents=True,exist_ok=True);torch.manual_seed(20261107);torch.set_num_threads(3);device='mps' if torch.backends.mps.is_available() else 'cpu';z=np.load('.runtime/own-model/patches.npz');train=torch.from_numpy(z['train'].transpose(0,3,1,2).copy());valid=torch.from_numpy(z['validation'].transpose(0,3,1,2).copy());model=OwnContextFill().to(device);model.load_state_dict(torch.load('.runtime/self-validation/context/best.pt',map_location=device,weights_only=True));opt=torch.optim.AdamW(model.parameters(),lr=.0008,weight_decay=.00001);y,x=torch.meshgrid(torch.arange(128,device=device),torch.arange(128,device=device),indexing='ij');steps=int(sys.argv[1]) if len(sys.argv)>1 else 900

def batch(data,ids,augment):
 clean=data[ids].to(device).float()/255;n=len(ids)
 if augment:
  if torch.rand(())<.5:clean=clean.flip(2)
  if torch.rand(())<.5:clean=clean.flip(3)
  gain=.85+.3*torch.rand(n,1,1,1,device=device);bias=(torch.rand(n,3,1,1,device=device)-.5)*.04;clean=(clean*gain+bias).clamp(0,1)
 cx=64+(torch.rand(n,1,1,device=device)-.5)*12;cy=64+(torch.rand(n,1,1,device=device)-.5)*12;rx=22+torch.rand(n,1,1,device=device)*13;ry=22+torch.rand(n,1,1,device=device)*13;p=.62+torch.rand(n,1,1,device=device)*.28;d=(abs(x-cx)/rx)**p+(abs(y-cy)/ry)**p;mask=(d<1.15).float().unsqueeze(1)
 # Include alternate hole shapes so the network must learn context, not a fixed logo response.
 choose=torch.rand(n,1,1,1,device=device)<.25;ellipse=(((x-cx)/rx)**2+((y-cy)/ry)**2<.65).float().unsqueeze(1);mask=torch.where(choose,ellipse,mask);ring=(d>(.55+.25*torch.rand(n,1,1,device=device))).float().unsqueeze(1);mask=torch.where(torch.rand(n,1,1,1,device=device)<.8,mask*ring,mask)
 inp=torch.cat([clean*(1-mask)+.5*mask,mask],1);return inp,clean,mask

def evaluate():
 model.eval();errors=0.;count=0.;torch.manual_seed(18411)
 with torch.no_grad():
  for s in range(0,len(valid),8):
   inp,clean,mask=batch(valid,torch.arange(s,min(len(valid),s+8)),False);pred=model(inp);errors+=float(((pred-clean).abs()*mask).sum().cpu());count+=float(mask.sum().cpu())*3
 model.train();return errors/count*255
start=time.time();best=float('inf');history=[];print(json.dumps(dict(device=device,parameters=sum(p.numel() for p in model.parameters()),steps=steps,trainingPatches=len(train),validationPatches=len(valid))),flush=True)
for step in range(steps):
 inp,clean,mask=batch(train,torch.randint(len(train),(8,)),True);pred=model(inp);den=mask.sum()*3;loss=((pred-clean).abs()*mask).sum()/den;grad=((pred[:,:,:,1:]-pred[:,:,:,:-1]-clean[:,:,:,1:]+clean[:,:,:,:-1]).abs()*mask[:,:,:,1:]).sum()/den+((pred[:,:,1:,:]-pred[:,:,:-1,:]-clean[:,:,1:,:]+clean[:,:,:-1,:]).abs()*mask[:,:,1:,:]).sum()/den;low=(F.avg_pool2d(pred,8)-F.avg_pool2d(clean,8)).abs().mean();total=loss+.25*grad+.5*low;opt.zero_grad();total.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2);opt.step()
 if (step+1)%100==0:
  item=dict(step=step+1,trainingMAE=float(loss.detach().cpu())*255,seconds=round(time.time()-start,1),validationMAE=evaluate());history.append(item);print(json.dumps(item),flush=True)
  if item['validationMAE']<best:best=item['validationMAE'];torch.save(model.cpu().state_dict(),root/'best.pt');model.to(device)
model.load_state_dict(torch.load(root/'best.pt',map_location=device,weights_only=True));model.cpu().eval();path=root/'own-context-fill-v1.onnx';torch.onnx.export(model,torch.zeros(1,4,128,128),str(path),input_names=['input'],output_names=['recovered'],opset_version=17,dynamo=False);report=dict(trainedFromScratch=False,ownCheckpointInitialization='.runtime/self-validation/context/best.pt',externalPretrainedWeightsUsed=False,externalTeacherUsed=False,parameters=sum(p.numel() for p in model.parameters()),history=history,seconds=time.time()-start,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),modelBytes=path.stat().st_size,limitations='One-video related-data research. Source interval 83..127 withheld. Not evidence of invisible removal or generalization; not promoted.');(root/'training-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='history'}),flush=True)
