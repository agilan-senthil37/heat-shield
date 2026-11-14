# HeatShield GIS pilot

The 80 rows in `san_jose_vacant_sites.csv` are real inventory points from the [City of San José vacant site layer](https://geo.sanjoseca.gov/server/rest/services/DOT/DOT_TreeServices/MapServer/5). The pilot covers approximately 37.31–37.36° N and 121.91–121.86° W. Run `python3 scripts/import_vacant_sites.py` to refresh the CSV and its SQL migration, then `python3 scripts/enrich_sites.py` to refresh scores. Review generated migrations before applying them to a database.

The [2020 canopy census block layer](https://geo.sanjoseca.gov/server/rest/services/DOT/DOT_TreeServices/MapServer/33) supplies canopy coverage. The [urban heat island effect layer](https://geo.sanjoseca.gov/server/rest/services/REF/REF_EnergyLayers/MapServer/1) supplies modeled temperature increase in °F. Canopy gap score is `100 - canopy coverage %`. Heat score is `min(100, max(0, UHI °F × 10))`. The priority score weights heat 40% and canopy gap 35%, divided by 75% while vulnerability is unavailable. Once a vulnerability score is supplied, its weight is 25% and the full formula applies.

These are planning candidates, not planting approvals. Ownership, utilities, sidewalk clearance, species, permits, and maintenance require field review. The source layers describe different time periods and geographic units; their values are area estimates, not measurements at each point.

Apply the migrations in filename order through Supabase CLI or SQL editor. `candidate_site_map` provides map coordinates and scores to clients. Authenticated users can create and manage their own planting projects; candidate sites and sources are read only to public clients.
