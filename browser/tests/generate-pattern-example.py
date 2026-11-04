"""Known-clean synthetic regression fixture, not a successful removal simulation."""
from pathlib import Path
import av,cv2,numpy as np
root=Path(__file__).resolve().parents[1]/'public/examples';root.mkdir(exist_ok=True)
h,w=360,640;yy,xx=np.mgrid[:h,:w].astype(np.float32)
for marked,name in [(False,'pattern-lighting-clean.mp4'),(True,'pattern-lighting.mp4')]:
 with av.open(str(root/name),'w') as container:
  stream=container.add_stream('libx264',rate=24);stream.width=w;stream.height=h;stream.pix_fmt='yuv420p';stream.options={'crf':'14'}
  for frame in range(96):
   phase=frame/24;value=221+4*np.sin(xx/240)+3*np.cos(yy/170)
   image=np.stack([value-5,value+2,value+4],axis=2).clip(0,255).astype(np.uint8)
   for y in range(24,h,48):
    for x in range(24,w,48):
     color=tuple(int(v-14) for v in image[y,x]);cv2.line(image,(x-4,y),(x+4,y),color,1);cv2.line(image,(x,y-4),(x,y+4),color,1)
   image=cv2.remap(image,(xx+np.sin(phase)*.6).astype(np.float32),(yy+np.cos(phase)*.3).astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
   blend=np.clip((phase-2.5)/1.1,0,1)
   curved=208+15*np.sin(xx/65+phase*.3)*np.cos(yy/90)+16*np.exp(-((xx-570-phase*5)**2/5000+(yy-292)**2/3000))
   lighting=np.stack([curved-24,curved-9,curved+2],axis=2)
   image=np.clip(image*(1-blend)+lighting*blend,0,255).astype(np.uint8)
   if marked:
    overlay=np.zeros((h,w),np.uint8);cv2.fillPoly(overlay,[np.array([[560,268],[566,284],[580,290],[566,296],[560,312],[554,296],[540,290],[554,284]])],255)
    alpha=cv2.GaussianBlur(overlay.astype(np.float32)/255,(5,5),.7)[:,:,None];image=np.clip(image*(1-alpha)+255*alpha,0,255).astype(np.uint8)
   sample=av.VideoFrame.from_ndarray(image,format='bgr24');sample.pts=frame
   for packet in stream.encode(sample):container.mux(packet)
  for packet in stream.encode():container.mux(packet)
