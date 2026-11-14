"""Focused GIS regression tests; synthetic pixels are tests only, never app data."""
import tempfile, unittest
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_geom
from shapely.geometry import box,mapping,shape
from environment import stats,heat,exclusion

class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.affine=from_origin(600000,4200000,30,30)
        self.geom=transform_geom(32610,4326,mapping(box(600000,4199940,600060,4200000)))
    def raster(self,name,values,nodata=0):
        p=Path(self.tmp.name)/name
        with rasterio.open(p,'w',driver='GTiff',height=2,width=2,count=1,dtype='uint16',crs='EPSG:32610',transform=self.affine,nodata=nodata) as f:f.write(np.array(values,dtype='uint16'),1)
        return p
    def test_zero_canopy_is_valid(self):
        p=self.raster('c.tif',[[0,0],[100,100]])
        value,fraction=stats(p,self.geom,0,100)
        self.assertEqual(value,50);self.assertEqual(fraction,1)
    def test_cloud_pixel_excluded(self):
        paths={'lwir11':self.raster('t.tif',[[44000,50000],[44000,44000]]),'qa_pixel':self.raster('q.tif',[[0,8],[0,0]]),'qa_radsat':self.raster('s.tif',[[0,0],[0,0]])}
        value,fraction=heat(paths,self.geom)
        self.assertAlmostEqual(value,44000*.00341802+149-273.15)
        self.assertAlmostEqual(fraction,.75,places=4)
    def test_water_and_wetland_removed(self):
        p=self.raster('l.tif',[[11,90],[95,21]])
        remaining,fraction=exclusion(p,self.geom)
        self.assertEqual(fraction,1)
        self.assertTrue(remaining.is_valid)
        self.assertLess(remaining.area,shape(self.geom).area*.26)
        self.assertGreater(remaining.area,shape(self.geom).area*.24)
if __name__=='__main__':unittest.main()
