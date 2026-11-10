"""Original experimental compositing-matte refiner, trained from scratch.

This is not MI-GAN, a port, a distilled student, or a pretrained checkpoint.
It targets translucent white overlays with a small dark fringe. It does not
claim generative reconstruction of opaque/fully missing content.
Copyright (c) 2026 Saikiran1madasu. All rights reserved.
"""
import torch
from torch import nn

class ContextBlock(nn.Module):
 def __init__(self,channels,dilation):
  super().__init__();self.spatial=nn.Conv2d(channels,channels,3,padding=dilation,dilation=dilation,groups=channels);self.mix=nn.Conv2d(channels,channels,1)
 def forward(self,x):return x+.25*torch.nn.functional.leaky_relu(self.mix(torch.nn.functional.leaky_relu(self.spatial(x),.1)),.1)

class OwnMatteRefiner(nn.Module):
 def __init__(self):
  super().__init__();self.entry=nn.Conv2d(10,24,3,padding=1);self.context=nn.Sequential(*[ContextBlock(24,d) for d in [1,2,4,8,16]]);self.head=nn.Conv2d(24,2,3,padding=1)
  nn.init.zeros_(self.head.weight);nn.init.zeros_(self.head.bias);self.head.bias.data[1]=-6
 def forward(self,inputs):
  # Inputs: RGB, initial white matte, support, normalized local coordinates.
  rgb=inputs[:,:3];support=inputs[:,4:5];known=1-support
  mean=(rgb*known).sum((2,3),keepdim=True)/known.sum((2,3),keepdim=True).clamp(min=1)
  features=torch.cat([inputs,mean.expand(-1,-1,inputs.shape[2],inputs.shape[3])],1)
  hidden=self.context(torch.nn.functional.leaky_relu(self.entry(features),.1));raw=self.head(hidden)
  white=(inputs[:,3:4]+.1*torch.tanh(raw[:,:1])).clamp(0,.75)*support
  dark=.08*torch.sigmoid(raw[:,1:2])*support
  return torch.cat([white,dark],1)
