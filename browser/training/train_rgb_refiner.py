"""Train a private original RGB residual prototype against known clean pixels."""
import argparse,copy,hashlib,json,time
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
from own_rgb_refiner import OwnRGBRefiner

parser=argparse.ArgumentParser();parser.add_argument('--steps',type=int,default=1800);parser.add_argument('--batch',type=int,default=8);parser.add_argument('--data-root',default='.runtime/rgb-refiner');parser.add_argument('--identity-training',action='store_true');parser.add_argument('--warm-start');parser.add_argument('--name');parser.add_argument('--lr',type=float,default=.0007);parser.add_argument('--smooth-loss',action='store_true');parser.add_argument('--identity-rate',type=float,default=.35);parser.add_argument('--paired-training',action='store_true');args=parser.parse_args()
torch.manual_seed(20261106);torch.set_num_threads(4);device='mps' if torch.backends.mps.is_available() else 'cpu';root=Path(args.data_root);model_name=args.name or ('own-rgb-v2' if args.identity_training else 'own-rgb-v1')
def load(split):
 data=np.fromfile(root/(split+'.pairs.bin'),np.uint8).reshape(-1,128,128,11)
 return torch.from_numpy(data.transpose(0,3,1,2).copy())
train=load('train');valid=load('validation');model=OwnRGBRefiner().to(device);
if args.warm_start:model.load_state_dict(torch.load(args.warm_start,map_location=device,weights_only=True))
optimizer=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=.00001)
def batch(data,ids,augment=False):
 values=data[ids].to(device).float()/255;x=values[:,:8];clean=values[:,8:]
 if augment:
  if args.identity_training:
   strength=torch.where(torch.rand(len(ids),1,1,1,device=device)<args.identity_rate,0.,.25+.75*torch.rand(len(ids),1,1,1,device=device))
   x=torch.cat([x[:,:3],clean+(x[:,3:6]-clean)*strength,x[:,6:]],1)
  if torch.rand(())<.5:x=x.flip(3);clean=clean.flip(3)
  if torch.rand(())<.5:x=x.flip(2);clean=clean.flip(2)
  gain=.90+.20*torch.rand(len(ids),1,1,1,device=device);bias=(torch.rand(len(ids),3,1,1,device=device)-.5)*.03
  x=torch.cat([(x[:,:3]*gain+bias).clamp(0,1),(x[:,3:6]*gain+bias).clamp(0,1),x[:,6:]],1);clean=(clean*gain+bias).clamp(0,1)
 return x,clean
def predict(x):
 factual=model(x)
 if not args.paired_training:return factual
 # Match the deployed paired inference, including its correction bounds.
 alpha=x[:,6:7];base=x[:,3:6]
 simulated=torch.cat([base*(1-alpha)+alpha,base,x[:,6:]],1)
 counter=model(simulated)
 return (base+(factual-counter).clamp(-16/255,16/255)).clamp(0,1)
def evaluate():
 sums=np.zeros(4);count=0
 model.eval()
 with torch.no_grad():
  for start in range(0,len(valid),8):
   x,clean=batch(valid,torch.arange(start,min(start+8,len(valid))));mask=x[:,7:8];out=predict(x);den=float(mask.sum().cpu())*3
   sums[0]+=float(((x[:,3:6]-clean).abs()*mask).sum().cpu());sums[1]+=float(((out-clean).abs()*mask).sum().cpu());sums[2]+=float(((out-x[:,3:6]).abs()*mask).sum().cpu());identity=predict(torch.cat([x[:,:3],clean,x[:,6:]],1));sums[3]+=float(((identity-clean).abs()*mask).sum().cpu());count+=den
 model.train();return dict(zip(['baselineMAE','refinedMAE','meanAbsoluteChange','identityMAE'],(sums/count*255).tolist()))
start=time.time();history=[];initial=evaluate();best=initial['refinedMAE']+.5*initial['identityMAE'];best_step=0;best_state=copy.deepcopy({k:v.cpu() for k,v in model.state_dict().items()})
print(json.dumps({'device':device,'parameters':sum(p.numel() for p in model.parameters()),'trainPairs':len(train),'validationPairs':len(valid),'steps':args.steps}),flush=True)
for step in range(args.steps):
 x,clean=batch(train,torch.randint(len(train),(args.batch,)),True);mask=x[:,7:8];out=predict(x);weights=mask;den=weights.sum().clamp(min=1)*3
 loss=((F.smooth_l1_loss(out,clean,reduction='none',beta=2/255) if args.smooth_loss else (out-clean).abs())*weights).sum()/den
 edgeMask=mask[:,:,:,1:]*mask[:,:,:,:-1];vertical=mask[:,:,1:,:]*mask[:,:,:-1,:]
 grad=((out[:,:,:,1:]-out[:,:,:,:-1]-clean[:,:,:,1:]+clean[:,:,:,:-1]).abs()*edgeMask).sum()/den+((out[:,:,1:,:]-out[:,:,:-1,:]-clean[:,:,1:,:]+clean[:,:,:-1,:]).abs()*vertical).sum()/den
 total=loss+.15*grad;optimizer.zero_grad();total.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2);optimizer.step()
 if (step+1)%100==0:
  item={'step':step+1,'trainingMAE':float((((out-clean).abs()*mask).sum()/den).detach().cpu())*255,'seconds':round(time.time()-start,1)}
  if (step+1)%300==0 or step+1==args.steps:
   item['validation']=evaluate()
   if item['validation']['refinedMAE']+.5*item['validation']['identityMAE']<best:best=item['validation']['refinedMAE']+.5*item['validation']['identityMAE'];best_step=step+1;best_state=copy.deepcopy({k:v.cpu() for k,v in model.state_dict().items()});torch.save(best_state,root/(model_name+'.pt'))
  history.append(item);print(json.dumps(item),flush=True)
model.load_state_dict(best_state);torch.save(best_state,root/(model_name+'.pt'));scores=evaluate();model=model.cpu().eval();path=root/(model_name+'.onnx')
torch.onnx.export(model,torch.zeros(1,8,128,128),str(path),input_names=['input'],output_names=['recovered'],opset_version=17,dynamo=False)
report={'name':model_name,'modelFile':path.name,'trainedFromScratch':not bool(args.warm_start),'ownCheckpointInitialization':args.warm_start,'externalPretrainedWeightsUsed':False,'externalTeacherUsed':False,'seed':20261106,'parameters':sum(p.numel() for p in model.parameters()),'steps':args.steps,'selectedStep':best_step,'pairedTraining':args.paired_training,'initialValidation':initial,'datasetManifest':json.loads((root/'codec-data.json').read_text()) if (root/'codec-data.json').exists() else None,'identityTraining':args.identity_training,'identityRate':args.identity_rate,'smoothLoss':args.smooth_loss,'trainingPairs':len(train),'validationPairs':len(valid),'seconds':time.time()-start,'validation':scores,'modelBytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'limitations':'One-video synthetic-overlay research; no generalization or invisible-removal guarantee. Clean temporal interval held out from training. Production inference has not been qualified by this training metric.','history':history}
(root/'training-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='history'},indent=2),flush=True)
