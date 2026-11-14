"""Real Census screening areas; no inferred plantability or invented heat data."""
import argparse, datetime, hashlib, json, os, pathlib, urllib.parse, urllib.request
from shapely.geometry import shape, mapping, MultiPolygon
from shapely import make_valid
from shapely.ops import transform
from pyproj import Transformer

BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer'
ACS = 'https://api.census.gov/data/2024/acs/acs5'
ROOT = pathlib.Path(os.environ.get('HEATSHIELD_DATA_DIR', 'data'))
COUNTIES = {'001':'Alameda','013':'Contra Costa','041':'Marin','055':'Napa','075':'San Francisco','081':'San Mateo','085':'Santa Clara','095':'Solano','097':'Sonoma'}
PROJECT = Transformer.from_crs(4326, 26910, always_xy=True).transform

def request(url, params):
    full = url + '?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(full, timeout=90) as r:
        if 'missing_key' in r.geturl():
            raise RuntimeError('Census requires CENSUS_API_KEY; request one at https://api.census.gov/data/key_signup.html')
        raw = r.read()
    result = json.loads(raw)
    if isinstance(result, dict) and 'error' in result:
        raise RuntimeError(str(result['error']))
    cache = ROOT / 'raw'; cache.mkdir(parents=True, exist_ok=True)
    (cache / (hashlib.sha256(full.encode()).hexdigest() + '.json')).write_bytes(raw)
    return result

def query(layer, **params):
    ids = request(f'{BASE}/{layer}/query', dict(f='json', returnIdsOnly='true', **params)).get('objectIds', []) or []
    features = []
    for start in range(0, len(ids), 100):
        result = request(f'{BASE}/{layer}/query', dict(f='geojson', outFields='*', outSR=4326,
                         objectIds=','.join(map(str, ids[start:start+100]))))
        features.extend(result['features'])
    if len(features) != len(ids):
        raise RuntimeError('Incomplete Census geometry download')
    return features

def polygon(geom):
    geom = make_valid(geom)
    if geom.geom_type == 'Polygon': return MultiPolygon([geom])
    if geom.geom_type == 'MultiPolygon': return geom
    parts = [p for p in getattr(geom, 'geoms', []) if p.geom_type == 'Polygon']
    return MultiPolygon(parts)

def validate(bundle):
    assert len(bundle['studies']) == 11, 'Nine counties and both communities are required'
    assert {s['name'] for s in bundle['studies']} == {'Tracy', 'Mountain House'} | {n + ' County' for n in COUNTIES.values()}
    for kind in ('studies', 'areas'):
        assert bundle[kind], f'No {kind}'
        assert len({r['id'] for r in bundle[kind]}) == len(bundle[kind])
        for row in bundle[kind]:
            geom = shape(row['geometry'])
            assert geom.is_valid and not geom.is_empty
            x1,y1,x2,y2 = geom.bounds
            assert -124 < x1 <= x2 < -120 and 36 < y1 <= y2 < 40
    parents = {s['id']: shape(s['geometry']).buffer(1e-9) for s in bundle['studies']}
    for row in bundle['areas']:
        assert parents[row['study_id']].covers(shape(row['geometry']))
        assert row['score'] is None or 0 <= row['score'] <= 100
    assert all(any(a['study_id'] == s['id'] for a in bundle['areas']) for s in bundle['studies'])

