"""MSK temporal repair v2. Original orchestration and reconstruction algorithm.

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
import time
import warnings
from pathlib import Path
import av
import cv2
import numpy as np
from refinement import motion_models, sample, boundary_score, dense_refine, exemplar_fill, select_references

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


def repair(target, references, mask, detail=True, previous=None, diagnostics=None):
    """Locally align clean observations, reject occlusions, synthesize only gaps."""
    ys,xs = np.where(mask>0)
    x0,x1,y0,y1 = int(xs.min()),int(xs.max()+1),int(ys.min()),int(ys.max()+1)
    pad=max(48,min(128,max(x1-x0,y1-y0)))
    x0=max(0,x0-pad);y0=max(0,y0-pad)
    x1=min(mask.shape[1],x1+pad);y1=min(mask.shape[0],y1+pad)
    roi=target.pixels[y0:y1,x0:x1]
    local_mask=mask[y0:y1,x0:x1]
    ch,cw=local_mask.shape;rect=(x0,y0,cw,ch)
    ring=(cv2.dilate(local_mask,np.ones((17,17),np.uint8))>0)&(local_mask==0)
    candidates=[];scores=[];dense_count=0;dense_attempts=0
    for source in references:
        if source.scene!=target.scene:continue
        source_mask=source.mask if source.mask is not None else mask
        models=motion_models(target,source,mask)
        best=None
        for matrix in models:
            warped,valid=sample(source,matrix,rect,source_mask)
            judged=boundary_score(roi,warped,valid,ring)
            if judged is None:continue
            corrected,error,score=judged
            if best is None or score<best[0]:best=(score,corrected,error,valid,matrix)
        if best is None:continue
        score,corrected,error,valid,matrix=best
        if detail and score>4 and dense_attempts<4:
            dense_attempts+=1
            refined=dense_refine(target,source,matrix,mask,rect)
            if refined is not None:
                warped,dense_valid=refined
                judged=boundary_score(roi,warped,dense_valid,ring)
                if judged is not None and judged[2]+.5<score:
                    corrected,error,score=judged;valid=dense_valid;dense_count+=1
        if score>24:continue
        # Propagate measured exterior error through the hole. This rejects
        # locally inconsistent observations even if most of the ring matches.
        uncertainty=cv2.inpaint(error.astype(np.float32),local_mask,4,cv2.INPAINT_NS)
        valid=valid&((local_mask==0)|(uncertainty<28))
        candidate=corrected.copy();candidate[~valid]=np.nan
        candidates.append(candidate);scores.append(score)
    recovered=np.zeros((ch,cw),bool);patch=roi.copy()
    if candidates:
        stack=np.stack(candidates)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)
            median=np.nanmedian(stack,axis=0)
            deviation=np.nanmedian(np.abs(stack-median),axis=0)
        support=np.sum(np.isfinite(stack[:,:,:,0]),axis=0)
        recovered=(local_mask>0)&(support>=1)&np.all(np.isfinite(median),axis=2)&(np.nan_to_num(deviation,nan=255).mean(axis=2)<26)
        # Select one observed RGB pixel closest to the consensus, rather than
        # averaging mismatched textures into a blurred or ghosted replacement.
        cost=np.nan_to_num(np.abs(stack-median).mean(axis=3),nan=np.inf)
        cost+=np.asarray(scores,np.float32)[:,None,None]*.15
        winner=np.argmin(cost,axis=0)
        yy,xx=np.indices((ch,cw));chosen=stack[winner,yy,xx]
        patch[recovered]=np.nan_to_num(chosen[recovered]).astype(np.uint8)
    unknown=((local_mask>0)&~recovered).astype(np.uint8)*255
    stable_pixels=0
    if np.any(unknown):
        patch=exemplar_fill(patch,unknown,local_mask) if detail else cv2.inpaint(patch,unknown,3,cv2.INPAINT_TELEA)
        # Previous synthesized pixels remain fallback; never count them as real
        # background recovery. Use them only when current boundary motion agrees.
        if previous is not None and previous.scene==target.scene:
            for matrix in motion_models(target,previous,mask):
                warped,valid=sample(previous,matrix,rect,np.zeros_like(mask))
                judged=boundary_score(roi,warped,valid,ring)
                if judged is not None and judged[2]<6:
                    steady=(unknown>0)&valid
                    patch[steady]=np.clip(.7*judged[0][steady]+.3*patch[steady],0,255).astype(np.uint8)
                    stable_pixels=int(steady.sum());break
    output=target.pixels.copy();selected=local_mask>0
    output[y0:y1,x0:x1][selected]=patch[selected]
    if diagnostics is not None:diagnostics.update(denseReferences=dense_count,stabilizedFallbackPixels=stable_pixels)
    return output,int(recovered.sum()),int(selected.sum()),len(candidates)


def run(input_path, output_path, box, quality='high', radius=12, margin=3, keyframes=None, mode='detail'):
    started=time.perf_counter()
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
    processed=0;recovered_sum=0;selected_sum=0;fallback_frames=0;previous_repair=None;dense_total=0;stable_total=0
    emit(stage='repairing',progress=0,frames=0,temporalCoverage=0)
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
            neighbors=select_references(neighbors,target,12 if mode=='detail' else 6)
            diagnostic={}
            repaired,recovered,selected,accepted=repair(target,neighbors,target.mask,mode=='detail',previous_repair,diagnostic)
            dense_total+=diagnostic.get('denseReferences',0);stable_total+=diagnostic.get('stabilizedFallbackPixels',0)
            previous_repair=Frame(repaired,target.gray,target.hist,target.pts,target.scene,target.mask)
            vf=av.VideoFrame.from_ndarray(repaired,format='bgr24')
            vf.pts=target.pts;vf.time_base=clock
            for packet in encoded.encode(vf):
                destination.mux(packet)
            processed+=1;recovered_sum+=recovered;selected_sum+=selected
            fallback_frames+=recovered==0
            if processed>=1:
                progress=min(89,round(float(target.pts*clock)/total_seconds*88)) if total_seconds else 0
                emit(stage='repairing',progress=progress,frames=processed,temporalCoverage=round(recovered_sum/max(1,selected_sum)*100,1),references=accepted)
            past.append(target)
        for packet in encoded.encode():
            destination.mux(packet)
    finally:
        destination.close();source.close()
    stats={'engine':'MSK Temporal Repair v2','frames':processed,'temporalCoverage':round(recovered_sum/max(1,selected_sum)*100,1),'fallbackFrames':fallback_frames,'windowRadius':radius,'margin':margin,'maskMode':'keyframed' if keyframes else 'fixed','keyframes':len(keyframes),'repairMode':mode,'denseReferences':dense_total,'stabilizedFallbackCoverage':round(stable_total/max(1,selected_sum)*100,1),'synthesizedCoverage':round(100-recovered_sum/max(1,selected_sum)*100,1),'processingSeconds':round(time.perf_counter()-started,2)}
    emit(stage='repaired',progress=90,stats=stats)
    return stats

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--box',required=True);parser.add_argument('--quality',default='high')
    parser.add_argument('--mode',choices=['detail','balanced'],default='detail')
    parser.add_argument('--keyframes',default='[]')
    parser.add_argument('--radius',type=int,default=12);parser.add_argument('--margin',type=int,default=3)
    args=parser.parse_args()
    try:
        run(Path(args.input),Path(args.output),json.loads(args.box),args.quality,max(2,min(24,args.radius)),max(0,min(12,args.margin)),json.loads(args.keyframes),args.mode)
    except Exception as exc:
        emit(stage='error',error=str(exc));sys.exit(1)
