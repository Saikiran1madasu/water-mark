"""Original context-only residual contour support. No external weights or teacher.
Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
"""
import torch
from torch import nn
from own_context_fill import OwnContextFill
class OwnContourResidual(OwnContextFill):
 def __init__(self):
  super().__init__();nn.init.zeros_(self.head.weight);nn.init.zeros_(self.head.bias)
 def forward(self,x):
  # The parent's sigmoid output supplies a bounded signed residual, with exact
  # identity at initialization and exact preservation of every known pixel.
  value=super().forward(x);return (x[:,:3]+(32/255)*(2*value-1)*x[:,3:4]).clamp(0,1)
