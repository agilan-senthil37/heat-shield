"""Fetch a small, reproducible downtown San Jose pilot from the city GIS service."""
import csv
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

URL = "https://geo.sanjoseca.gov/server/rest/services/DOT/DOT_TreeServices/MapServer/5/query"
BOUNDS = "-121.91,37.31,-121.86,37.36"
OUT = Path(__file__).resolve().parents[1] / "data" / "san_jose_vacant_sites.csv"
SEED = Path(__file__).resolve().parents[1] / "supabase" / "migrations" / "20261113000001_pilot_sites.sql"


def fetch(params):
    with urlopen(URL + "?" + urlencode(params), timeout=30) as response:
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(result["error"])
    return result


def main():
    base = dict(where="1=1", geometry=BOUNDS, geometryType="esriGeometryEnvelope",
                inSR="4326", outSR="4326", spatialRel="esriSpatialRelIntersects")
    ids = fetch(dict(base, f="json", returnIdsOnly="true"))["objectIds"]
    ids = sorted(ids)
    if not ids:
        raise RuntimeError("No vacant sites returned")
    # Spread the sample through the returned inventory instead of taking one page.
    sample = [ids[i * (len(ids) - 1) // 79] for i in range(80)]
    features = fetch(dict(base, f="geojson", objectIds=",".join(map(str, sample)),
                          outFields="OBJECTID,ADDRESSNUM,STREETNAME"))["features"]
    rows = []
    for feature in features:
        lon, lat = feature["geometry"]["coordinates"]
        props = feature["properties"]
        address = " ".join(str(props.get(k) or "").strip() for k in ("ADDRESSNUM", "STREETNAME")).strip()
        rows.append((str(props["OBJECTID"]), address, lat, lon))
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(("external_id", "address", "latitude", "longitude"))
        writer.writerows(sorted(rows, key=lambda row: int(row[0])))
    def sql(value):
        return "'" + value.replace("'", "''") + "'"
    values = []
    for external_id, address, lat, lon in sorted(rows, key=lambda row: int(row[0])):
        values.append(f"({sql(external_id)}, {sql(address or 'Vacant site ' + external_id)}, "
                      f"{sql(address)}, {lon}, {lat})")
    SEED.write_text(
        "-- City of San Jose DOT Tree Services, Vacant Site layer 5.\n"
        "insert into public.data_sources (name, url, publisher, accessed_on) values\n"
        "('San Jose vacant planting sites', 'https://geo.sanjoseca.gov/server/rest/services/DOT/DOT_TreeServices/MapServer/5', 'City of San Jose', '2026-11-13');\n"
        "with source as (select id from public.data_sources where name = 'San Jose vacant planting sites' order by id desc limit 1)\n"
        "insert into public.candidate_sites (external_id, name, address, location, site_source_id)\n"
        "select v.external_id, v.name, v.address, extensions.st_setsrid(extensions.st_makepoint(v.longitude, v.latitude), 4326)::extensions.geography, source.id\n"
        "from (values\n  " + ",\n  ".join(values) + "\n) as v(external_id, name, address, longitude, latitude) cross join source\n"
        "on conflict (external_id) do update set name = excluded.name, address = excluded.address, location = excluded.location;\n"
    )
    print(f"Wrote {len(rows)} city vacant sites to {OUT}")


if __name__ == "__main__":
    main()
