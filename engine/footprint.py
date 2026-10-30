# Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
"""Conservative light/dark overlay footprint estimation against a validated plate.

This protects observed pixels in a selection. It is not general logo detection.
"""
import cv2
import numpy as np


def refine_footprint(original,plate,selection,noise=1.5):
    ys,xs=np.where(selection>0)
    if not len(xs):return None
    y0,y1=int(ys.min()),int(ys.max()+1);x0,x1=int(xs.min()),int(xs.max()+1)
    observed=original[y0:y1,x0:x1].astype(np.float32)
    background=plate[y0:y1,x0:x1].astype(np.float32)
    inside=selection[y0:y1,x0:x1]>0
    area=int(inside.sum());noise=float(np.clip(noise,.6,3))
    ring=(cv2.dilate(selection,np.ones((17,17),np.uint8))>0)&(selection==0)
    if ring.sum()>=40:
        offset=np.median(original[ring].astype(np.float32)-plate[ring].astype(np.float32),axis=0)
        background=np.clip(background+offset,0,255)
    residual=observed-background
    candidates=[]
    for level,name in [(255.,'light'),(0.,'dark')]:
        direction=level-background
        denominator=np.sum(direction*direction,axis=2)
        opacity=np.clip(np.sum(residual*direction,axis=2)/np.maximum(denominator,1),0,1)
        model=background+opacity[:,:,None]*direction
        error=np.sqrt(np.mean((observed-model)**2,axis=2))
        strength=np.sqrt(np.mean(residual*residual,axis=2))
        reliable=denominator>100
        seed=inside&reliable&(opacity>.06)&(strength>max(4.5,noise*3))&(error<max(2.5,noise*1.7))
        grow=inside&reliable&(opacity>.025)&(strength>max(3,noise*1.8))&(error<max(3,noise*2))
        grow&=cv2.dilate(seed.astype(np.uint8),np.ones((11,11),np.uint8))>0
        grow=cv2.morphologyEx(grow.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
        count,labels,stats,_=cv2.connectedComponentsWithStats(grow)
        footprint=np.zeros_like(grow)
        supported=0
        for label in range(1,count):
            component=labels==label
            seeds=int(np.count_nonzero(seed&component))
            if seeds<max(4,area*.0015) or stats[label,cv2.CC_STAT_AREA]<max(12,area*.002):continue
            footprint[component]=1;supported+=seeds
        if supported<max(30,area*.025):continue
        # Include the antialiased rim and codec ringing, then soften only the
        # outer safety band. The detected mark's interior is replaced fully.
        core=footprint.copy()
        footprint=cv2.dilate(footprint,np.ones((7,7),np.uint8))
        footprint&=inside.astype(np.uint8)
        ratio=float(footprint.sum())/area
        if not .08<ratio<.86:continue
        # Do not trim a mark that reaches a selection edge: it may be cut off.
        if np.any(core[:2]) or np.any(core[-2:]) or np.any(core[:,:2]) or np.any(core[:,-2:]):continue
        if float(np.median(error[core>0]))>max(2,noise*1.5):continue
        alpha=cv2.GaussianBlur(footprint.astype(np.float32),(5,5),.85)
        alpha[core>0]=1
        alpha[~inside]=0
        candidates.append((supported,name,alpha,core))
    if not candidates:return None
    supported,name,local,core=max(candidates,key=lambda c:c[0])
    # Mixed light/dark evidence often indicates a bad plate or scene detail.
    if len(candidates)>1 and min(c[0] for c in candidates)>supported*.35:return None
    alpha=np.zeros(selection.shape,np.float32);alpha[y0:y1,x0:x1]=local
    active=(alpha>0)&(selection>0)
    coverage=float(active.sum())/area
    if coverage>=.9:return None
    # Pixels we keep must also agree with the proposed background. A good
    # fit on the logo alone cannot validate an unrelated reconstruction.
    retained=(selection>0)&(~active)
    disagreement=np.sqrt(np.mean((original[retained].astype(np.float32)-plate[retained].astype(np.float32))**2,axis=1))
    if np.median(disagreement)>max(3,noise*2) or np.percentile(disagreement,90)>max(8,noise*4):return None
    return alpha,{'overlay':name,'modifiedPixels':int(active.sum()),'preservedPixels':int(area-active.sum()),'seedPixels':supported}


def composite_footprint(original,plate,alpha):
    result=original.copy();active=alpha>0
    weight=alpha[active,None]
    result[active]=np.clip(original[active].astype(np.float32)*(1-weight)+plate[active].astype(np.float32)*weight,0,255).astype(np.uint8)
    return result
