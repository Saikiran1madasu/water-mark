"""Conservative overlay-mask behavior: protect real pixels and reject weak fits."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
import unittest
import numpy as np
import cv2
from footprint import refine_footprint,composite_footprint
from temporal import prepare,make_mask,repair
from test_structure import patterned_background


def scene(level=255,soft=True):
    clean=patterned_background()
    selection=make_mask(clean.shape,{'x':420/640,'y':240/384,'w':80/640,'h':90/384},3)
    overlay=np.zeros(clean.shape[:2],np.uint8)
    points=np.array([[460,258],[468,280],[486,286],[468,293],[460,314],[452,293],[434,286],[452,280]])
    cv2.fillPoly(overlay,[points],255)
    alpha=overlay.astype(np.float32)/255
    if soft:alpha=cv2.GaussianBlur(alpha,(5,5),.8)
    observed=np.clip(clean*(1-alpha[:,:,None])+level*alpha[:,:,None],0,255).astype(np.uint8)
    return clean,observed,selection,alpha

class FootprintBehavior(unittest.TestCase):
    def test_soft_light_logo_has_shape_mask_and_no_visible_bright_residue(self):
        clean,observed,selection,mark=scene()
        result=refine_footprint(observed,clean,selection,1)
        self.assertIsNotNone(result)
        alpha,info=result;out=composite_footprint(observed,clean,alpha)
        self.assertEqual(info['overlay'],'light')
        self.assertGreater(info['preservedPixels'],selection.sum()/255*.35)
        self.assertLess(float(np.abs(out[mark>.02].astype(float)-clean[mark>.02]).mean()),1)
        np.testing.assert_array_equal(out[alpha==0],observed[alpha==0])

    def test_dark_logo_is_supported(self):
        clean,observed,selection,mark=scene(0)
        result=refine_footprint(observed,clean,selection,1)
        self.assertIsNotNone(result);self.assertEqual(result[1]['overlay'],'dark')
        out=composite_footprint(observed,clean,result[0])
        self.assertLess(float(np.abs(out[mark>.02].astype(float)-clean[mark>.02]).mean()),1)

    def test_full_rectangle_uses_safe_existing_fallback(self):
        clean,_,selection,_=scene()
        observed=clean.copy();observed[selection>0]=255
        self.assertIsNone(refine_footprint(observed,clean,selection,1))

    def test_weak_evidence_does_not_trim_the_selection(self):
        clean,_,selection,_=scene()
        observed=clean.copy();observed[selection>0]=np.clip(observed[selection>0].astype(int)+1,0,255)
        self.assertIsNone(refine_footprint(observed,clean,selection,1.5))

    def test_bad_plate_is_rejected(self):
        clean,observed,selection,_=scene()
        bad=clean.copy();bad[selection>0]=0
        self.assertIsNone(refine_footprint(observed,bad,selection,1.5))

    def test_engine_reports_preserved_pixels_separately(self):
        clean,observed,selection,mark=scene()
        diagnostic={};out,recovered,selected,_=repair(prepare(observed,0,0,selection),[],selection,diagnostics=diagnostic)
        self.assertTrue(diagnostic['precisionMask'])
        self.assertEqual(diagnostic['preservedSelectionPixels']+diagnostic['structurePixels'],selected)
        self.assertEqual(recovered,0)
        self.assertLess(float(np.abs(out[mark>.02].astype(float)-clean[mark>.02]).mean()),2)

if __name__=='__main__':unittest.main()
