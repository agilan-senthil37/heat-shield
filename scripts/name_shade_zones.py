"""Match published shade zones to official Census streets and place boundaries."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import urllib.request

import shapefile
from pyproj import Transformer
from shapely.geometry import Point, Polygon, shape
from shapely.ops import transform
from shapely.strtree import STRtree

BASE = 'https://www2.census.gov/geo/tiger/TIGER2024'
project = Transformer.from_crs(4269, 26910, always_xy=True).transform
CACHE = Path('data/raw/tiger-labels')


def layer(kind, suffix, fips):
    name = f'tl_2024_{fips}_{suffix}.zip'
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.part')
        urllib.request.urlretrieve(f'{BASE}/{kind}/{name}', temporary)
        temporary.replace(path)
    return shapefile.Reader(str(path), encodingErrors='replace')


def places():
    with layer('PLACE', 'place', '06') as source:
        rows = [(row.record['NAME'].strip(), shape(row.shape.__geo_interface__))
                for row in source.iterShapeRecords()]
    return [name for name, _ in rows], STRtree([geom for _, geom in rows])


def roads(county):
    with layer('ROADS', 'roads', county) as source:
        rows = [(row.record['FULLNAME'].strip(), transform(project, shape(row.shape.__geo_interface__)))
                for row in source.iterShapeRecords()
                if row.record['FULLNAME'].strip() and row.record['MTFCC'] in ('S1200', 'S1400') and row.shape.points]
    return [name for name, _ in rows], STRtree([geom for _, geom in rows])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', type=Path, default=Path('data/shade-zones.json'))
    args = parser.parse_args()
    data = json.loads(args.snapshot.read_text())
    counties = sorted({zone['parent'].split(':')[-1][:5] for zones in data.values() for zone in zones})
    with ThreadPoolExecutor(max_workers=6) as pool:
        places_future = pool.submit(places)
        streets = dict(zip(counties, pool.map(roads, counties)))
    place_names, place_index = places_future.result()
    for area, zones in data.items():
        for zone in zones:
            point = Point(zone['longitude'], zone['latitude'])
            matches = place_index.query(point, predicate='covered_by')
            locality = sorted(place_names[i] for i in matches)
            names, tree = streets[zone['parent'].split(':')[-1][:5]]
            center = transform(project, point)
            survey = transform(project, Polygon(zone['ring'], zone.get('holes', [])))
            candidates = tree.query(center, predicate='dwithin', distance=300)
            ranked = sorted(candidates, key=lambda i: (not survey.intersects(tree.geometries[i]), center.distance(tree.geometries[i]), names[i]))
            zone.pop('locality', None)
            zone.pop('street', None)
            if locality:
                zone['locality'] = locality[0]
            if len(ranked):
                zone['street'] = names[ranked[0]]
        print(area, len(zones), zones[0].get('street'), zones[0].get('locality'), flush=True)
    args.snapshot.write_text(json.dumps(data, separators=(',', ':'))+'\n')


if __name__ == '__main__':
    main()
