# Muni stops snapshot

Downloaded October 4, 2026 from DataSF:
https://data.sf.gov/api/v3/views/i28k-bkz6/export.csv?accessType=DOWNLOAD

The CSV is the unchanged source export: 3,260 records with unique STOPID values.
All 3,260 latitude/longitude pairs pass a regional bounds check and are mapped.
The records report data_as_of April 8, 2026 (not the download date).
Shelter values: 991 are 1, one is 0, and 2,268 are blank (unknown).
The CSV contains no route assignments; use a verified GTFS join for route filtering.

Open muni-stops-map.html to search by name or ID and filter shelter values.
Leaflet and OpenStreetMap tiles require an internet connection.
Rebuild with python3 build-map.py. This snapshot does not change Fogline's planner.
