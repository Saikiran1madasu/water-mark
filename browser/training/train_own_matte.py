"""Local original-model experiment; private user footage is never published."""
import argparse,json,time,hashlib,sys
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
from own_matte_model import OwnMatteRefiner

parser=argparse.ArgumentParser();parser.add_argument('--steps',type=int,default=800);parser.add_argument('--batch',type=int,default=8);parser.add_argument('--name',default='own-matte-v1');parser.add_argument('--coarse-jitter',action='store_true');args=parser.parse_args()
torch.manual_seed(20261105);np.random.seed(20261105);torch.set_num_threads(4)
device='mps' if torch.backends.mps.is_available() else 'cpu';root=Path('.runtime/own-model');data=np.load(root/'patches.npz');train=torch.from_numpy(data['train'].transpose(0,3,1,2).copy()).float().to(device)/255;validation=torch.from_numpy(data['validation'].transpose(0,3,1,2).copy()).float().to(device)/255
model=OwnMatteRefiner().to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.00001)
yy,xx=torch.meshgrid(torch.linspace(-1,1,128,device=device),torch.linspace(-1,1,128,device=device),indexing='ij');coordinates=torch.stack([xx,yy])[None]
def synthetic(images,batch):
 rgb=images[torch.randint(len(images),(batch,),device=device)].clone();rgb=torch.flip(rgb,[3]) if torch.rand(())<.5 else rgb
 rgb=(rgb*(.8+.4*torch.rand(batch,1,1,1,device=device))+(.04*torch.rand(batch,3,1,1,device=device)-.02)).clamp(0,1)
 cx=(torch.rand(batch,1,1,device=device)-.5)*.2;cy=(torch.rand(batch,1,1,device=device)-.5)*.2;rx=.2+.22*torch.rand(batch,1,1,device=device);ry=.2+.22*torch.rand(batch,1,1,device=device);power=.6+.3*torch.rand(batch,1,1,device=device)
 distance=(abs(xx[None]-cx)/rx)**power+(abs(yy[None]-cy)/ry)**power
 opacity=.18+.24*torch.rand(batch,1,1,device=device);white=(opacity*(1-distance).mul(8).clamp(0,1))[:,None];dark=(.025*torch.rand(batch,1,1,device=device)*torch.exp(-((distance-1)/.07)**2))[:,None]
 support=F.max_pool2d((white+dark>.002).float(),7,1,3)
 coarse=F.avg_pool2d(white,3,1,1)*(.88+.24*torch.rand(batch,1,1,1,device=device));coarse=(coarse+(.014*torch.rand(batch,1,1,1,device=device)-.007)*support).clamp(0,.65)
 if args.coarse_jitter:
  shift=(torch.rand(batch,2,device=device)-.5)*2/64;grid=coordinates.permute(0,2,3,1).expand(batch,-1,-1,-1)+shift[:,None,None,:]
  coarse=F.grid_sample(coarse,grid,mode='bilinear',padding_mode='zeros',align_corners=True)
  coarse=(F.avg_pool2d(coarse,5,1,2)+torch.randn_like(coarse)*.003*support).clamp(0,.65)*support
 observed=(rgb*(1-white-dark)+white+torch.randn_like(rgb)*(.5/255)).clamp(0,1).mul(255).round()/255
 inputs=torch.cat([observed,coarse,support,coordinates.expand(batch,-1,-1,-1)],1)
 return inputs,rgb,white,dark,support

def losses(inputs,clean,white,dark,support):
 out=model(inputs);a,b=out[:,:1],out[:,1:2];recovered=(inputs[:,:3]-a)/(1-a-b).clamp(min=.15);count=support.sum().clamp(min=1)
 weights=support
 if args.coarse_jitter:weights=support*(1+3*((white>.01)&(white<.16)).float())
 matte=((abs(a-white)+abs(b-dark))*weights).sum()/weights.sum().clamp(min=1)
 reconstruction=(abs(recovered-clean)*weights).sum()/(weights.sum().clamp(min=1)*3)
 return 15*matte+5*reconstruction,reconstruction,out

start=time.time();log=[];print(json.dumps({'device':device,'parameters':sum(p.numel() for p in model.parameters()),'steps':args.steps,'trainingPatches':len(train),'validationPatches':len(validation)}),flush=True)
for step in range(args.steps):
 inputs,clean,white,dark,support=synthetic(train,args.batch);loss,reconstruction,_=losses(inputs,clean,white,dark,support);optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2);optimizer.step()
 if (step+1)%50==0:
  item={'step':step+1,'loss':float(loss.detach().cpu()),'trainingReconstructionMAE':float(reconstruction.detach().cpu())*255,'seconds':round(time.time()-start,1)};log.append(item);print(json.dumps(item),flush=True)
model.eval();torch.manual_seed(44117);scores=[]
with torch.no_grad():
 for _ in range(12):
  inputs,clean,white,dark,support=synthetic(validation,8);_,error,out=losses(inputs,clean,white,dark,support);coarse=(inputs[:,:3]-inputs[:,3:4])/(1-inputs[:,3:4]).clamp(min=.15);den=support.sum()*3;initial=(abs(coarse-clean)*support).sum()/den;scores.append([float(initial.cpu())*255,float(error.cpu())*255])
model=model.cpu();checkpoint=root/(args.name+'.pt');torch.save(model.state_dict(),checkpoint)
example=torch.zeros(1,7,128,128);output=root/(args.name+'.onnx');torch.onnx.export(model,example,str(output),input_names=['input'],output_names=['matte'],dynamic_axes={'input':{2:'height',3:'width'},'matte':{2:'height',3:'width'}},opset_version=17,dynamo=False)
report={'name':args.name,'seed':20261105,'trainedFromScratch':True,'pretrainedWeightsUsed':False,'teacherModelUsed':False,'architectureFile':'training/own_matte_model.py','steps':args.steps,'device':device,'parameters':sum(p.numel() for p in model.parameters()),'seconds':time.time()-start,'validationCases':96,'initialMatteReconstructionMAE':np.mean(scores,axis=0)[0],'ownModelReconstructionMAE':np.mean(scores,axis=0)[1],'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'modelBytes':output.stat().st_size,'limitations':'One-video synthetic-overlay research experiment; not a broadly validated model or an opaque-video inpainting replacement.','trainingLog':log}
(root/(args.name+'-training-report.json')).write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='trainingLog'},indent=2),flush=True)
