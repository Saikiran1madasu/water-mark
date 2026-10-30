# Copyright (c) 2026 Saikiran1madasu. All rights reserved. See LICENSE.
"""Confidence-gated reconstruction for repeating and smoothly shaded backgrounds."""
import cv2
import numpy as np



def select_pattern_donor(candidates,hole):
    """Reject a lone plausible boundary match when independent tiles disagree.

    Keep one whole donor; never average pattern pixels. No majority means the
    original boundary winner remains in charge.
    """
    ordered=sorted(candidates,key=lambda candidate:candidate[0])
    best=ordered[0]
    independent=[]
    yy,xx=np.where(hole>0)
    width=max(1,int(xx.max()-xx.min()+1));height=max(1,int(yy.max()-yy.min()+1))
    def overlaps(a,b):
        dx,dy=np.abs(np.subtract(a[4],b[4]))
        return max(0,width-dx)*max(0,height-dy)/(width*height)>.25
    for candidate in ordered:
        if candidate[0]>best[0]+.75:continue
        if any(overlaps(candidate,other) for other in independent):continue
        independent.append(candidate)
    if len(independent)<3:return best,0
    values=np.stack([candidate[1][hole>0] for candidate in independent])
    if values.shape[1]>4096:
        values=values[:,np.linspace(0,values.shape[1]-1,4096).astype(int)]
    difference=np.abs(values[:,None]-values[None,:]).mean(axis=3)
    distance=np.maximum(difference.mean(axis=2),np.percentile(difference,90,axis=2)*.4)
    agreement=distance<2.5
    support=agreement.sum(axis=1)
    winner=int(np.argmax(support))
    # Strict majority prevents two equally plausible pattern phases from
    # inventing certainty. Three independent source positions are required.
    if support[winner]<max(3,len(independent)//2+1):return best,0
    group=np.flatnonzero(agreement[winner])
    if np.max(distance[np.ix_(group,group)])>=2.5:return best,0
    selected=min(group,key=lambda index:independent[index][0])
    return independent[selected],int(support[winner])


def periodic_fill(image,mask,preferred_shift=None):
    """Match an entire clean pattern tile, excluding source and target holes.

    Returns estimated spatial reconstruction, not observed temporal recovery.
    """
    ys,xs=np.where(mask>0)
    if not len(xs):return None
    h,w=mask.shape
    x0,x1=int(xs.min()),int(xs.max()+1);y0,y1=int(ys.min()),int(ys.max()+1)
    pad=max(20,min(64,max(x1-x0,y1-y0)))
    tx0=max(0,x0-pad);tx1=min(w,x1+pad);ty0=max(0,y0-pad);ty1=min(h,y1+pad)
    # A local search can include a complete repeating tile at native resolution.
    reach=max(128,min(320,max(x1-x0,y1-y0)*4))
    sx0=max(0,tx0-reach);sx1=min(w,tx1+reach)
    sy0=max(0,ty0-reach);sy1=min(h,ty1+reach)
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY).astype(np.float32)
    hole=(mask[ty0:ty1,tx0:tx1]>0).astype(np.float32)
    weights=1-hole
    if weights.sum()<100:return None
    # Remove gradual shading for pattern registration, rather than matching it.
    guide=cv2.inpaint(gray,mask,3,cv2.INPAINT_NS)
    high=guide-cv2.GaussianBlur(guide,(0,0),6)
    target=high[ty0:ty1,tx0:tx1]
    deviation=float(target[weights>0].std())
    if deviation<.35 or deviation>18:return None
    source=high[sy0:sy1,sx0:sx1]
    forbidden=cv2.dilate(mask,np.ones((3,3),np.uint8))
    clean=(forbidden[sy0:sy1,sx0:sx1]==0).astype(np.float32)
    corr=lambda a,b:cv2.matchTemplate(np.ascontiguousarray(a),np.ascontiguousarray(b),cv2.TM_CCORR)
    count=corr(clean,weights);den=np.maximum(count,1)
    st=corr(clean,target*weights);ss=corr(source*clean,weights)
    cross=corr(source*clean,target*weights)
    tt=corr(clean,target*target*weights);sq=corr(source*source*clean,weights)
    cost=np.maximum(0,(tt+sq-2*cross-(ss-st)**2/den)/den)
    # Every donor pixel used in the hole must be clean, not another part of it.
    clean_hole=corr(clean,hole)
    cost[(count<weights.sum()*.92)|(clean_hole<hole.sum()-.5)]=np.inf
    yy,xx=np.mgrid[ty0:ty1,tx0:tx1].astype(np.float32)
    px=(xx-(tx0+tx1)/2)/max(1,tx1-tx0)
    py=(yy-(ty0+ty1)/2)/max(1,ty1-ty0)
    design=np.stack([np.ones_like(px),px,py],axis=2)
    known=weights>0
    best=None
    proposals=[]
    preferred=None
    if preferred_shift is not None:
        ix=int(round(preferred_shift[0]))+tx0-sx0;iy=int(round(preferred_shift[1]))+ty0-sy0
        if 0<=iy<cost.shape[0] and 0<=ix<cost.shape[1] and np.isfinite(cost[iy,ix]):preferred=(iy,ix)
    for step in range(7 if preferred is not None else 6):
        iy,ix=preferred if step==0 and preferred is not None else np.unravel_index(np.argmin(cost),cost.shape)
        value=float(cost[iy,ix])
        if not np.isfinite(value):break
        dx=ix+sx0;dy=iy+sy0
        donor=image[dy:dy+target.shape[0],dx:dx+target.shape[1]].astype(np.float32)
        source_pattern=high[dy:dy+target.shape[0],dx:dx+target.shape[1]]
        a=target[known];b=source_pattern[known]
        confidence=float(np.corrcoef(a,b)[0,1]) if float(b.std())>.1 else 0
        difference=image[ty0:ty1,tx0:tx1].astype(np.float32)-donor
        coefficients=np.linalg.lstsq(design[known],difference[known],rcond=None)[0]
        surface=design@coefficients
        residual=difference-surface
        # Reject foreground edges, loose phase matches, and large relighting.
        error=float(np.sqrt(np.mean(residual[known]**2)))
        if confidence>.72 and error<3.2 and float(np.abs(surface).max())<35:
            continuity=0 if preferred_shift is None else .12*min(1,float(np.linalg.norm(np.array([dx-tx0,dy-ty0])-preferred_shift))/24)
            score=error+(1-confidence)*2+continuity
            proposal=(score,np.clip(donor+surface,0,255),confidence,error,(dx-tx0,dy-ty0))
            proposals.append(proposal)
            if best is None or score<best[0]:best=proposal
        radius=5
        if not (step==0 and preferred is not None):
            cost[max(0,iy-radius):iy+radius+1,max(0,ix-radius):ix+radius+1]=np.inf
    if best is None:return None
    best,agreement_count=select_pattern_donor(proposals,hole)
    score,donor,confidence,error,shift=best
    subpixel=False
    # Integer donor coordinates can make small crosses snap by a pixel from
    # frame to frame. Refine only a bounded, validated subpixel translation.
    dx,dy=int(shift[0]),int(shift[1])
    source_pattern=high[ty0+dy:ty1+dy,tx0+dx:tx1+dx]
    try:
        warp=np.eye(2,3,dtype=np.float32)
        correlation,warp=cv2.findTransformECC(target,source_pattern,warp,cv2.MOTION_TRANSLATION,(cv2.TERM_CRITERIA_COUNT|cv2.TERM_CRITERIA_EPS,35,1e-5),known.astype(np.uint8)*255,3)
        delta=warp[:,2]
        if np.max(np.abs(delta))<=1.5:
            mapx=xx+dx+float(delta[0]);mapy=yy+dy+float(delta[1])
            contaminated=cv2.remap(forbidden,mapx,mapy,cv2.INTER_NEAREST,borderValue=255)>0
            if not np.any(contaminated[hole>0]):
                raw=cv2.remap(image,mapx,mapy,cv2.INTER_LINEAR).astype(np.float32)
                difference=image[ty0:ty1,tx0:tx1].astype(np.float32)-raw
                coefficients=np.linalg.lstsq(design[known],difference[known],rcond=None)[0]
                surface=design@coefficients
                refined_error=float(np.sqrt(np.mean((difference-surface)[known]**2)))
                if refined_error+.025<error and np.abs(surface).max()<35:
                    donor=np.clip(raw+surface,0,255);error=refined_error
                    shift=(float(dx+delta[0]),float(dy+delta[1]));subpixel=True
    except cv2.error:
        pass
    # Match low-frequency boundary tone without averaging away pattern edges.
    residual=(image[ty0:ty1,tx0:tx1].astype(np.float32)-donor)*weights[:,:,None]
    normal=cv2.GaussianBlur(weights,(0,0),4)
    low=cv2.GaussianBlur(residual,(0,0),4)/np.maximum(normal[:,:,None],1e-4)
    correction=np.stack([cv2.inpaint(low[:,:,k],(hole>0).astype(np.uint8)*255,3,cv2.INPAINT_NS) for k in range(3)],axis=2)
    depth=cv2.distanceTransform((hole>0).astype(np.uint8),cv2.DIST_L2,3)
    band=np.clip(1-depth/10,0,1)[:,:,None]
    donor=np.clip(donor+np.clip(correction,-3,3)*band,0,255)
    output=image.copy()
    local=output[ty0:ty1,tx0:tx1];local[hole>0]=donor[hole>0].astype(np.uint8)
    return output,{'method':'pattern','confidence':confidence,'boundaryRMSE':error,'shift':tuple(float(v) for v in shift),'subpixel':subpixel,'agreementDonors':agreement_count}


