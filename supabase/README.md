# HeatShield backend and GIS

The active MVP covers **the nine Bay Area counties plus Tracy and Mountain House** using real 2024 Census place/tract polygons and ACS five-year poverty estimates. It produces clipped neighborhood screening polygons, not individual planting locations. Earlier migrations and scripts contain a legacy San José pilot: they remain for migration compatibility; use `heatshield_candidates` and `scripts/pipeline.py` for this project.

## Run locally

From repository root, Python 3.9+:

```sh
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt
scripts/.venv/bin/python scripts/pipeline.py build
scripts/.venv/bin/python scripts/pipeline.py validate
```

Optional environment variables are shown in `scripts/.env.example`; export them in your shell (the script does not automatically load .env). `CENSUS_API_KEY` is optional unless required by Census. `HEATSHIELD_DATA_DIR` defaults to `data`. Build downloads real data, caches raw responses in ignored `data/raw`, and writes `data/output/bundle.json` and `candidates.geojson`. All nine counties and both original communities are required. ACS failure is reported and leaves scores null. Geometry/source failures stop processing. Validation checks community coverage, unique IDs, polygon validity, regional bounds, containment, and score ranges.

## Database

Apply `supabase/migrations/*.sql` in filename order with Supabase CLI (`supabase link --project-ref YOUR_REF`, then `supabase db push`) or the SQL editor. Never run reset against an existing production database. Set `DATABASE_URL` to a privileged PostgreSQL URL, then:

```sh
scripts/.venv/bin/python scripts/pipeline.py load
```

Load validates first, then commits all eleven study areas in one transaction. Repeating it replaces the selected study areas' derived records atomically. Failed loads roll back. No credentials are committed. Migrations follow ordered, apply-once Supabase conventions; the load operation is rerunnable.

The public PostgREST read endpoint is `/rest/v1/heatshield_candidates?city=eq.Tracy&order=score.desc.nullslast`. Filter `score=gte.20` if appropriate. It returns GeoJSON geometry and source estimates. Repeat with `city=eq.Mountain%20House`. Public roles have read-only RLS access; the loader is unavailable to public API roles. Use a Supabase publishable key for reads and keep database/service credentials server-side.

## Method and limits

Storage/output CRS is EPSG:4326, longitude first. TIGERweb explicitly reprojects output to that CRS. Areas are calculated after explicit projection to EPSG:26910 (UTM zone 10N, meters). Invalid polygons are repaired, clipped to Census place boundaries, and empty/sliver intersections under 100 m² are removed.

Score v1 is `100 × B17001_002E / B17001_001E`: percentage of the poverty universe below poverty, weight 1.0, natural normalization 0–100. Negative Census sentinel values become null. Missing/zero denominators yield null, never zero. Margins of error are retained but no ratio margin is inferred. Counts describe the entire original tract, not the clipped population. This is an equity screening indicator, **not heat exposure or planting feasibility**. No heat or canopy measurements are fabricated. The baseline bundle has no exclusions; the environmental workflow below adds real canopy, surface-temperature estimates, water/wetland masks, building footprints and conservation review flags. Land ownership and site feasibility remain unverified.

Source URLs, usage terms, coverage, and limitations are in `data/sources.json`; run retrieval time is in the output bundle. Large downloads and outputs are ignored. No synthetic sample is supplied.

## Bay Area coverage

County study areas cover Alameda, Contra Costa, Marin, Napa, San Francisco, San Mateo, Santa Clara, Solano, and Sonoma, including unincorporated areas. Tracy and Mountain House remain separate place study areas in San Joaquin County. This follows MTC's nine-county definition: https://mtc.ca.gov/about-mtc/what-mtc. No other San Joaquin communities are included.

Use `/rest/v1/regional_candidates?study_area=eq.Alameda%20County&order=score.desc.nullslast` for county queries. This view uses the neutral `study_area` field; the older `heatshield_candidates.city` field remains compatible but can now contain county names. Apply migration `20261113000005_bay_area.sql` before loading regional bundles. Census queries fetch object IDs first and download batches of 100 to prevent API record limits from silently dropping tracts. The pipeline validates all eleven study areas before any database changes.

