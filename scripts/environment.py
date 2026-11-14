"""Numeric raster enrichment. Cached source files are ignored by git."""
import datetime, hashlib, json, os, pathlib, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import rasterio
from rasterio.features import geometry_mask, shapes
from rasterio.mask import mask
from rasterio.warp import transform_geom
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, transform
from shapely.strtree import STRtree
from pyproj import Transformer
from pipeline import ROOT, polygon, validate

WCS = 'https://www.mrlc.gov/geoserver/mrlc_download/wcs'
STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
CACHE = ROOT / 'raw/environment'
COVERAGES = {'canopy': 'mrlc_download__nlcd_tcc_conus_2021_v2021-4', 'landcover': 'mrlc_download__NLCD_2021_Land_Cover_L48'}

def get_json(url):
    with urllib.request.urlopen(url, timeout=90) as r: return json.load(r)

def download(url, path):
    if path.exists(): return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.part')
    with urllib.request.urlopen(url, timeout=180) as r, temp.open('wb') as f:
        while True:
            chunk = r.read(1024*1024)
            if not chunk: break
            f.write(chunk)
    with rasterio.open(temp) as src:
        if not src.crs: raise ValueError('Raster missing CRS')
    temp.replace(path)
    return path

def coverage(study, kind):
    geom = transform_geom('EPSG:4326', 'EPSG:5070', study['geometry'])
    x0,y0,x1,y1 = shape(geom).bounds
    params = [('service','WCS'),('version','2.0.1'),('request','GetCoverage'),
              ('coverageId',COVERAGES[kind]),('subset',f'X({x0-30},{x1+30})'),
              ('subset',f'Y({y0-30},{y1+30})'),('format','image/geotiff')]
    url = WCS+'?'+urllib.parse.urlencode(params)
    return download(url, CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.tif'))

def scene(study):
    url = STAC+'?'+urllib.parse.urlencode(dict(collections='landsat-c2-l2',bbox=','.join(map(str,shape(study['geometry']).bounds)),datetime='2024-07-01T00:00:00Z/2024-08-31T23:59:59Z',limit=100))
    items = get_json(url)
    features=items['features']
    while next((x for x in items.get('links',[]) if x['rel']=='next'),None):
        link=next(x for x in items['links'] if x['rel']=='next');items=get_json(link['href']);features+=items['features']
    features=[f for f in features if 'lwir11' in f['assets'] and f['properties'].get('platform') in ('landsat-8','landsat-9')]
    if not features: raise RuntimeError('No summer 2024 Landsat 8/9 surface-temperature scene')
    # Deterministic snapshot. Partial coverage stays explicit, never extrapolated.
    boundary=shape(study['geometry'])
    item=min(features,key=lambda f:(-shape(f['geometry']).intersection(boundary).area*(1-f['properties'].get('eo:cloud_cover',100)/100),f['id']))
    paths={}
    for band in ('lwir11','qa_pixel','qa_radsat'):
        href=item['assets'][band]['href'];path=CACHE/(item['id']+'_'+band+'.tif')
        if not path.exists():
            signed=get_json('https://planetarycomputer.microsoft.com/api/sas/v1/sign?'+urllib.parse.urlencode({'href':href}))['href']
            download(signed,path)
        paths[band]=path
    (CACHE/(item['id']+'.json')).write_text(json.dumps(item))
    return item, paths

def raster_values(path, geom):
    with rasterio.open(path) as src:
        projected=transform_geom('EPSG:4326',src.crs,geom)
        try: data, affine=mask(src,[projected],crop=True,filled=False)
        except ValueError: return None
        inside=geometry_mask([projected],out_shape=data.shape[1:],transform=affine,invert=True)
        return data[0],inside,affine,src.crs

def stats(path,geom,low,high):
    result=raster_values(path,geom)
    if result is None: return None,0
    data,inside,_,_=result
    # MRLC WCS incorrectly advertises nodata=0; published canopy metadata uses 254/255.
    valid=inside & (data.data>=low)&(data.data<=high)
    fraction=float(valid.sum()/max(inside.sum(),1))
    return (float(data.data[valid].mean()) if valid.any() else None), fraction

def heat(paths,geom):
    result=raster_values(paths['lwir11'],geom)
    if result is None:return None,0
    data,inside,affine,crs=result
    # QA products are co-registered with the temperature raster.
    qa=raster_values(paths['qa_pixel'],geom);sat=raster_values(paths['qa_radsat'],geom)
    if qa is None or sat is None:return None,0
    if qa[2]!=affine or sat[2]!=affine: raise ValueError('Landsat QA grid mismatch')
    valid=inside & ~np.ma.getmaskarray(data) & (data.data>0) & ((qa[0].data.astype('uint16') & 191)==0) & (sat[0].data==0)
    values=data.data.astype('float64')*0.00341802+149-273.15
    valid &= (values>=-50)&(values<=90)
    # Account for scene truncation using physical polygon area, not cropped window size.
    area=shape(transform_geom('EPSG:4326',crs,geom)).area
    fraction=min(1,float(valid.sum()*abs(affine.a*affine.e)/area))
    return (float(values[valid].mean()) if valid.any() else None),fraction

def exclusion(path,geom):
    result=raster_values(path,geom)
    if result is None:return None,0
    data,inside,affine,crs=result
    valid=inside & ~np.ma.getmaskarray(data) & np.isin(data.data,[11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95])
    excluded=valid & np.isin(data.data,[11,90,95])
    pieces=[shape(g) for g,v in shapes(excluded.astype('uint8'),mask=excluded,transform=affine) if v==1]
    if not pieces:return polygon(shape(geom)),float(valid.sum()/max(inside.sum(),1))
    mask_geom=transform_geom(crs,'EPSG:4326',mapping(unary_union(pieces)))
    return polygon(shape(geom).difference(shape(mask_geom))),float(valid.sum()/max(inside.sum(),1))

CPAD = 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/ArcGIS/rest/services/CPAD_Holdings_wm/FeatureServer/0'

def vectors(url,study):
    if not url:return None
    key=hashlib.sha256((url+json.dumps(study['geometry'],sort_keys=True)).encode()).hexdigest()
    path=CACHE/(key+'.json')
    if path.exists():features=json.loads(path.read_text())
    else:
        params=dict(f='json',where='1=1',geometry=','.join(map(str,shape(study['geometry']).bounds)),geometryType='esriGeometryEnvelope',inSR=4326,spatialRel='esriSpatialRelIntersects',returnIdsOnly='true')
        response=get_json(url+'/query?'+urllib.parse.urlencode(params))
        if 'error' in response or 'objectIds' not in response:raise RuntimeError('Vector ID query failed')
        ids=response['objectIds'] or [];features=[]
        def fetch_batch(offset):
            batch_path=CACHE/(key+'_'+str(offset)+'.json')
            if batch_path.exists():return json.loads(batch_path.read_text())
            payload=urllib.parse.urlencode(dict(f='geojson',objectIds=','.join(map(str,ids[offset:offset+1000])),outFields='OBJECTID',outSR=4326)).encode()
            with urllib.request.urlopen(url+'/query',data=payload,timeout=120) as r:batch=json.load(r)
            if 'features' not in batch:raise RuntimeError('Vector geometry query failed')
            if len(batch['features'])!=len(ids[offset:offset+1000]):raise RuntimeError('Truncated vector batch')
            batch_path.parent.mkdir(parents=True,exist_ok=True);batch_path.write_text(json.dumps(batch['features']))
            return batch['features']
        with ThreadPoolExecutor(max_workers=6) as pool:
            for batch in pool.map(fetch_batch,range(0,len(ids),1000)):features.extend(batch)
        if len(features)!=len(ids):raise RuntimeError('Truncated vector download')
        path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(features))
    geoms=[polygon(shape(f['geometry'])) for f in features if f.get('geometry')]
    if len(geoms)!=len(features):raise RuntimeError('Missing vector geometry')
    return geoms,STRtree(geoms)

