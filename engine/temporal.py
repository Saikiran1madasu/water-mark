"""MSK temporal repair v1. Original orchestration and reconstruction algorithm.

No model weights, repository code, FFmpeg delogo, or remote inference.
Uses OpenCV motion/warping/inpainting primitives and PyAV media codecs.
"""
from __future__ import annotations
import argparse
from collections import deque
from dataclasses import dataclass
from fractions import Fraction
import json
import sys
import warnings
from pathlib import Path
import av
import cv2
import numpy as np

cv2.setNumThreads(2)

@dataclass
class Frame:
    pixels: np.ndarray
    gray: np.ndarray
    hist: np.ndarray
    pts: int
    scene: int
    mask: np.ndarray | None = None


def emit(**event):
    print(json.dumps(event), flush=True)


def prepare(pixels, pts=0, scene=0, mask=None):
    h, w = pixels.shape[:2]
    scale = min(1., 720 / max(w, h))
    gray = cv2.cvtColor(cv2.resize(pixels, (max(1, round(w*scale)), max(1, round(h*scale)))), cv2.COLOR_BGR2GRAY)
    thumb = cv2.resize(pixels, (96, 54))
    hsv = cv2.cvtColor(thumb, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [24, 16], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    return Frame(pixels, gray, hist, pts, scene, mask)


def box_at(seconds, default, keyframes=None):
    if not keyframes:
        return default
    if seconds<=keyframes[0]['time']:
        return keyframes[0]['box']
    for left,right in zip(keyframes,keyframes[1:]):
        if seconds<=right['time']:
            amount=(seconds-left['time'])/max(1e-9,right['time']-left['time'])
            return {k:left['box'][k]*(1-amount)+right['box'][k]*amount for k in ('x','y','w','h')}
    return keyframes[-1]['box']


def is_scene_cut(previous, current):
    return cv2.compareHist(previous.hist, current.hist, cv2.HISTCMP_BHATTACHARYYA) > .55


def make_mask(shape, box, margin=3):
    h, w = shape[:2]
    x, y = int(round(box['x']*w)), int(round(box['y']*h))
    right, bottom = int(round((box['x']+box['w'])*w)), int(round((box['y']+box['h'])*h))
    if right-x < 4 or bottom-y < 4:
        raise ValueError('Select a watermark at least 4 × 4 pixels.')
    if x<0 or y<0 or right>w or bottom>h:
        raise ValueError('Selection must stay inside the frame.')
    mask = np.zeros((h, w), np.uint8)
    mask[max(0,y-margin):min(h,bottom+margin), max(0,x-margin):min(w,right+margin)] = 255
    if np.count_nonzero(mask) > h*w*.5:
        raise ValueError('The selection covers over half the video. Use a smaller area for a reliable repair.')
    return mask


def align(target, source, mask, features=None):
    """Estimate target→source mapping from clean, bidirectionally checked tracks."""
    small_mask = cv2.resize(mask, (target.gray.shape[1], target.gray.shape[0]), interpolation=cv2.INTER_NEAREST)
    small_mask = cv2.dilate(small_mask, np.ones((9,9),np.uint8))
    points = features if features is not None else cv2.goodFeaturesToTrack(target.gray, 360, .008, 7, mask=255-small_mask, blockSize=5)
    if points is None or len(points)<12:
        return None
    following, valid, _ = cv2.calcOpticalFlowPyrLK(target.gray, source.gray, points, None, winSize=(25,25), maxLevel=3)
    if following is None:
        return None
    back, back_valid, _ = cv2.calcOpticalFlowPyrLK(source.gray, target.gray, following, None, winSize=(25,25), maxLevel=3)
    if back is None:
        return None
    p, q = points.reshape(-1,2), following.reshape(-1,2)
    ih, iw = source.gray.shape
    safe = (valid.ravel()>0) & (back_valid.ravel()>0) & (np.linalg.norm(back.reshape(-1,2)-p, axis=1)<1.2)
    safe &= (q[:,0]>=0) & (q[:,0]<iw) & (q[:,1]>=0) & (q[:,1]<ih)
    idx = np.clip(np.round(q).astype(int), [0,0], [iw-1,ih-1])
    source_mask=source.mask if source.mask is not None else mask
    source_small=cv2.resize(source_mask,(iw,ih),interpolation=cv2.INTER_NEAREST)
    source_small=cv2.dilate(source_small,np.ones((9,9),np.uint8))
    safe &= source_small[idx[:,1],idx[:,0]]==0
    if safe.sum()<12:
        return None
    matrix, inliers = cv2.estimateAffinePartial2D(p[safe], q[safe], method=cv2.RANSAC, ransacReprojThreshold=1.5, maxIters=1500)
    if matrix is None or inliers.sum()<10 or np.mean(inliers)<.55:
        return None
    scale = float(np.linalg.norm(matrix[:,0]))
    if not .85<scale<1.18:
        return None
    h,w = target.pixels.shape[:2]
    sx, sy = w/iw, h/ih
    # Convert coordinates from tracking resolution to original resolution.
    matrix[0,1] *= sx/sy
    matrix[1,0] *= sy/sx
    matrix[0,2] *= sx
    matrix[1,2] *= sy
    return matrix


def repair(target, references, mask):
    """Fuse trustworthy background observations; inpaint only unobserved pixels."""
    ys,xs = np.where(mask>0)
    x0,x1,y0,y1 = int(xs.min()),int(xs.max()+1),int(ys.min()),int(ys.max()+1)
    # Keep enough exterior pixels to judge alignment and hide reconstruction seams.
    pad=24
    x0=max(0,x0-pad);y0=max(0,y0-pad)
    x1=min(mask.shape[1],x1+pad);y1=min(mask.shape[0],y1+pad)
    roi=target.pixels[y0:y1,x0:x1]
    local_mask=mask[y0:y1,x0:x1]
    ch,cw=local_mask.shape
    # Exclude partially transparent outlines from every source, too.
    ring=(cv2.dilate(local_mask,np.ones((17,17),np.uint8))>0)&(local_mask==0)
    tracking_mask=cv2.resize(mask,(target.gray.shape[1],target.gray.shape[0]),interpolation=cv2.INTER_NEAREST)
    tracking_mask=cv2.dilate(tracking_mask,np.ones((9,9),np.uint8))
    features=cv2.goodFeaturesToTrack(target.gray,360,.008,7,mask=255-tracking_mask,blockSize=5)
    candidates=[]
    for source in references:
        if source.scene!=target.scene:
            continue
        source_mask=source.mask if source.mask is not None else mask
        source_valid=255-cv2.dilate(source_mask,np.ones((5,5),np.uint8))
        matrix=align(target,source,mask,features)
        if matrix is None:
            continue
        # Output ROI coordinates must map into full source coordinates.
        matrix[:,2] += matrix[:,:2] @ np.array([x0,y0])
        warp=cv2.warpAffine(source.pixels,matrix,(cw,ch),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_CONSTANT)
        valid=cv2.warpAffine(source_valid,matrix,(cw,ch),flags=cv2.INTER_NEAREST|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_CONSTANT)>0
        compare=ring & valid
        if compare.sum()<20:
            continue
        # Robust exposure compensation from untouched pixels beside the repair.
        delta=np.median(roi[compare].astype(np.float32)-warp[compare].astype(np.float32),axis=0)
        if np.max(np.abs(delta))>35:
            continue
        corrected=np.clip(warp.astype(np.float32)+delta,0,255)
        error=np.mean(np.abs(corrected[compare]-roi[compare].astype(np.float32)),axis=1)
        if np.median(error)>18:
            continue
        candidate=corrected.copy()
        candidate[~valid]=np.nan
        candidates.append(candidate)
    recovered=np.zeros((ch,cw),bool)
    patch=roi.copy()
    if candidates:
        stack=np.stack(candidates)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)
            median=np.nanmedian(stack,axis=0)
            deviation=np.nanmedian(np.abs(stack-median),axis=0)
        support=np.sum(np.isfinite(stack[:,:,:,0]),axis=0)
        recovered=(local_mask>0)&(support>=1)&np.all(np.isfinite(median),axis=2)&(np.nan_to_num(deviation,nan=255).mean(axis=2)<22)
        patch[recovered]=median[recovered].astype(np.uint8)
    unknown=((local_mask>0)&~recovered).astype(np.uint8)*255
    if np.any(unknown):
        # A standard CV primitive is our explicit fallback, not a pretrained model.
        patch=cv2.inpaint(patch,unknown,3,cv2.INPAINT_TELEA)
    output=target.pixels.copy()
    selected=local_mask>0
    dst=output[y0:y1,x0:x1]
    dst[selected]=patch[selected]
    return output, int(recovered.sum()), int(selected.sum()), len(candidates)


