"""Harder quality cases: independent layers, deformation, texture and stability."""
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
import cv2
import numpy as np
from temporal import prepare,make_mask,repair
from refinement import dense_refine,exemplar_fill,select_references
from test_engine import texture

class RefinementBehavior(unittest.TestCase):
    def test_foreground_moves_independently_of_camera(self):
        base=texture();mask=make_mask((180,320),{'x':.46,'y':.43,'w':.06,'h':.11},0)
        observed=[];clean=[]
        for i in range(25):
            image=base[:,:320].copy();image[28:152,64:256]=base[28:152,60+i*3:252+i*3]
            clean.append(image.copy());image[mask>0]=255;observed.append(prepare(image,i,0,mask))
        out,recovered,selected,_=repair(observed[12],[observed[i] for i in [0,4,8,16,20,24]],mask)
        error=float(np.abs(out[mask>0].astype(float)-clean[12][mask>0]).mean())
        print(f'\nIndependent motion: MAE={error:.2f}; coverage={recovered/selected:.1%}')
        self.assertLess(error,5);self.assertGreater(recovered/selected,.8)
        np.testing.assert_array_equal(out[mask==0],observed[12].pixels[mask==0])

    def test_dense_flow_improves_a_nonrigid_warp(self):
        base=texture()[:,:320].copy();yy,xx=np.mgrid[:180,:320].astype(np.float32)
        clean=cv2.remap(base,xx+5*np.sin(yy/20),yy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
        mask=make_mask(base.shape,{'x':.45,'y':.4,'w':.07,'h':.12},0)
        a=clean.copy();b=base.copy();a[mask>0]=255;b[mask>0]=255
        result=dense_refine(prepare(a,0,0,mask),prepare(b,1,0,mask),np.array([[1,0,0],[0,1,0]],np.float32),mask,(40,25,240,130))
        self.assertIsNotNone(result)
        warped,valid=result
        valid&=mask[25:155,40:280]==0
        before=float(np.abs(b[25:155,40:280][valid].astype(float)-clean[25:155,40:280][valid]).mean())
        after=float(np.abs(warped[valid].astype(float)-clean[25:155,40:280][valid]).mean())
        print(f'\nNonrigid alignment: initial MAE={before:.2f}; refined MAE={after:.2f}')
        self.assertLess(after,before*.7)

    def test_exemplar_preserves_repeating_texture_better_than_smooth_fill(self):
        yy,xx=np.mgrid[:100,:160];pattern=((xx//4)%2)*130+50
        clean=np.stack([pattern,pattern,pattern],axis=2).astype(np.uint8)
        mask=np.zeros((100,160),np.uint8);mask[35:65,65:95]=255
        observed=clean.copy();observed[mask>0]=255
        filled=exemplar_fill(observed,mask,mask)
        old=cv2.inpaint(observed,mask,3,cv2.INPAINT_TELEA)
        before=float(np.abs(old[mask>0].astype(float)-clean[mask>0]).mean())
        after=float(np.abs(filled[mask>0].astype(float)-clean[mask>0]).mean())
        print(f'\nStripe texture: smooth MAE={before:.2f}; exemplar MAE={after:.2f}')
        self.assertLess(after,before*.7)
        np.testing.assert_array_equal(filled[mask==0],observed[mask==0])

    def test_fallback_history_reduces_texture_flicker(self):
        clean=texture()[:,:320];mask=make_mask(clean.shape,{'x':.4,'y':.4,'w':.1,'h':.15},0)
        first=clean.copy();first[mask>0]=255
        old,_,_,_=repair(prepare(first,0,0,mask),[],mask)
        rng=np.random.default_rng(21)
        second=np.clip(clean.astype(np.int16)+rng.integers(-3,4,clean.shape),0,255).astype(np.uint8);second[mask>0]=255
        target=prepare(second,3000,0,mask)
        fresh,_,_,_=repair(target,[],mask)
        diagnostic={};stable,rec,_,_=repair(target,[],mask,previous=prepare(old,0,0,mask),diagnostics=diagnostic)
        baseline=float(np.abs(fresh[mask>0].astype(float)-old[mask>0]).mean())
        difference=float(np.abs(stable[mask>0].astype(float)-old[mask>0]).mean())
        self.assertGreater(diagnostic['stabilizedFallbackPixels'],0)
        self.assertEqual(rec,0)
        self.assertLess(difference,baseline)

    def test_reference_selection_keeps_near_and_far_views(self):
        image=np.zeros((40,60,3),np.uint8)
        target=prepare(image,12,0);neighbors=[prepare(image,i,0) for i in range(25) if i!=12]
        chosen=select_references(neighbors,target,12);times={f.pts for f in chosen}
        self.assertTrue({0,11,13,24}.issubset(times));self.assertEqual(len(times),12)

if __name__=='__main__':unittest.main()
