"""Build ranked 300 m urban shade survey zones from the cached source snapshots."""
import argparse
from collections import Counter
import json
import hashlib
from pathlib import Path

import numpy as np
import rasterio
import shapely
from rasterio.features import rasterize, shapes
from rasterio.warp import reproject, transform_geom, Resampling
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer

from environment import BUILDINGS, CACHE, CPAD, WATER, coverage, vectors

CELL = 10  # Ten native 30 m NLCD pixels per side.
CRS = 'EPSG:5070'
project = Transformer.from_crs(4326, CRS, always_xy=True).transform
unproject = Transformer.from_crs(CRS, 4326, always_xy=True).transform


def band(path, shape_, affine, nodata, dtype):
    dest = np.full(shape_, nodata, dtype=dtype)
    with rasterio.open(path) as src:
        reproject(rasterio.band(src, 1) if nodata != 255 else src.read(1), dest,
                  src_crs=src.crs, src_transform=src.transform,
                  src_nodata=nodata, dst_crs=CRS, dst_transform=affine,
                  dst_nodata=nodata, resampling=Resampling.nearest)
    return dest


def tiles(a):
    h, w = a.shape
    return a.reshape(h//CELL, CELL, w//CELL, CELL).transpose(0, 2, 1, 3)


def land_cover_mix(pixels):
    groups = {
        'developed': [22, 23, 24],
        'developed_open': [21],
        'crops': [82],
        'pasture': [81],
        'grass_shrub': [52, 71],
        'barren': [31],
        'forest': [41, 42, 43],
        'water_wetland': [11, 90, 95],
        'ice_snow': [12],
    }
    counts = {name: int(np.isin(pixels, codes).sum()) for name, codes in groups.items()}
    valid = sum(counts.values())
    return {
        'coverage': round(100 * valid / pixels.size) if pixels.size else 0,
        'shares': {name: round(100 * count / valid) for name, count in counts.items() if count} if valid else {},
    }


def process(study, areas, scenes, source_refresh=None):
    region = shape(study['geometry'])
    item = min(scenes, key=lambda f: (-shape(f['geometry']).intersection(region).area *
                                      (1-f['properties'].get('eo:cloud_cover', 100)/100), f['id']))
    if source_refresh and study['name'] in ('Tracy', 'Mountain House'):
        item = source_refresh['heat_scene']
    else:
        source_refresh = None
    with rasterio.open(coverage(study, 'landcover')) as src:
        h, w = src.height//CELL*CELL, src.width//CELL*CELL
        affine = src.transform
        land = src.read(1, window=((0,h),(0,w)))
    dims = land.shape
    land_year, canopy_year = 2021, 2021
    canopy_path = coverage(study, 'canopy')
    if source_refresh:
        if 'land' in source_refresh:
            land = band(CACHE / source_refresh['land']['file'], dims, affine, 255, 'uint8')
            land_year = source_refresh['land']['year']
        if 'canopy' in source_refresh:
            canopy_path = CACHE / source_refresh['canopy']['file']
            canopy_year = source_refresh['canopy']['year']
    canopy = band(canopy_path, dims, affine, 255, 'uint8')
    def thermal(b, nodata):
        return band(CACHE/(item['id']+'_'+b+'.tif'), dims, affine, nodata, 'uint16')
    st, qa, sat = thermal('lwir11', 0), thermal('qa_pixel', 65535), thermal('qa_radsat', 65535)
    temp = st.astype('float32')*0.00341802+149-273.15
    tracts = rasterize(((transform(project, shape(a['geometry'])), i+1) for i,a in enumerate(areas)),
                       out_shape=dims, transform=affine, dtype='int32')
    def excluded(url, setback=0):
        # Stream the large structure inventory into one mask in bounded batches.
        key = hashlib.sha256((url + json.dumps(study['geometry'], sort_keys=True)).encode()).hexdigest()
        cached = CACHE / (key + '.json')
        mask = np.zeros(dims, dtype='uint8')
        if cached.exists():
            features = json.loads(cached.read_text())
            batches = (shapely.from_geojson([json.dumps(f['geometry']) for f in features[i:i + 16000] if f.get('geometry')])
                       for i in range(0, len(features), 16000))
        else:
            geometries, _ = vectors(url, study)
            batches = (geometries[i:i + 16000] for i in range(0, len(geometries), 16000))
        def project_coordinates(points):
            return np.column_stack(project(points[:, 0], points[:, 1]))
        for geometries in batches:
            if not len(geometries):
                continue
            projected = shapely.transform(geometries, project_coordinates)
            footprints = shapely.buffer(projected, setback, quad_segs=4) if setback else projected
            nonempty = footprints[~shapely.is_empty(footprints)]
            if len(nonempty):
                rasterize(nonempty, out=mask, transform=affine, all_touched=True)
        return mask

    protected, water, buildings = excluded(CPAD), excluded(WATER), excluded(BUILDINGS, setback=5)
    nir = thermal('nir08', 0).astype('float32') * 0.0000275 - 0.2
    swir = thermal('swir16', 0).astype('float32') * 0.0000275 - 0.2
    reflectance_valid = (nir >= 0) & (swir >= 0) & (nir <= 1) & (swir <= 1) & (nir + swir > 0)
    ndmi = np.divide(nir - swir, nir + swir, out=np.full(dims, np.nan, dtype='float32'),
                     where=reflectance_valid)
    developed = np.isin(land, [22, 23, 24])
    open_land = np.isin(land, [21, 31, 71]) & ((protected == 0) | (land == 21))
    dry_open = open_land & (water == 0) & (buildings == 0) & (ndmi <= 0)
    valid = dry_open & (canopy <= 15) & (st > 0) & ((qa & 191) == 0) & (sat == 0) & (temp >= 40) & (temp <= 90)
    tally = lambda a: tiles(a).sum(axis=(2, 3))
    urban = tally(developed)
    tract_grid = tiles(tracts)
    same = (tract_grid.min(axis=(2, 3)) == tract_grid.max(axis=(2, 3))) & (tract_grid[:, :, 0, 0] > 0)
    # Keep sites near built-up blocks, or in mapped developed open space such as lawns and parks.
    possible = same & (tally(valid) > 0) & ((urban >= 15) | (tally(valid & (land == 21)) >= 1))
    out = []
    for r, c in np.argwhere(possible):
        y, x = int(r) * CELL, int(c) * CELL
        window = np.s_[y:y + CELL, x:x + CELL]
        matching = valid[window]
        patch_shapes = shapes(matching.astype('uint8'), mask=matching, transform=affine * affine.translation(x, y))
        patch = max((shape(geometry) for geometry, _ in patch_shapes),
                    key=lambda geom: (geom.area, geom.bounds))
        patch_mask = rasterize([patch], out_shape=(CELL, CELL),
                               transform=affine * affine.translation(x, y), dtype='uint8').astype(bool)
        t = round(float(temp[window][patch_mask].mean()), 2)
        cv = round(float(canopy[window][patch_mask].mean()), 2)
        moisture = round(float(ndmi[window][patch_mask].mean()), 3)
        area = areas[tracts[y, x] - 1]
        hscore = min(100, max(0, (t - 20) / 30 * 100))
        score = round(.6 * hscore + .4 * (100 - cv), 2)
        polygon = transform(unproject, patch)
        center = polygon.representative_point()
        rings = [polygon.exterior, *polygon.interiors]
        out.append(dict(id=f"shade:{area['id']}:{r}:{c}", parent=area['id'],
                        latitude=round(center.y, 7), longitude=round(center.x, 7),
                        ring=[[round(lng, 7), round(lat, 7)] for lng, lat in rings[0].coords],
                        holes=[[[round(lng, 7), round(lat, 7)] for lng, lat in ring.coords] for ring in rings[1:]],
                        temperature=t, canopy=cv, score=score, developed=int(urban[r, c]),
                        coverage=100, ndmi=moisture, open_area_m2=round(patch.area),
                        date=item['properties']['datetime'][:10], land_year=land_year, canopy_year=canopy_year))
    # Keep the shortlist geographically useful instead of filling it with one tract.
    counts = Counter()
    selected=[]
    for zone in sorted(out,key=lambda z:(-z['score'],-z['temperature'],z['id'])):
        if counts[zone['parent']] < 3 and len(selected) < 100:
            counts[zone['parent']] += 1
            if study['name'] in ('Tracy', 'Mountain House'):
                _, row, column = zone['id'].rsplit(':', 2)
                y, x = int(row) * CELL, int(column) * CELL
                # Summarize a 900 m square around the zone, excluding the zone itself.
                nearby = np.zeros((3 * CELL, 3 * CELL), dtype=land.dtype)
                y0, x0 = max(0, y - CELL), max(0, x - CELL)
                y1, x1 = min(h, y + 2 * CELL), min(w, x + 2 * CELL)
                dy, dx = y0 - (y - CELL), x0 - (x - CELL)
                nearby[dy:dy + y1 - y0, dx:dx + x1 - x0] = land[y0:y1, x0:x1]
                outside = np.ones(nearby.shape, dtype=bool)
                outside[CELL:2 * CELL, CELL:2 * CELL] = False
                zone['land_context'] = {
                    'within': land_cover_mix(land[y:y + CELL, x:x + CELL]),
                    'surrounding': land_cover_mix(nearby[outside]),
                }
            selected.append(zone)
    return selected


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--bundle',type=Path,default=Path('data/output/bundle.json'))
    parser.add_argument('--output',type=Path,default=Path('data/shade-zones.json'))
    parser.add_argument('--refresh-local', action='store_true')
    parser.add_argument('--current-local-sources', action='store_true')
    args=parser.parse_args()
    bundle=json.loads(args.bundle.read_text())
    scenes=[json.loads(p.read_text()) for p in sorted(CACHE.glob('LC*.json'))]
    refresh = json.loads((CACHE / 'tracy-mountain-house-2026.json').read_text()) if (args.refresh_local or args.current_local_sources) else None
    output = json.loads(args.output.read_text()) if args.refresh_local else {}
    for study in bundle['studies']:
        if args.refresh_local and study['name'] not in ('Tracy', 'Mountain House'):
            continue
        areas=[a for a in bundle['areas'] if a['study_id']==study['id']]
        output[study['name']]=process(study,areas,scenes,refresh)
        print(study['name'],len(output[study['name']]),flush=True)
    args.output.write_text(json.dumps(output,separators=(',',':'))+'\n')


if __name__ == '__main__':
    main()
