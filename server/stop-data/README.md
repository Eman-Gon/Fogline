# Supplementary Muni stop details

`muni-stops.json` is a compact projection of the unchanged CSV in
`docs/muni-stops/muni-stops.csv`, downloaded October 4, 2026 from
https://data.sf.gov/api/v3/views/i28k-bkz6/export.csv?accessType=DOWNLOAD.
Source records are dated April 8, 2026.

Scheduling IDs in this snapshot are offset from public GTFS IDs by 10000.
The adapter treats this only as a candidate match and requires coordinates
within 25 metres. It does not replace GTFS coordinates, accessibility,
route membership, stop order, or pickup/dropoff restrictions.
Blank shelter fields remain unknown. Unmatched stops remain selectable.
