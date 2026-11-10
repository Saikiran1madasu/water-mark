"""Pattern and lighting regressions for the grid/ghosting failure class."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
import unittest
import cv2
import numpy as np
from structure import periodic_fill,smooth_fill
from temporal import prepare,make_mask,repair


def patterned_background():
    h,w=384,640;yy,xx=np.mgrid[:h,:w]
    value=220+.012*xx+.018*yy
    image=np.stack([value-5,value+2,value+4],axis=2).clip(0,255).astype(np.uint8)
    for y in range(24,h,48):
        for x in range(24,w,48):
            color=tuple(int(v-20) for v in image[y,x]);size=4 if ((x//48+y//48)%2)==0 else 2
            cv2.line(image,(x-size,y),(x+size,y),color,1)
            cv2.line(image,(x,y-size),(x,y+size),color,1)
    return image

class StructureBehavior(unittest.TestCase):
    def test_rebuilds_grid_without_smearing_crosses(self):
        clean=patterned_background();box={'x':430/640,'y':260/384,'w':52/640,'h':56/384}
        mask=make_mask(clean.shape,box,3)
        observed=clean.copy();center=(456,288)
        polygon=np.array([[456,263],[462,281],[479,288],[462,295],[456,313],[450,295],[433,288],[450,281]])
        cv2.fillPoly(observed,[polygon],(255,255,255))
        result=periodic_fill(observed,mask);self.assertIsNotNone(result)
        out,info=result;error=float(np.abs(out[mask>0].astype(float)-clean[mask>0]).mean())
        self.assertGreater(info['confidence'],.8);self.assertLess(error,2)
        np.testing.assert_array_equal(out[mask==0],observed[mask==0])

    def test_pattern_reconstruction_is_not_reported_as_temporal_recovery(self):
        clean=patterned_background();mask=make_mask(clean.shape,{'x':.7,'y':.65,'w':.08,'h':.14},3)
        image=clean.copy();image[mask>0]=255
        diagnostic={};_,recovered,selected,_=repair(prepare(image,0,0,mask),[],mask,diagnostics=diagnostic)
        self.assertEqual(recovered,0);self.assertEqual(diagnostic['structurePixels'],selected)
        self.assertEqual(diagnostic['structureMethod'],'pattern')

    def test_fractional_period_grid_preserves_its_detail(self):
        yy,xx=np.mgrid[:384,:640].astype(np.float32)
        dx=(xx+23.8)%47.6-23.8;dy=(yy+24.4)%48.8-24.4
        cross=np.maximum(np.exp(-(dx/.9)**2-(dy/4)**8),np.exp(-(dy/.9)**2-(dx/4)**8))
        base=230+.006*xx+.01*yy-30*cross
        clean=np.stack([base-3,base+1,base+2],axis=2).clip(0,255).astype(np.uint8)
        mask=make_mask(clean.shape,{'x':430/640,'y':260/384,'w':52/640,'h':56/384},3)
        observed=clean.copy();observed[mask>0]=255
        result=periodic_fill(observed,mask);self.assertIsNotNone(result)
        out,info=result
        self.assertLess(info['boundaryRMSE'],3.2)
        self.assertLess(float(np.abs(out[mask>0].astype(float)-clean[mask>0]).mean()),1.5)
        np.testing.assert_array_equal(out[mask==0],observed[mask==0])

    def test_bad_prior_cannot_override_a_better_clean_match(self):
        clean=patterned_background();mask=make_mask(clean.shape,{'x':430/640,'y':260/384,'w':52/640,'h':56/384},3)
        observed=clean.copy();observed[mask>0]=255
        result=periodic_fill(observed,mask,preferred_shift=(-88,0))
        self.assertIsNotNone(result)
        self.assertGreater(float(np.linalg.norm(np.array(result[1]['shift'])-[-88,0])),1.5)
        self.assertLess(float(np.abs(result[0][mask>0].astype(float)-clean[mask>0]).mean()),2)

    def test_smooth_light_is_filled_without_a_bright_ghost(self):
        yy,xx=np.mgrid[:180,:240].astype(np.float32)
        value=205+15*np.sin(xx/110)+8*np.cos(yy/95)
        clean=np.stack([value-10,value,value+4],axis=2).clip(0,255).astype(np.uint8)
        mask=make_mask(clean.shape,{'x':.5,'y':.4,'w':.18,'h':.22},3)
        observed=clean.copy();observed[mask>0]=255
        result=smooth_fill(observed,mask);self.assertIsNotNone(result)
        out,_=result;error=float(np.abs(out[mask>0].astype(float)-clean[mask>0]).mean())
        self.assertLess(error,2.5)
        np.testing.assert_array_equal(out[mask==0],observed[mask==0])

    def test_smooth_path_does_not_erase_high_contrast_grid(self):
        clean=patterned_background();mask=make_mask(clean.shape,{'x':.65,'y':.6,'w':.1,'h':.14},3)
        clean[mask>0]=255
        self.assertIsNone(smooth_fill(clean,mask))

if __name__=='__main__':unittest.main()
