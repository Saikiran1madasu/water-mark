"""Original small RGB residual restorer; no pretrained model or external teacher.
Copyright (c) 2026 Saikiran1madasu. All rights reserved.
"""
import torch
from torch import nn
import torch.nn.functional as F

class Block(nn.Module):
 def __init__(self,c,d=1):
  super().__init__();self.depth=nn.Conv2d(c,c,3,padding=d,dilation=d,groups=c);self.mix=nn.Conv2d(c,c,1)
 def forward(self,x):return x+.25*F.leaky_relu(self.mix(F.leaky_relu(self.depth(x),.1)),.1)

class OwnRGBRefiner(nn.Module):
 def __init__(self):
  super().__init__();self.entry=nn.Conv2d(8,24,3,padding=1);self.a=Block(24);self.down1=nn.Conv2d(24,32,3,stride=2,padding=1);self.b=Block(32,2);self.down2=nn.Conv2d(32,48,3,stride=2,padding=1);self.c=nn.Sequential(Block(48),Block(48,2));self.up1=nn.Conv2d(80,32,3,padding=1);self.d=Block(32);self.up2=nn.Conv2d(56,24,3,padding=1);self.e=Block(24);self.head=nn.Conv2d(24,3,3,padding=1)
  nn.init.zeros_(self.head.weight);nn.init.zeros_(self.head.bias)
 def forward(self,x):
  a=self.a(F.leaky_relu(self.entry(x),.1));b=self.b(F.leaky_relu(self.down1(a),.1));c=self.c(F.leaky_relu(self.down2(b),.1));d=self.d(F.leaky_relu(self.up1(torch.cat([F.interpolate(c,size=b.shape[2:],mode='nearest'),b],1)),.1));e=self.e(F.leaky_relu(self.up2(torch.cat([F.interpolate(d,size=a.shape[2:],mode='nearest'),a],1)),.1))
  return (x[:,3:6]+(16/255)*torch.tanh(self.head(e))*x[:,7:8]).clamp(0,1)