County screening polygons can contain water and other unsuitable land. Use the environmental workflow below to enrich this expanded coverage. The ACS key requirement applies only to demographic estimates; environmental enrichment does not require it.

## Environmental enrichment (active implementation)

The baseline `build` command above creates Census polygons. Enrich that bundle with real numeric rasters, conservation flags, and building exclusions:

```sh
scripts/.venv/bin/pip install -r scripts/requirements.txt
scripts/.venv/bin/python scripts/environment.py --all
scripts/.venv/bin/python scripts/pipeline.py validate-environment
scripts/.venv/bin/python scripts/test_environment.py
# Apply all migrations, including 20261114000000_staged_gis_load.sql, then:
scripts/.venv/bin/python scripts/pipeline.py load-environment
```

For a small live-data check use `environment.py --study 'Mountain House'`. That produces a deliberately partial bundle which `load-environment` rejects. Run the full enrichment before loading. The enrichment passes write `data/output/environment_bundle.json` atomically; the original Census bundle remains available. Raw rasters, Landsat STAC metadata, and vector batches are cached under ignored `data/raw/environment/`. Building downloads can be large. A source failure is recorded by study/indicator; missing data stays null and a failed mask is never labeled applied.

The `environmental_candidates` read-only view exposes raw environmental estimates, valid-data fractions, acquisition dates, review flags, score, original tract geometry, and `screening_geometry`. Query by `study_area` as with `regional_candidates`. Use `load-environment` to retain these fields. Baseline `load` intentionally replaces records with baseline-only data.

Canopy uses **2021 NLCD TCC v2021-4**, 30 m, EPSG:5070. Valid values are 0–100; published 254/255 special values are excluded. The MRLC WCS response incorrectly advertises nodata=0; the reader follows the product's published numeric range. Land cover uses the matching **2021 NLCD** release. Water (11) and wetlands (90/95) are conservatively subtracted where land-cover validity is at least 95%. FEMA/ORNL building footprints and USGS NHD waterbody polygons are then subtracted. Remaining polygons are unverified screening areas, not planting permissions. CPAD 2026a holdings add `intersects` / `no_mapped_overlap` review flags, not blanket park exclusions. USGS NHD large-scale waterbody polygons supplement the raster mask. Conservation easements are not integrated; narrow streams and seasonal water may remain unmapped.

Heat uses one **July–August 2024 Landsat 8/9 Collection 2 Level-2 scene per study**, selected by cloud-adjusted overlap. It is a dated surface-temperature estimate, not air temperature, current weather, or a climate average. QA removes fill, cloud/cirrus/shadow, snow, water and radiometric saturation. Kelvin = DN × 0.00341802 + 149; Celsius subtracts 273.15. Original scene CRS and date are preserved in cached metadata. Areas need at least 50% valid coverage independently for heat and canopy; otherwise that input and the environmental score are null.

Environmental score v1 = `0.6 × clamp((surface_temperature_c - 20) / 30 × 100, 0, 100) + 0.4 × (100 - canopy_percent)`. These are explicit prototype weights/thresholds, not calibrated public-health cutoffs. Both inputs are mandatory; missing ones are not reweighted. ACS poverty remains separate. All-excluded areas receive a null score. Different scene dates, land-cover vintages, partial pixel coverage, and tract-level averaging limit comparisons; inspect raw inputs before planning a site visit. Buildings may omit small/new structures, and utilities, rights-of-way, ownership, setbacks, and habitat suitability remain unverified.

Source versions, documentation, access methods, CRS and terms are in `data/environment_sources.json`. API reads use RLS; privileged loading remains transactional. No signed download URLs or credentials are stored in committed metadata.

Resume individual vector passes with `environment.py --buildings-only` or `environment.py --water-only`; each reads the existing environmental bundle and writes it atomically.

Detailed exclusion geometries make the environmental bundle large (hundreds of MB). The loader uses PostgreSQL COPY to a temporary staging table and applies the records in one transaction, avoiding a single giant JSON RPC argument. Run `scripts/.venv/bin/python scripts/report_environment.py` for a validated coverage summary in `data/environment_build_report.json`.
