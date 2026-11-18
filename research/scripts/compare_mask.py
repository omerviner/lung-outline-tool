"""Compare a JS lung mask (.u8, shape z,512,512) with the Python LungMask nii.gz of the same scan."""
import sys
import numpy as np
import SimpleITK as sitk

js = np.fromfile(sys.argv[1], np.uint8)
py = sitk.GetArrayFromImage(sitk.ReadImage(sys.argv[2]))
js = js.reshape(py.shape)
def dice(a, b): return 2.0 * (a & b).sum() / max(a.sum() + b.sum(), 1)
print("shape", py.shape)
print("union (lung>0) Dice: %.4f" % dice(js > 0, py > 0))
for c in (1, 2): print("class %d Dice: %.4f" % (c, dice(js == c, py == c)))
print("voxels  js=%d py=%d" % ((js > 0).sum(), (py > 0).sum()))