def run(input_path, output_path, box, quality='high', radius=12, margin=3, keyframes=None):
    source=av.open(str(input_path))
    stream=source.streams.video[0]
    if stream.codec_context.width%2 or stream.codec_context.height%2:
        raise ValueError('This encoder needs even video dimensions. Resize the source by one pixel before processing.')
    if (stream.metadata.get('rotate','0') not in ('0','')):
        raise ValueError('Export the video upright before processing.')
    frames=source.decode(stream)
    first=next(frames,None)
    if first is None:
        raise ValueError('No readable video frames.')
    h,w=first.height,first.width
    keyframes=sorted(keyframes or [],key=lambda k:k['time'])
    make_mask((h,w),box,margin)
    # Bound the frame cache to approximately 256 MiB, including decoded frames.
    radius=min(radius,max(1,(256*1024*1024//(w*h*5)-3)//2))
    clock=Fraction(1,90000)
    base_pts=first.pts or 0
    rate=stream.average_rate or Fraction(30,1)
    total_seconds=float(stream.duration*stream.time_base) if stream.duration else 0
    destination=av.open(str(output_path),'w')
    encoded=destination.add_stream('libx264',rate=rate)
    encoded.width=w;encoded.height=h;encoded.pix_fmt='yuv420p';encoded.time_base=clock
    encoded.codec_context.time_base=clock
    encoded.codec_context.max_b_frames=0
    # Keep standard SDR primaries/transfer/range metadata when PyAV exposes it.
    for name in ('color_range','colorspace','color_primaries','color_trc'):
        try:setattr(encoded.codec_context,name,getattr(stream.codec_context,name))
        except (AttributeError,ValueError,TypeError):pass
    encoded.options={'crf':'17' if quality=='high' else '20','preset':'medium'}
    past=deque(maxlen=radius)
    future=deque()
    previous=None
    scene=0
    index=0
    last_pts=-1
    def convert(frame):
        nonlocal previous,scene,index,last_pts
        pts=round(((frame.pts-base_pts)*frame.time_base)/clock) if frame.pts is not None else round(index/float(rate)/float(clock))
        pts=max(last_pts+1,pts);last_pts=pts;index+=1
        frame_mask=make_mask((h,w),box_at(float(pts*clock),box,keyframes),margin)
        item=prepare(frame.to_ndarray(format='bgr24'),pts,scene,frame_mask)
        if previous is not None:
            if is_scene_cut(previous,item):
                scene+=1
                item.scene=scene
        previous=item
        return item
    future.append(convert(first))
    exhausted=False
    processed=0;recovered_sum=0;selected_sum=0;fallback_frames=0
    try:
        while future:
            while not exhausted and len(future)<radius+1:
                frame=next(frames,None)
                if frame is None:
                    exhausted=True
                else:
                    future.append(convert(frame))
            target=future.popleft()
            neighbors=list(past)+list(future)
            # Prefer distant views with more disoccluded background; cap compute.
            neighbors=sorted(neighbors,key=lambda x:abs(x.pts-target.pts),reverse=True)[:12]
            repaired,recovered,selected,accepted=repair(target,neighbors,target.mask)
            vf=av.VideoFrame.from_ndarray(repaired,format='bgr24')
            vf.pts=target.pts;vf.time_base=clock
            for packet in encoded.encode(vf):
                destination.mux(packet)
            processed+=1;recovered_sum+=recovered;selected_sum+=selected
            fallback_frames+=recovered==0
            if processed%3==0 or exhausted:
                progress=min(89,round(float(target.pts*clock)/total_seconds*88)) if total_seconds else 0
                emit(stage='repairing',progress=progress,frames=processed,temporalCoverage=round(recovered_sum/max(1,selected_sum)*100,1),references=accepted)
            past.append(target)
        for packet in encoded.encode():
            destination.mux(packet)
    finally:
        destination.close();source.close()
    stats={'engine':'MSK Temporal Repair v1','frames':processed,'temporalCoverage':round(recovered_sum/max(1,selected_sum)*100,1),'fallbackFrames':fallback_frames,'windowRadius':radius,'margin':margin,'maskMode':'keyframed' if keyframes else 'fixed','keyframes':len(keyframes)}
    emit(stage='repaired',progress=90,stats=stats)
    return stats

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--box',required=True);parser.add_argument('--quality',default='high')
    parser.add_argument('--keyframes',default='[]')
    parser.add_argument('--radius',type=int,default=12);parser.add_argument('--margin',type=int,default=3)
    args=parser.parse_args()
    try:
        run(Path(args.input),Path(args.output),json.loads(args.box),args.quality,max(2,min(24,args.radius)),max(0,min(12,args.margin)),json.loads(args.keyframes))
    except Exception as exc:
        emit(stage='error',error=str(exc));sys.exit(1)
