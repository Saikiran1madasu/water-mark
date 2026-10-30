"""Regression for the exact built-in clip whose repair showed a visible patch.

The clean reference is used only for evaluation; the engine never receives it.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import av
import numpy as np

ROOT=Path(__file__).resolve().parents[1]

class VisiblePatchRegression(unittest.TestCase):
    def test_every_frame_including_moving_shapes_and_clip_end(self):
        with tempfile.TemporaryDirectory() as directory:
            working=Path(directory);source=working/'preview-input.mp4';output=working/'repaired.mp4'
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(ROOT/'dist/examples/local-motion.mp4'),'-t','3','-c:v','libx264','-preset','fast','-crf','12','-fps_mode','vfr',str(source)],check=True)
            completed=subprocess.run([sys.executable,str(ROOT/'engine/temporal.py'),'--input',str(source),'--output',str(output),'--box',json.dumps({'x':.46,'y':.43,'w':.06,'h':.11}),'--margin','3','--radius','12','--mode','detail'],capture_output=True,text=True,check=True)
            with av.open(str(output)) as container:actual=[f.to_ndarray(format='bgr24') for f in container.decode(video=0)]
            with av.open(str(ROOT/'dist/examples/local-motion-clean.mp4')) as container:truth=[f.to_ndarray(format='bgr24') for f in container.decode(video=0)]
            self.assertEqual(len(actual),72);self.assertEqual(len(actual),len(truth))
            errors=[float(np.abs(a[74:100,144:169].astype(float)-b[74:100,144:169]).mean()) for a,b in zip(actual,truth)]
            print(f'\nExact clip regression: mean MAE={np.mean(errors):.2f}, worst MAE={max(errors):.2f}, moving-shape frame={errors[36]:.2f}, final frame={errors[-1]:.2f}')
            self.assertLess(max(errors),6,'A single visibly bad frame must fail, even with a good average.')
            self.assertLess(errors[36],4,'Colored shape must remain intact behind the selected area.')
            self.assertLess(errors[-1],5,'Clip-end references must not produce a visible patch.')
            self.assertLess(np.mean(errors),4)

if __name__=='__main__':unittest.main()