def overlap(layer,geom):
    geoms,tree=layer
    indices=tree.query(geom,predicate='intersects')
    return unary_union([geoms[int(i)].intersection(geom) for i in indices])

def validate_environment(bundle,require_complete=True):
    for area in bundle['areas']:
        env=area.get('environment')
        if env is None:
            if require_complete:raise ValueError('Run enrichment for all studies before loading')
            continue
        for key in ('canopy_valid_fraction','heat_valid_fraction','landcover_valid_fraction'):
            if not 0<=env[key]<=1:raise ValueError('Invalid valid-data fraction')
        if env['canopy_percent'] is not None and not 0<=env['canopy_percent']<=100:raise ValueError('Invalid canopy')
        if env['surface_temperature_c'] is not None and not -50<=env['surface_temperature_c']<=90:raise ValueError('Invalid temperature')
        if area.get('screening_geometry') is not None:
            g=shape(area['screening_geometry'])
            if not g.is_valid or not shape(area['geometry']).buffer(1e-9).covers(g):raise ValueError('Invalid screening mask')


def enrich(bundle,only=None):
    report=[]
    for study in bundle['studies']:
        if only and study['name']!=only:continue
        print('Enriching '+study['name'],flush=True)
        resources={};errors={}
        layers={}
        for kind,url in [('protected',CPAD),('buildings',os.environ.get('HEATSHIELD_BUILDINGS_LAYER'))]:
            try:layers[kind]=vectors(url,study)
            except Exception as e:layers[kind]=None;errors[kind]=type(e).__name__
        for kind in COVERAGES:
            try:resources[kind]=coverage(study,kind)
            except Exception as e:errors[kind]=type(e).__name__
        try:item,paths=scene(study)
        except Exception as e:item=None;paths=None;errors['heat']=type(e).__name__
        for area in [a for a in bundle['areas'] if a['study_id']==study['id']]:
            env={'canopy_source':'canopy2021','heat_source':'landsat2024summer','landcover_source':'landcover2021','protected_source':'cpad2026a','temperature_units':'degree_Celsius','canopy_source_crs':'EPSG:5070','canopy_percent':None,'surface_temperature_c':None,'canopy_valid_fraction':0,'heat_valid_fraction':0,'landcover_valid_fraction':0,'building_mask':'unavailable','protected_land_review':'unavailable','errors':errors.copy()}
            geom=area['geometry']
            if 'canopy' in resources:
                value,fraction=stats(resources['canopy'],geom,0,100)
                env.update(canopy_percent=round(value,2) if value is not None and fraction>=0.5 else None,canopy_valid_fraction=round(fraction,4),canopy_year=2021)
            if paths:
                value,fraction=heat(paths,geom)
                with rasterio.open(paths['lwir11']) as thermal:env['heat_source_crs']=str(thermal.crs)
                env.update(surface_temperature_c=round(value,2) if value is not None and fraction>=0.5 else None,heat_valid_fraction=round(fraction,4),heat_scene=item['id'],heat_acquired_at=item['properties']['datetime'])
            remaining=None
            if 'landcover' in resources:
                remaining,fraction=exclusion(resources['landcover'],geom)
                env['landcover_valid_fraction']=round(fraction,4)
                if remaining is not None and fraction>=0.95:
                    area['screening_geometry']=mapping(remaining)
                    project=Transformer.from_crs(4326,26910,always_xy=True).transform
                    original=transform(project,shape(geom)).area
                    env['excluded_area_m2']=round(max(0,original-transform(project,remaining).area),2)
                else:area['screening_geometry']=None
            else:area['screening_geometry']=None
            if layers['protected'] is not None:
                env['protected_land_review']='intersects' if not overlap(layers['protected'],shape(geom)).is_empty else 'no_mapped_overlap'
            if layers['buildings'] is not None:
                env['building_mask']='applied'
                if area.get('screening_geometry') is not None:
                    area['screening_geometry']=mapping(polygon(shape(area['screening_geometry']).difference(overlap(layers['buildings'],shape(geom)))))
            area['environment']=env
            # Fixed normalization for a dated snapshot; requires both environmental inputs.
            t,c=env['surface_temperature_c'],env['canopy_percent']
            area['equity_score']=area.get('equity_score',area['score'])
            area['score']=round(0.6*min(100,max(0,(t-20)/30*100))+0.4*(100-c),2) if t is not None and c is not None else None
            if area.get('screening_geometry') is not None and shape(area['screening_geometry']).is_empty:area['score']=None
            area['score_method']='heat-canopy-snapshot-v1'
        report.append(dict(study=study['name'],errors=errors,scene=item['id'] if item else None))
    registry=json.loads((pathlib.Path(__file__).resolve().parents[1]/'data/environment_sources.json').read_text())
    existing={s['id']:s for s in bundle['sources']}
    existing.update({s['id']:s for s in registry})
    bundle['sources']=list(existing.values())
    bundle['environment_report']=report
    bundle['environment_retrieved_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    validate_environment(bundle,require_complete=only is None)
    return bundle

BUILDINGS = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0'

def add_buildings(bundle, only=None):
    project=Transformer.from_crs(4326,26910,always_xy=True).transform
    for study in bundle['studies']:
        if only and study['name'] != only:continue
        print('Building exclusions: '+study['name'],flush=True)
        try:layer=vectors(os.environ.get('HEATSHIELD_BUILDINGS_LAYER',BUILDINGS),study)
        except Exception as exc:
            for a in bundle['areas']:
                if a['study_id']==study['id']:a['environment']['errors']['buildings']=type(exc).__name__
            continue
        for a in bundle['areas']:
            if a['study_id']!=study['id']:continue
            env=a['environment'];env['building_mask']='applied' if a.get('screening_geometry') is not None else 'available_no_base_mask';env['building_source']=os.environ.get('HEATSHIELD_BUILDINGS_LAYER',BUILDINGS)
            env['errors'].pop('buildings',None)
            if a.get('screening_geometry') is not None:
                g=polygon(shape(a['screening_geometry']).difference(overlap(layer,shape(a['geometry']))))
                a['screening_geometry']=mapping(g)
                env['excluded_area_m2']=round(max(0,transform(project,shape(a['geometry'])).area-transform(project,g).area),2)
                if g.is_empty:a['score']=None
    validate_environment(bundle)
    return bundle

WATER = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12'

def add_water(bundle):
    project=Transformer.from_crs(4326,26910,always_xy=True).transform
    for study in bundle['studies']:
        print('Waterbody exclusions: '+study['name'],flush=True)
        try:layer=vectors(WATER,study)
        except Exception as exc:
            for a in bundle['areas']:
                if a['study_id']==study['id']:
                    a['environment']['waterbody_mask']='unavailable'
                    a['environment']['errors']['waterbodies']=type(exc).__name__
            continue
        for a in bundle['areas']:
            if a['study_id']!=study['id']:continue
            env=a['environment'];env['waterbody_mask']='applied' if a.get('screening_geometry') is not None else 'available_no_base_mask';env['waterbody_source']=WATER
            env['errors'].pop('waterbodies',None)
            env.update(canopy_source='canopy2021',heat_source='landsat2024summer',landcover_source='landcover2021',protected_source='cpad2026a',temperature_units='degree_Celsius',canopy_source_crs='EPSG:5070')
            if env.get('heat_scene'):
                with rasterio.open(CACHE/(env['heat_scene']+'_lwir11.tif')) as thermal:env['heat_source_crs']=str(thermal.crs)
            if a.get('screening_geometry') is not None:
                g=polygon(shape(a['screening_geometry']).difference(overlap(layer,shape(a['geometry']))))
                a['screening_geometry']=mapping(g)
                env['excluded_area_m2']=round(max(0,transform(project,shape(a['geometry'])).area-transform(project,g).area),2)
                if g.is_empty:a['score']=None
    validate_environment(bundle)
    return bundle

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--study');parser.add_argument('--buildings-only',action='store_true');parser.add_argument('--water-only',action='store_true');parser.add_argument('--all',action='store_true');args=parser.parse_args()
    filename='environment_bundle.json' if args.buildings_only or args.water_only else 'bundle.json'
    bundle=json.loads((ROOT/'output'/filename).read_text());validate(bundle)
    if args.buildings_only:add_buildings(bundle,args.study)
    elif args.water_only:add_water(bundle)
    else:
        enrich(bundle,args.study)
        if args.all:
            if args.study:raise ValueError('--all requires all studies')
            add_buildings(bundle);add_water(bundle)
    registry=json.loads((pathlib.Path(__file__).resolve().parents[1]/'data/environment_sources.json').read_text())
    existing={s['id']:s for s in bundle['sources']};existing.update({s['id']:s for s in registry});bundle['sources']=list(existing.values())
    validate(bundle)
    path=ROOT/'output/environment_bundle.json';temp=path.with_suffix('.tmp');temp.write_text(json.dumps(bundle));temp.replace(path)
    print(json.dumps(bundle['environment_report']),flush=True)
