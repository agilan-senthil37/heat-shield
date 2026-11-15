"""Fetch regional Landsat reflectance windows for the approved heat scenes."""
from concurrent.futures import ThreadPoolExecutor
import json
import urllib.parse

from environment import CACHE, get_json
from refresh_local_shade_sources import clip, SIGN, MANIFEST

REGIONAL_BOUNDS = (-123.65, 36.85, -121.1, 38.95)


def fetch(task):
    scene, key, bounds = task
    path = CACHE / f"{scene['id']}_{key}.tif"
    if path.exists():
        return
    href = scene['assets'][key]['href']
    signed = get_json(SIGN + urllib.parse.urlencode({'href': href}))['href']
    clip(signed, path, bounds)


if __name__ == '__main__':
    regional = [json.loads(path.read_text()) for path in sorted(CACHE.glob('LC*.json'))]
    local = json.loads(MANIFEST.read_text())['heat_scene']
    scenes = [(scene, REGIONAL_BOUNDS) for scene in regional] + [(local, REGIONAL_BOUNDS)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(fetch, [(scene, key, bounds) for scene, bounds in scenes for key in ('nir08', 'swir16')]))
    print(f'Cached near-infrared and shortwave infrared bands for {len(scenes)} scenes.')
