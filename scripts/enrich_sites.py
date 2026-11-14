"""Join city heat and canopy polygons to the pilot points via ArcGIS queries."""
import csv
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://geo.sanjoseca.gov/server/rest/services/"
LAYERS = (("DOT/DOT_TreeServices/MapServer/33", "CANOPYCOVERAGEPERCENT"),
          ("REF/REF_EnergyLayers/MapServer/1", "URBANHEATISLANDEFFECT"))


def lookup(row):
    values = []
    for layer, field in LAYERS:
        params = dict(f="json", geometry=f"{row['longitude']},{row['latitude']}",
                      geometryType="esriGeometryPoint", inSR="4326",
                      spatialRel="esriSpatialRelIntersects", outFields=field,
                      returnGeometry="false")
        with urlopen(BASE + layer + "/query?" + urlencode(params), timeout=30) as response:
            result = json.load(response)
        if "error" in result:
            raise RuntimeError(f"{layer}: {result['error']}")
        features = result["features"]
        values.append(features[0]["attributes"].get(field) if features else None)
    return row["external_id"], *values


def main():
    with (ROOT / "data/san_jose_vacant_sites.csv").open() as file:
        rows = list(csv.DictReader(file))
    with ThreadPoolExecutor(max_workers=8) as pool:
        enriched = list(pool.map(lookup, rows))
    if len(enriched) != 80 or any(canopy is None or heat is None for _, canopy, heat in enriched):
        raise RuntimeError("Incomplete GIS join; refusing to create migration")
    values = ",\n  ".join(f"('{site}', {canopy:.6f}, {heat:.6f})" for site, canopy, heat in enriched)
    (ROOT / "supabase/migrations/20261113000002_site_scores.sql").write_text(
        "-- Canopy gap = 100 minus 2020 canopy coverage percent. Heat score scales modeled UHI 0–10 °F to 0–100.\n"
        "-- Priority uses 40:35 weights renormalized until vulnerability data is supplied.\n"
        "insert into public.data_sources (name, url, publisher, accessed_on) values\n"
        "('San Jose tree canopy census block 2020', 'https://geo.sanjoseca.gov/server/rest/services/DOT/DOT_TreeServices/MapServer/33', 'City of San Jose', '2026-11-13'),\n"
        "('San Jose urban heat island effect', 'https://geo.sanjoseca.gov/server/rest/services/REF/REF_EnergyLayers/MapServer/1', 'City of San Jose / Climate Central', '2026-11-13');\n"
        "update public.candidate_sites c set\n"
        "canopy_coverage_percent = round(v.canopy::numeric, 2),\n"
        "urban_heat_effect_f = round(v.heat::numeric, 3),\n"
        "canopy_gap_score = round(100 - v.canopy::numeric, 2),\n"
        "heat_score = round(least(100, greatest(0, v.heat::numeric * 10)), 2),\n"
        "canopy_source_id = (select id from public.data_sources where name = 'San Jose tree canopy census block 2020' order by id desc limit 1),\n"
        "heat_source_id = (select id from public.data_sources where name = 'San Jose urban heat island effect' order by id desc limit 1)\n"
        "from (values\n  " + values + "\n) as v(external_id, canopy, heat) where c.external_id = v.external_id;\n"
    )
    print(f"Joined heat and canopy for {len(enriched)} sites")


if __name__ == "__main__":
    main()
