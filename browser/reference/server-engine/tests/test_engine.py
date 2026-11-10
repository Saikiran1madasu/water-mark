"""Behavior tests using known clean footage, rather than implementation snapshots."""
import sys
from pathlib import Path
import unittest
import cv2
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from temporal import prepare,make_mask,repair,is_scene_cut,box_at


def texture():
    rng=np.random.default_rng(7)
    base=rng.integers(0,255,(180,520,3),dtype=np.uint8)
    base=cv2.GaussianBlur(base,(5,5),0)
    for i in range(20):
        x=int(rng.integers(0,500));y=int(rng.integers(0,160))
        cv2.rectangle(base,(x,y),(x+15,y+15),tuple(int(x) for x in rng.integers(20,235,3)),-1)
    return base


class TemporalBehavior(unittest.TestCase):
    def test_recovers_hidden_detail_from_moving_background(self):
        base=texture();box={'x':.45,'y':.4,'w':.07,'h':.12}
        mask=make_mask((180,320),box,0)
        clean=[base[:,i*4:i*4+320].copy() for i in range(25)]
        observed=[]
        for i,image in enumerate(clean):
            image=image.copy();image[mask>0]=255
            observed.append(prepare(image,i,0))
        target=observed[12]
        references=[observed[i] for i in [0,2,4,6,18,20,22,24]]
        out,recovered,selected,accepted=repair(target,references,mask)
        mae=float(np.abs(out[mask>0].astype(float)-clean[12][mask>0]).mean())
        spatial=cv2.inpaint(target.pixels,mask,3,cv2.INPAINT_TELEA)
        baseline=float(np.abs(spatial[mask>0].astype(float)-clean[12][mask>0]).mean())
        print(f'\nMotion benchmark: temporal MAE={mae:.2f}, spatial MAE={baseline:.2f}, recovered={recovered/selected:.1%}, refs={accepted}')
        self.assertGreater(recovered/selected,.7)
        self.assertLess(mae,baseline*.6)
        np.testing.assert_array_equal(out[mask==0],target.pixels[mask==0])

    def test_does_not_reuse_another_scene(self):
        base=texture();box={'x':.45,'y':.4,'w':.07,'h':.12};mask=make_mask((180,320),box,0)
        image=base[:,:320].copy();image[mask>0]=255
        target=prepare(image,0,0)
        out,recovered,_,accepted=repair(target,[prepare(base[:,40:360],1,1)],mask)
        self.assertEqual(recovered,0);self.assertEqual(accepted,0)
        np.testing.assert_array_equal(out[mask==0],target.pixels[mask==0])

    def test_static_hidden_background_uses_explicit_fallback(self):
        image=np.full((100,160,3),90,np.uint8)
        mask=make_mask(image.shape,{'x':.4,'y':.4,'w':.1,'h':.15},0)
        image[mask>0]=255
        frame=prepare(image)
        out,recovered,_,_=repair(frame,[frame],mask)
        self.assertEqual(recovered,0)
        self.assertLess(float(out[mask>0].mean()),105)
        np.testing.assert_array_equal(out[mask==0],image[mask==0])

    def test_moving_overlay_uses_each_sources_own_mask(self):
        background=texture()[:,:320].copy();observed=[]
        for i in range(25):
            mask=make_mask(background.shape,{'x':(70+i*6)/320,'y':.4,'w':24/320,'h':22/180},0)
            pixels=background.copy();pixels[mask>0]=255
            observed.append(prepare(pixels,i,0,mask))
        target=observed[12]
        out,recovered,selected,accepted=repair(target,[observed[i] for i in [0,4,20,24]],target.mask)
        self.assertGreater(recovered/selected,.85)
        error=np.abs(out[target.mask>0].astype(float)-background[target.mask>0]).mean()
        self.assertLess(error,5)
        print(f'\nMoving overlay: MAE={error:.2f}, recovered={recovered/selected:.1%}, refs={accepted}')

    def test_mask_keyframes_interpolate_position_and_size(self):
        left={'x':.1,'y':.2,'w':.1,'h':.1};right={'x':.5,'y':.4,'w':.2,'h':.3}
        keys=[{'time':1,'box':left},{'time':3,'box':right}]
        middle=box_at(2,left,keys)
        for k,v in {'x':.3,'y':.3,'w':.15,'h':.2}.items():self.assertAlmostEqual(middle[k],v)
        self.assertEqual(box_at(0,left,keys),left)
        self.assertEqual(box_at(5,left,keys),right)

    def test_detects_abrupt_scene_change(self):
        a=np.zeros((100,160,3),np.uint8);a[:,:,0]=210
        b=np.zeros((100,160,3),np.uint8);b[:,:,2]=210
        self.assertTrue(is_scene_cut(prepare(a),prepare(b)))
        self.assertFalse(is_scene_cut(prepare(a),prepare(a.copy())))

    def test_wide_text_band_is_supported(self):
        image=np.full((180,320,3),90,np.uint8)
        mask=make_mask(image.shape,{'x':.05,'y':.4,'w':.9,'h':.12},3)
        image[mask>0]=255
        out,recovered,selected,_=repair(prepare(image),[],mask)
        self.assertGreater(selected,320*180*.1)
        self.assertEqual(recovered,0)
        self.assertLess(float(out[mask>0].mean()),110)
        np.testing.assert_array_equal(out[mask==0],image[mask==0])

    def test_invalid_and_large_masks_rejected(self):
        for box in [{'x':0,'y':0,'w':.01,'h':.01},{'x':0,'y':0,'w':1,'h':1}]:
            with self.assertRaises(ValueError):make_mask((100,160),box)

if __name__=='__main__':unittest.main()
