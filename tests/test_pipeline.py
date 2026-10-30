"""End-to-end HTTP export: known moving background, variable timestamps, audio."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error
import urllib.parse
from fractions import Fraction
import av
import cv2
import numpy as np
from test_engine import texture

ROOT=Path(__file__).resolve().parents[1]

class Pipeline(unittest.TestCase):
    def test_export_with_real_motion_recovery_audio_and_variable_timestamps(self):
        with tempfile.TemporaryDirectory() as folder:
            temp=Path(folder);base=texture();clean=[];pts=[]
            raw=temp/'raw.mp4'
            with av.open(str(raw),'w') as container:
                stream=container.add_stream('libx264',rate=24)
                stream.width=320;stream.height=180;stream.pix_fmt='yuv420p'
                stream.time_base=Fraction(1,90000);stream.codec_context.time_base=Fraction(1,90000)
                stream.codec_context.max_b_frames=0;stream.options={'crf':'12'}
                stamp=0
                for i in range(28):
                    image=base[:,i*4:i*4+320].copy();clean.append(image.copy());pts.append(stamp)
                    image[72:94,144:168]=255
                    frame=av.VideoFrame.from_ndarray(image,format='bgr24');frame.pts=stamp;frame.time_base=Fraction(1,90000)
                    for packet in stream.encode(frame):container.mux(packet)
                    stamp+=3000 if i%2 else 4500
                for packet in stream.encode():container.mux(packet)
            source=temp/'source.mp4'
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(raw),'-f','lavfi','-i','sine=frequency=440:duration=1.2','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-shortest',str(source)],check=True)
            env=os.environ.copy();env['PORT']='4174'
            server=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                address='http://localhost:4174'
                for _ in range(100):
                    try:
                        health=json.load(urllib.request.urlopen(address+'/api/health',timeout=1))
                        if health['available']:break
                    except OSError:pass
                    time.sleep(.2)
                else:self.fail('Server did not start with engine available')
                box={'x':144/320,'y':72/180,'w':24/320,'h':22/180}
                url=address+'/api/jobs?'+urllib.parse.urlencode({'box':json.dumps(box),'quality':'high','margin':0,'radius':12})
                response=json.load(urllib.request.urlopen(urllib.request.Request(url,data=source.read_bytes(),headers={'Content-Type':'video/mp4'})))
                for _ in range(400):
                    status=json.load(urllib.request.urlopen(address+'/api/jobs/'+response['id']))
                    if status['status'] in ['failed','completed']:break
                    time.sleep(.2)
                self.assertEqual(status['status'],'completed',status)
                self.assertGreater(status['stats']['temporalCoverage'],60)
                output=temp/'result.mp4';output.write_bytes(urllib.request.urlopen(address+'/outputs/'+response['id']+'.mp4').read())
                with av.open(str(source)) as src:
                    source_frames=list(src.decode(video=0))
                    original_pts=[float(f.pts*f.time_base) for f in source_frames]
                with av.open(str(output)) as result:
                    self.assertEqual(len(result.streams.audio),1)
                    frames=list(result.decode(video=0))
                    self.assertEqual(len(frames),len(source_frames))
                    actual_pts=[float(f.pts*f.time_base) for f in frames]
                    np.testing.assert_allclose(actual_pts,original_pts,atol=.001)
                    self.assertEqual((frames[0].width,frames[0].height),(320,180))
                    errors=[np.abs(f.to_ndarray(format='bgr24')[72:94,144:168].astype(float)-clean[i][72:94,144:168]).mean() for i,f in enumerate(frames)]
                old=temp/'old.mp4'
                subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-vf','delogo=x=144:y=72:w=24:h=22','-an','-c:v','libx264','-crf','17','-fps_mode','vfr',str(old)],check=True)
                with av.open(str(old)) as result:
                    old_frames=list(result.decode(video=0))
                    baseline=[np.abs(f.to_ndarray(format='bgr24')[72:94,144:168].astype(float)-clean[i][72:94,144:168]).mean() for i,f in enumerate(old_frames)]
                print(f'\nHTTP benchmark: MSK MAE={np.mean(errors):.2f}; previous delogo MAE={np.mean(baseline):.2f}; coverage={status["stats"]["temporalCoverage"]}%')
                self.assertLess(np.mean(errors),np.mean(baseline)*.7)
                req=urllib.request.Request(address+'/api/jobs?box=%7B%7D',data=b'bad',headers={'Content-Type':'video/mp4'})
                with self.assertRaises(urllib.error.HTTPError) as failure:urllib.request.urlopen(req)
                self.assertEqual(failure.exception.code,400)
                failure.exception.close()
            finally:
                server.terminate()
                try:server.communicate(timeout=5)
                except subprocess.TimeoutExpired:server.kill();server.communicate()
                # Test output is the only persistent artifact generated by this test.
                if 'response' in locals():
                    artifact=ROOT/'.runtime'/(response['id']+'.mp4')
                    artifact.unlink(missing_ok=True)

if __name__=='__main__':unittest.main()
