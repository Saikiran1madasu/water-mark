"""Generate deterministic video fixtures for the application, not real-world footage."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parent))
from test_engine import texture
import av
import numpy as np


def generate(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    base=texture()
    for watermarked,name in [(True,'local-motion.mp4'),(False,'local-motion-clean.mp4')]:
        with av.open(str(folder/name),'w') as container:
            stream=container.add_stream('libx264',rate=24)
            stream.width=320;stream.height=180;stream.pix_fmt='yuv420p'
            stream.options={'crf':'14'}
            for i in range(72):
                image=base[:,:320].copy()
                image[28:152,64:256]=base[28:152,60+i*3:252+i*3]
                if watermarked:image[77:97,147:166]=255
                frame=av.VideoFrame.from_ndarray(image,format='bgr24')
                frame.pts=i
                for packet in stream.encode(frame):container.mux(packet)
            for packet in stream.encode():container.mux(packet)

if __name__=='__main__':generate(Path(__file__).resolve().parents[1]/'dist'/'examples')
