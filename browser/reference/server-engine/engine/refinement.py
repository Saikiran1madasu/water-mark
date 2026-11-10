# Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
"""Local motion refinement and deterministic exemplar texture synthesis.

Custom pipeline using OpenCV numerical primitives; no external model weights.
"""
import cv2
import numpy as np


def motion_models(target, source, mask):
    h,w=target.pixels.shape[:2];gh,gw=target.gray.shape
    excluded=cv2.resize(mask,(gw,gh),interpolation=cv2.INTER_NEAREST)
    excluded=cv2.dilate(excluded,np.ones((7,7),np.uint8))
    points=cv2.goodFeaturesToTrack(target.gray,900,.005,4,mask=255-excluded,blockSize=5)
    if points is None or len(points)<8:return []
    nxt,ok,_=cv2.calcOpticalFlowPyrLK(target.gray,source.gray,points,None,winSize=(25,25),maxLevel=4)
    if nxt is None:return []
    back,bok,_=cv2.calcOpticalFlowPyrLK(source.gray,target.gray,nxt,None,winSize=(25,25),maxLevel=4)
    if back is None:return []
    p=points.reshape(-1,2);q=nxt.reshape(-1,2)
    valid=(ok.ravel()>0)&(bok.ravel()>0)&(np.linalg.norm(back.reshape(-1,2)-p,axis=1)<1.2)
    valid&=(q[:,0]>=0)&(q[:,0]<gw)&(q[:,1]>=0)&(q[:,1]<gh)
    sm=source.mask if source.mask is not None else mask
    sm=cv2.resize(sm,(gw,gh),interpolation=cv2.INTER_NEAREST)
    sm=cv2.dilate(sm,np.ones((7,7),np.uint8))
    indices=np.clip(np.rint(q).astype(int),[0,0],[gw-1,gh-1])
    valid&=sm[indices[:,1],indices[:,0]]==0
    p=p[valid];q=q[valid]
    if len(p)<8:return []
    # Fit both the scene motion and motion closest to the selected area.
    # The latter can follow a foreground layer independently of the background.
    distance=cv2.distanceTransform(255-excluded,cv2.DIST_L2,3)
    pi=np.clip(np.rint(p).astype(int),[0,0],[gw-1,gh-1])
    order=np.argsort(distance[pi[:,1],pi[:,0]])
    close=order[:min(100,len(order))]
    models=[]
    for pp,qq,full in [(p,q,False),(p[close],q[close],False),(p[close],q[close],True)]:
        estimator=cv2.estimateAffine2D if full else cv2.estimateAffinePartial2D
        matrix,inliers=estimator(pp,qq,method=cv2.RANSAC,ransacReprojThreshold=1.3,maxIters=2000)
        if matrix is None or inliers.sum()<6 or inliers.mean()<.45:continue
        singular=np.linalg.svd(matrix[:,:2],compute_uv=False)
        if singular.min()<.75 or singular.max()>1.3:continue
        matrix=matrix.astype(np.float32)
        sx,sy=w/gw,h/gh
        matrix[0,1]*=sx/sy;matrix[1,0]*=sy/sx
        matrix[0,2]*=sx;matrix[1,2]*=sy
        if not any(np.allclose(matrix,m,atol=.15) for m in models):models.append(matrix)
    return models


def sample(source,matrix,rect,source_mask):
    x0,y0,cw,ch=rect
    local=matrix.copy();local[:,2]+=local[:,:2]@np.array([x0,y0],np.float32)
    pixels=cv2.warpAffine(source.pixels,local,(cw,ch),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP)
    clean=255-cv2.dilate(source_mask,np.ones((5,5),np.uint8))
    valid=cv2.warpAffine(clean,local,(cw,ch),flags=cv2.INTER_NEAREST|cv2.WARP_INVERSE_MAP)>0
    return pixels,valid


def boundary_score(target,warped,valid,ring):
    check=ring&valid
    if check.sum()<20:return None
    delta=np.median(target[check].astype(np.float32)-warped[check],axis=0)
    if np.max(np.abs(delta))>35:return None
    corrected=np.clip(warped.astype(np.float32)+delta,0,255)
    error=np.abs(corrected-target.astype(np.float32)).mean(axis=2)
    # A high-percentile penalty stops a good background match from hiding an
    # independently moving foreground edge along part of the repair boundary.
    score=float(np.median(error[check])*.55+np.percentile(error[check],80)*.45)
    return corrected,error,score


