"""Cache local windows of source rasters for the Tracy and Mountain House refresh."""
import json
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds, Window
from shapely.geometry import box, shape

from environment import CACHE, STAC, download, get_json

BOUNDS = (-121.66, 37.60, -121.26, 37.92)
SIGN = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign?'
MANIFEST = CACHE / 'tracy-mountain-house-2026.json'


def clip(url, path, bounds_wgs84=BOUNDS):
    if path.exists():
        return
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_HTTP_TIMEOUT='35'):
        with rasterio.open(url) as src:
            bounds = transform_bounds('EPSG:4326', src.crs, *bounds_wgs84)
            window = from_bounds(*bounds, src.transform).round_offsets().round_lengths()
            window = window.intersection(Window(0, 0, src.width, src.height))
            temporary = path.with_suffix('.part')
            with rasterio.open(temporary, 'w', driver='GTiff', count=1, dtype=src.dtypes[0],
                               height=int(window.height), width=int(window.width), crs=src.crs,
                               transform=src.window_transform(window), nodata=src.nodata,
                               compress='deflate') as dst:
                dst.write(src.read(1, window=window), 1)
            temporary.replace(path)


def heat():
    params = urllib.parse.urlencode(dict(collections='landsat-c2-l2', bbox=','.join(map(str, BOUNDS)),
        datetime='2026-07-01T00:00:00Z/2026-08-31T23:59:59Z', limit=100))
    scenes = get_json(STAC + '?' + params)['features']
    usable = [item for item in scenes if shape(item['geometry']).covers(box(*BOUNDS))
              and all(key in item['assets'] for key in ('lwir11', 'qa_pixel', 'qa_radsat'))]
    item = min(usable, key=lambda scene: (scene['properties'].get('eo:cloud_cover', 100), scene['id']))
    def fetch(key):
        href = item['assets'][key]['href']
        path = CACHE / (item['id'] + '_' + key + '.tif')
        if not path.exists():
            signed = get_json(SIGN + urllib.parse.urlencode({'href': href}))['href']
            clip(signed, path)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch, ('lwir11', 'qa_pixel', 'qa_radsat')))
    return item



def export_2025(kind, endpoint, year_field, dataset):
    catalog = get_json(endpoint + '/query?' + urllib.parse.urlencode(dict(
        f='json', where=f'{year_field}=2025', outFields='*', returnGeometry='false')))
    rows = [entry['attributes'] for entry in catalog.get('features', [])]
    matches = [row for row in rows if (row.get('Name') or row.get('name')) == dataset]
    if len(matches) != 1:
        raise RuntimeError(f'Could not resolve the 2025 {kind} raster')
    object_id = matches[0].get('OBJECTID') or matches[0].get('objectid')
    x0,y0,x1,y1 = transform_bounds('EPSG:4326', 'EPSG:5070', *BOUNDS)
    from math import floor, ceil
    x0,y0,x1,y1 = floor(x0/30)*30,floor(y0/30)*30,ceil(x1/30)*30,ceil(y1/30)*30
    params = dict(f='image', format='tiff', bbox=f'{x0},{y0},{x1},{y1}', bboxSR=5070, imageSR=5070,
                  pixelType='U8', interpolation='RSP_NearestNeighbor', noData=255,
                  size=f'{(x1-x0)//30},{(y1-y0)//30}',
                  mosaicRule=json.dumps(dict(mosaicMethod='esriMosaicLockRaster', lockRasterIds=[object_id])),
                  renderingRule=json.dumps(dict(rasterFunction='None')))
    path = download(endpoint + '/exportImage?' + urllib.parse.urlencode(params), CACHE / f'local-{kind}-2025.tif')
    with rasterio.open(path) as src:
        import numpy as np
        values = src.read(1)
        if src.count != 1 or src.crs.to_epsg() != 5070 or src.res != (30,30) or len(np.unique(values)) < 3:
            raise RuntimeError(f'Unexpected numeric {kind} raster')
        if kind == 'land' and not {21,22,23,24,82}.issubset(set(np.unique(values))):
            raise RuntimeError('Unexpected land-cover class values')
        if kind == 'canopy' and not np.any((values > 0) & (values <= 100)):
            raise RuntimeError('Canopy estimates unavailable')
    return {'file': path.name, 'year': 2025, 'dataset': dataset}


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        thermal = pool.submit(heat)
        land = pool.submit(export_2025, 'land', 'https://di-nlcd.img.arcgis.com/arcgis/rest/services/USA_NLCD_Annual_LandCover/ImageServer',
                           'Year', 'Annual_NLCD_LndCov_2025_CU_C1V2')
        canopy = pool.submit(export_2025, 'canopy', 'https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer',
                             'beginyear', 'nlcd_tcc_conus_wgs84_v2025_6_20250101_20251231')
        manifest = {'heat_scene': thermal.result(), 'land': land.result(), 'canopy': canopy.result()}
        MANIFEST.write_text(json.dumps(manifest))
        print(manifest['heat_scene']['id'], manifest['land'], manifest['canopy'])
