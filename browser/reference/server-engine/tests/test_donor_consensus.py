"""Independent clean tiles must outvote an anomalous hidden interior safely."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
import unittest
import numpy as np
from structure import select_pattern_donor

class DonorConsensus(unittest.TestCase):
    def setUp(self):
        self.hole=np.ones((12,12),np.uint8)
        y,x=np.mgrid[:12,:12]
        self.clean=np.repeat((220-20*((x==6)|(y==6)))[:,:,None],3,axis=2).astype(np.float32)
    def proposal(self,score,patch,shift):return (score,patch,.95,score,shift)
    def test_three_clean_tiles_reject_a_better_scoring_hidden_foreground(self):
        bad=self.clean.copy();bad[3:9,3:9]=90
        candidates=[self.proposal(.8,bad,(0,48))]+[self.proposal(1+i*.05,self.clean+i*.1,(48*(i+1),0)) for i in range(3)]
        selected,support=select_pattern_donor(candidates,self.hole)
        self.assertEqual(support,3)
        self.assertIs(selected,candidates[1])
        np.testing.assert_array_equal(selected[1],self.clean)
    def test_duplicate_positions_cannot_manufacture_a_majority(self):
        candidates=[self.proposal(.8,self.clean+20,(0,48))]+[self.proposal(1,self.clean,(48+i,0)) for i in range(3)]
        selected,support=select_pattern_donor(candidates,self.hole)
        self.assertIs(selected,candidates[0]);self.assertEqual(support,0)
    def test_equal_conflicting_groups_do_not_override_boundary_evidence(self):
        candidates=[self.proposal(1+i*.05,self.clean+(20 if i<2 else 0),(48*i,0)) for i in range(4)]
        selected,support=select_pattern_donor(candidates,self.hole)
        self.assertIs(selected,candidates[0]);self.assertEqual(support,0)
    def test_bad_boundary_tiles_cannot_outvote_a_valid_match(self):
        candidates=[self.proposal(.5,self.clean,(0,48))]+[self.proposal(2,self.clean+20,(48*(i+1),0)) for i in range(3)]
        selected,support=select_pattern_donor(candidates,self.hole)
        self.assertIs(selected,candidates[0]);self.assertEqual(support,0)

if __name__=='__main__':unittest.main()
