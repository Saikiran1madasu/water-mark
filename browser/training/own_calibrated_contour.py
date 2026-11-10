"""Original contour residual with an explicit constant-field null response.
Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
"""
import torch
from own_contour_residual import OwnContourResidual
class OwnCalibratedContour(OwnContourResidual):
 def forward(self,x):
  rgb=x[:,:3];mask=x[:,3:4];mean=rgb.mean(dim=(2,3),keepdim=True);flat=mean.expand_as(rgb);constant=torch.cat([flat,mask],1)
  factual=super().forward(x)-rgb;bias=super().forward(constant)-flat
  correction=(factual-bias).clamp(-32/255,32/255)
  return (rgb+correction*mask).clamp(0,1)
