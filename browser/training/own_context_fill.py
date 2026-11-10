"""Original experimental context-only inpainting; no pretrained weights/teacher.
Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
"""
import torch
from torch import nn
import torch.nn.functional as F
class Residual(nn.Module):
 def __init__(self,c):
  super().__init__();self.a=nn.Conv2d(c,c,3,padding=1);self.b=nn.Conv2d(c,c,3,padding=1)
 def forward(self,x):return x+.2*self.b(F.leaky_relu(self.a(x),.1))
class OwnContextFill(nn.Module):
 def __init__(self):
  super().__init__();self.e=nn.Conv2d(4,24,3,padding=1);self.r1=Residual(24);self.d1=nn.Conv2d(24,40,3,2,1);self.r2=Residual(40);self.d2=nn.Conv2d(40,64,3,2,1);self.r3=Residual(64);self.d3=nn.Conv2d(64,80,3,2,1);self.mid=nn.Sequential(Residual(80),Residual(80));self.u2=nn.Conv2d(144,64,3,padding=1);self.q2=Residual(64);self.u1=nn.Conv2d(104,40,3,padding=1);self.q1=Residual(40);self.u0=nn.Conv2d(64,24,3,padding=1);self.q0=Residual(24);self.head=nn.Conv2d(24,3,3,padding=1)
 def forward(self,x):
  a=self.r1(F.leaky_relu(self.e(x),.1));b=self.r2(F.leaky_relu(self.d1(a),.1));c=self.r3(F.leaky_relu(self.d2(b),.1));d=self.mid(F.leaky_relu(self.d3(c),.1));c=self.q2(F.leaky_relu(self.u2(torch.cat([F.interpolate(d,size=c.shape[2:],mode='nearest'),c],1)),.1));b=self.q1(F.leaky_relu(self.u1(torch.cat([F.interpolate(c,size=b.shape[2:],mode='nearest'),b],1)),.1));a=self.q0(F.leaky_relu(self.u0(torch.cat([F.interpolate(b,size=a.shape[2:],mode='nearest'),a],1)),.1));prediction=torch.sigmoid(self.head(a));return x[:,:3]*(1-x[:,3:4])+prediction*x[:,3:4]