def dense_refine(target,source,matrix,mask,rect):
    """Refine residual motion; extend reliable surrounding flow into the hole."""
    h,w=mask.shape;scale=min(1.,480/max(h,w));sw,sh=round(w*scale),round(h*scale)
    a=cv2.resize(target.pixels,(sw,sh));b=cv2.resize(source.pixels,(sw,sh))
    transform=matrix.copy();transform[:,2]*=scale
    aligned=cv2.warpAffine(b,transform,(sw,sh),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP)
    tm=cv2.resize(mask,(sw,sh),interpolation=cv2.INTER_NEAREST)
    source_mask=source.mask if source.mask is not None else mask
    sm=cv2.resize(source_mask,(sw,sh),interpolation=cv2.INTER_NEAREST)
    sm=cv2.warpAffine(sm,transform,(sw,sh),flags=cv2.INTER_NEAREST|cv2.WARP_INVERSE_MAP,borderValue=255)
    unknown=cv2.dilate(cv2.bitwise_or(tm,sm),np.ones((5,5),np.uint8))
    ag=cv2.cvtColor(a,cv2.COLOR_BGR2GRAY);bg=cv2.cvtColor(aligned,cv2.COLOR_BGR2GRAY)
    # Remove the screen-space logo from the motion estimator's inputs.
    ag=cv2.inpaint(ag,unknown,3,cv2.INPAINT_TELEA);bg=cv2.inpaint(bg,unknown,3,cv2.INPAINT_TELEA)
    dis=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    forward=dis.calc(ag,bg,None);reverse=dis.calc(bg,ag,None)
    yy,xx=np.mgrid[:sh,:sw].astype(np.float32)
    back=cv2.remap(reverse,xx+forward[:,:,0],yy+forward[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=1000)
    consistent=np.linalg.norm(forward+back,axis=2)<1.3
    consistent&=np.linalg.norm(forward,axis=2)<24
    bad=((unknown>0)|~consistent).astype(np.uint8)*255
    if np.count_nonzero(bad==0)<64:return None
    extended=np.stack([cv2.inpaint(forward[:,:,k],bad,4,cv2.INPAINT_NS) for k in range(2)],axis=2)
    x0,y0,cw,ch=rect
    yy,xx=np.mgrid[y0:y0+ch,x0:x0+cw].astype(np.float32)
    rx=cv2.remap(extended[:,:,0],xx*scale,yy*scale,cv2.INTER_LINEAR)/scale
    ry=cv2.remap(extended[:,:,1],xx*scale,yy*scale,cv2.INTER_LINEAR)/scale
    qx=xx+rx;qy=yy+ry
    mx=matrix[0,0]*qx+matrix[0,1]*qy+matrix[0,2]
    my=matrix[1,0]*qx+matrix[1,1]*qy+matrix[1,2]
    pixels=cv2.remap(source.pixels,mx,my,cv2.INTER_LINEAR)
    clean=255-cv2.dilate(source_mask,np.ones((5,5),np.uint8))
    valid=cv2.remap(clean,mx,my,cv2.INTER_NEAREST)>0
    return pixels,valid


def exemplar_fill(image,unknown,forbidden,max_steps=160):
    """Synthesize unseen texture from clean source patches; never copy the logo."""
    if not np.any(unknown):return image.copy()
    result=cv2.inpaint(image,unknown,3,cv2.INPAINT_TELEA)
    # Large missing regions remain explicitly reported fallback. Bound CPU work.
    if np.count_nonzero(unknown)>18000:return result
    h,w=unknown.shape;r=4;size=2*r+1
    if min(h,w)<size*2:return result
    original=image.astype(np.float32)
    allowed=(cv2.boxFilter((forbidden>0).astype(np.float32),-1,(size,size),normalize=False,borderType=cv2.BORDER_CONSTANT)<.5)
    allowed[:r]=False;allowed[-r:]=False;allowed[:,:r]=False;allowed[:,-r:]=False
    # matchTemplate scores use a patch's top-left; candidate validity uses center.
    source_ok=allowed[r:h-r,r:w-r]
    if not np.any(source_ok):return result
    holes=unknown>0;canvas=image.copy()
    for _ in range(max_steps):
        if not holes.any():break
        known=(~holes).astype(np.float32)
        frontier=holes&(cv2.dilate(known,np.ones((3,3),np.uint8))>0)
        frontier[:r]=False;frontier[-r:]=False;frontier[:,:r]=False;frontier[:,-r:]=False
        if not frontier.any():break
        fraction=cv2.boxFilter(known,-1,(size,size),normalize=True)
        priority=np.where(frontier,fraction,-1)
        y,x=np.unravel_index(np.argmax(priority),priority.shape)
        if fraction[y,x]<.15:break
        patch=canvas[y-r:y+r+1,x-r:x+r+1].astype(np.float32)
        confidence=known[y-r:y+r+1,x-r:x+r+1]
        weights=np.repeat(confidence[:,:,None],3,axis=2)
        costs=cv2.matchTemplate(original,patch,cv2.TM_SQDIFF,mask=weights)
        costs[~source_ok]=np.inf
        sy,sx=np.unravel_index(np.argmin(costs),costs.shape)
        fill=holes[y-r:y+r+1,x-r:x+r+1]
        donor=image[sy:sy+size,sx:sx+size]
        destination=canvas[y-r:y+r+1,x-r:x+r+1]
        destination[fill]=donor[fill]
        holes[y-r:y+r+1,x-r:x+r+1][fill]=False
    synthesized=(unknown>0)&~holes
    # A narrow transition inside the mask softens copied patch boundaries.
    depth=cv2.distanceTransform(unknown,cv2.DIST_L2,3)
    alpha=np.clip(depth/2,0,1)[:,:,None]
    mixed=np.clip(canvas.astype(float)*alpha+result.astype(float)*(1-alpha),0,255).astype(np.uint8)
    result[synthesized]=mixed[synthesized]
    return result


def select_references(neighbors,target,limit=12):
    """Mix close and distant views on both sides instead of taking only farthest."""
    same=[n for n in neighbors if n.scene==target.scene]
    groups=[sorted([n for n in same if n.pts<target.pts],key=lambda n:abs(n.pts-target.pts)),sorted([n for n in same if n.pts>target.pts],key=lambda n:abs(n.pts-target.pts))]
    selected=[]
    for group in groups:
        if not group:continue
        positions=np.unique(np.rint(np.linspace(0,len(group)-1,max(1,limit//2))).astype(int))
        selected.extend(group[i] for i in positions)
    return selected[:limit]


def masked_translation(target,source,mask):
    """Match a clean local surround, excluding both frames' watermark pixels.

    Feature tracking can select the static camera layer when the content under
    the logo moves. Masked correlation provides an independent local proposal.
    """
    gh,gw=target.gray.shape;h,w=mask.shape
    tm=cv2.resize(mask,(gw,gh),interpolation=cv2.INTER_NEAREST)
    ys,xs=np.where(tm>0)
    if not len(xs):return None
    pad=max(16,min(48,max(int(np.ptp(xs)),int(np.ptp(ys)))))
    x0=max(0,int(xs.min())-pad);x1=min(gw,int(xs.max())+1+pad)
    y0=max(0,int(ys.min())-pad);y1=min(gh,int(ys.max())+1+pad)
    template=target.gray[y0:y1,x0:x1].astype(np.float32)
    weights=(tm[y0:y1,x0:x1]==0).astype(np.float32)
    if weights.sum()<64 or float(template[weights>0].std())<5:return None
    reach=48
    sx0=max(0,x0-reach);sx1=min(gw,x1+reach)
    sy0=max(0,y0-reach);sy1=min(gh,y1+reach)
    search=source.gray[sy0:sy1,sx0:sx1].astype(np.float32)
    source_mask=source.mask if source.mask is not None else mask
    sm=cv2.resize(source_mask,(gw,gh),interpolation=cv2.INTER_NEAREST)
    sm=cv2.dilate(sm,np.ones((3,3),np.uint8))
    valid=(sm[sy0:sy1,sx0:sx1]==0).astype(np.float32)
    correlate=lambda a,b:cv2.matchTemplate(np.ascontiguousarray(a),np.ascontiguousarray(b),cv2.TM_CCORR)
    count=correlate(valid,weights);den=np.maximum(count,1)
    st=correlate(valid,template*weights)
    ss=correlate(search*valid,weights)
    cross=correlate(search*valid,template*weights)
    t2=correlate(valid,template*template*weights)
    s2=correlate(search*search*valid,weights)
    cost=np.maximum(0,(s2+t2-2*cross-(ss-st)**2/den)/den)
    cost[count<weights.sum()*.65]=np.inf
    py,px=np.unravel_index(np.argmin(cost),cost.shape)
    if not np.isfinite(cost[py,px]) or cost[py,px]>18**2:return None
    dx=float(px+sx0-x0);dy=float(py+sy0-y0)
    for axis in (0,1):
        if axis==0 and 0<px<cost.shape[1]-1:a,b,c=cost[py,px-1:px+2]
        elif axis==1 and 0<py<cost.shape[0]-1:a,b,c=cost[py-1:py+2,px]
        else:continue
        divisor=float(a-2*b+c)
        offset=float(np.clip(.5*(a-c)/divisor,-.5,.5)) if np.isfinite(divisor) and divisor>1 else 0
        if axis==0:dx+=offset
        else:dy+=offset
    return np.array([[1,0,dx*w/gw],[0,1,dy*h/gh]],np.float32)


def finish_boundary(original,patch,mask,feather=0):
    """Blend only within the explicitly expanded safety margin, never the core."""
    if feather<=0:return patch
    distance=cv2.distanceTransform(mask,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
    alpha=np.clip(distance/max(1,feather),0,1)[:,:,None]
    mixed=original.astype(np.float32)*(1-alpha)+patch.astype(np.float32)*alpha
    return np.clip(mixed,0,255).astype(np.uint8)