def build():
    studies = []
    for layer in (28,30):
        for f in query(layer, where="STATE='06' AND (NAME LIKE 'Tracy%' OR NAME LIKE 'Mountain House%')"):
            name = 'Mountain House' if f['properties']['NAME'].startswith('Mountain House') else 'Tracy'
            studies.append(dict(id=f['properties']['GEOID'], name=name, geometry=mapping(polygon(shape(f['geometry'])))))
    if len(studies) != 2: raise RuntimeError(f'Expected two Census places, received {len(studies)}')
    for county, name in COUNTIES.items():
        records = query(82, where=f"STATE='06' AND COUNTY='{county}'")
        if len(records) != 1: raise RuntimeError(f'Missing county {name}')
        studies.append(dict(id='06'+county, name=name+' County', county=county, geometry=mapping(polygon(shape(records[0]['geometry'])))))
    warnings = []
    demographics = {}
    try:
        params = {'get':'NAME,B17001_001E,B17001_002E,B17001_001M,B17001_002M', 'for':'tract:*','in':'state:06 county:' + ','.join([*COUNTIES, '077'])}
        if os.environ.get('CENSUS_API_KEY'): params['key'] = os.environ['CENSUS_API_KEY']
        rows = request(ACS, params)
        for values in rows[1:]:
            r = dict(zip(rows[0], values)); demographics[r['state']+r['county']+r['tract']] = r
    except Exception as exc:
        warnings.append('ACS unavailable; scores remain null. Set CENSUS_API_KEY and rerun build. Failure: ' + type(exc).__name__)
    areas = []
    for study in studies:
        boundary = shape(study['geometry'])
        for f in query(8, where=f"STATE='06' AND COUNTY='{study.get('county', '077')}'", geometry=','.join(map(str,boundary.bounds)), geometryType='esriGeometryEnvelope', inSR=4326, spatialRel='esriSpatialRelIntersects'):
            geom = polygon(polygon(shape(f['geometry'])).intersection(boundary))
            if geom.is_empty or transform(PROJECT,geom).area < 100: continue
            geoid = f['properties']['GEOID']; d = demographics.get(geoid,{})
            def number(key):
                try: v = float(d[key]); return v if v >= 0 else None
                except (KeyError,TypeError,ValueError): return None
            total, poor = number('B17001_001E'), number('B17001_002E')
            score = round(100*poor/total,2) if total and poor is not None and poor <= total else None
            areas.append(dict(id=study['id']+':'+geoid, study_id=study['id'], geoid=geoid, geometry=mapping(geom), score=score, poverty_universe=total, poverty_estimate=poor, universe_moe=number('B17001_001M'), poverty_moe=number('B17001_002M'), area_m2=round(transform(PROJECT,geom).area,2)))
    bundle = dict(retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), crs='EPSG:4326', analysis_crs='EPSG:26910', studies=studies, areas=areas, warnings=warnings)
    bundle['sources'] = json.loads((pathlib.Path(__file__).resolve().parents[1] / 'data/sources.json').read_text())['sources']
    validate(bundle)
    out = ROOT/'output'; out.mkdir(parents=True,exist_ok=True)
    temp = out/'bundle.tmp'; temp.write_text(json.dumps(bundle)); temp.replace(out/'bundle.json')
    (out/'candidates.geojson').write_text(json.dumps(dict(type='FeatureCollection',features=[dict(type='Feature',geometry=a['geometry'],properties={k:v for k,v in a.items() if k!='geometry'}) for a in areas])))
    print(json.dumps(dict(studies=len(studies),candidates=len(areas),scored=sum(a['score'] is not None for a in areas),warnings=warnings)))

def load(bundle):
    import psycopg
    url = os.environ.get('DATABASE_URL')
    if not url: raise RuntimeError('Set DATABASE_URL to a privileged PostgreSQL connection; no data was loaded')
    validate(bundle)
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("create temporary table heatshield_load_stage (kind text not null, payload jsonb not null) on commit drop")
            with cur.copy('copy heatshield_load_stage (kind, payload) from stdin') as copy:
                for source in bundle['sources']:
                    record = dict(source, loaded_retrieval_at=bundle.get('environment_retrieved_at',bundle['retrieved_at']))
                    copy.write_row(('source', json.dumps(record)))
                for study in bundle['studies']:
                    copy.write_row(('study', json.dumps(study)))
                for area in bundle['areas']:
                    copy.write_row(('area', json.dumps(area)))
            cur.execute('select public.load_heatshield_staged()')
    print('Committed complete bundle')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('command',choices=['build','validate','load','load-environment','validate-environment']); args=parser.parse_args()
    if args.command == 'build': build()
    else:
        filename = 'environment_bundle.json' if args.command.endswith('-environment') else 'bundle.json'
        bundle=json.loads((ROOT/'output'/filename).read_text()); validate(bundle)
        if args.command.endswith('-environment'):
            from environment import validate_environment
            validate_environment(bundle)
        if args.command in ('load','load-environment'): load(bundle)
        else: print('Spatial and score validation passed')