def smooth_fill(image,mask):
    """Fit a smooth illumination surface when the clean surround has no detail."""
    ys,xs=np.where(mask>0)
    if not len(xs):return None
    h,w=mask.shape;x0=max(0,int(xs.min())-24);x1=min(w,int(xs.max())+25)
    y0=max(0,int(ys.min())-24);y1=min(h,int(ys.max())+25)
    roi=image[y0:y1,x0:x1].astype(np.float32);hole=mask[y0:y1,x0:x1]>0
    known=~hole
    if known.sum()<100:return None
    yy,xx=np.mgrid[:roi.shape[0],:roi.shape[1]].astype(np.float32)
    xx=(xx-roi.shape[1]/2)/roi.shape[1];yy=(yy-roi.shape[0]/2)/roi.shape[0]
    design=np.stack([np.ones_like(xx),xx,yy,xx*yy,xx*xx,yy*yy],axis=2)
    selected=known.copy()
    for _ in range(3):
        coeff=np.linalg.lstsq(design[selected],roi[selected],rcond=None)[0]
        surface=design@coeff
        error=np.abs(surface-roi).mean(axis=2)
        selected=known&(error<max(1.5,float(np.percentile(error[known],85))))
    residual=roi[known]-surface[known]
    rmse=float(np.sqrt(np.mean(residual**2)))
    high=roi-cv2.GaussianBlur(roi,(0,0),2)
    # Even faint crosses/lines are meaningful. Do not flatten a textured grid.
    safe=cv2.erode(known.astype(np.uint8),np.ones((11,11),np.uint8))>0
    if safe.sum()<100:safe=known
    detail=float(np.percentile(np.abs(high[safe]),99))
    luminance=cv2.cvtColor(high.astype(np.float32),cv2.COLOR_BGR2GRAY)
    edges=((np.abs(luminance)>3.5)&safe).astype(np.uint8)
    count,labels,stats,centroids=cv2.connectedComponentsWithStats(edges)
    compact=sum(3<=int(a)<=160 and 5<=int(bw)<=22 and 5<=int(bh)<=22 for _,_,bw,bh,a in stats[1:])
    if detail>12 or compact>=3:return None
    if rmse>1.15:
        tps=illumination_surface(roi,hole,5)
        if tps is None:return None
        surface,error=tps
        if error>5:return None
        rmse=error
    # A harmonic boundary correction enforces continuity with the real frame
    # without blending original watermark pixels back into the interior.
    difference=roi-surface
    hole8=hole.astype(np.uint8)*255
    correction=np.stack([cv2.inpaint(difference[:,:,k].astype(np.float32),hole8,3,cv2.INPAINT_NS) for k in range(3)],axis=2)
    kernel=np.array([[0,.25,0],[.25,0,.25],[0,.25,0]],np.float32)
    for _ in range(100):
        average=cv2.filter2D(correction,-1,kernel)
        correction[hole]=average[hole]
    surface=surface+correction
    result=image.copy();view=result[y0:y1,x0:x1]
    view[hole]=np.clip(surface[hole],0,255).astype(np.uint8)
    return result,{'method':'smooth','boundaryRMSE':rmse}


def illumination_surface(roi,hole,max_error=3):
    """Thin-plate interpolation of smooth lighting, with held-out validation."""
    h,w=hole.shape
    distance=cv2.distanceTransform((~hole).astype(np.uint8),cv2.DIST_L2,3)
    yy,xx=np.mgrid[:h,:w]
    ring=(~hole)&(distance<=12)&(distance>0)
    sample=ring&(xx%4==0)&(yy%4==0)
    y,x=np.where(sample)
    if len(x)<24:return None
    if len(x)>220:
        indices=np.linspace(0,len(x)-1,220).astype(int);y=y[indices];x=x[indices]
    points=np.stack([x/max(h,w),y/max(h,w)],axis=1).astype(np.float64)
    values=roi[y,x].astype(np.float64)
    def kernel(a,b):
        r2=np.sum((a[:,None,:]-b[None,:,:])**2,axis=2)
        return .5*r2*np.log(r2+1e-12)
    # Withhold regular samples: fitting the boundary must predict nearby clean
    # pixels, not merely interpolate a few arbitrary values exactly.
    test=np.arange(len(x))%7==0;train=~test
    def solve(p,v):
        k=kernel(p,p);k.flat[::len(p)+1]+=1e-4
        affine=np.column_stack([np.ones(len(p)),p])
        system=np.block([[k,affine],[affine.T,np.zeros((3,3))]])
        return np.linalg.solve(system,np.vstack([v,np.zeros((3,3))]))
    def predict(p,centers,coef):
        return np.column_stack([kernel(p,centers),np.ones(len(p)),p])@coef
    try:
        coefficients=solve(points[train],values[train])
        validation=predict(points[test],points[train],coefficients)
        error=float(np.sqrt(np.mean((validation-values[test])**2)))
        if error>max_error:return None
        coefficients=solve(points,values)
        allpoints=np.stack([xx.ravel()/max(h,w),yy.ravel()/max(h,w)],axis=1)
        surface=predict(allpoints,points,coefficients).reshape(h,w,3)
    except np.linalg.LinAlgError:return None
    if not np.isfinite(surface).all():return None
    observed=roi[~hole]
    if np.any(surface[hole]<observed.min(axis=0)-15) or np.any(surface[hole]>observed.max(axis=0)+15):return None
    return surface.astype(np.float32),error
