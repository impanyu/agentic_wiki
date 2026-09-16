# Native file/data apps

`/tools` is the shared app catalog. `app=table|json|text|image|pdf|archive` selects a tool; `/maps` is the ArcGIS Geo Viewer. The generator can produce `kind=native` with `nativeApp=map|table|json|text|image|pdf|archive|hub`. Searchable registered templates are `geo-v1` and `data-tools-v1`; these use no generated program or sandbox.

Links carry optional `page`, `file`, `connector`, `name`, `language` references, never credentials. Page files are reauthorized through existing list and download endpoints. ADMA text reads use the current visitor's enabled connector and its allowed tools. A copied link grants no additional access. The hub retains source references when linking to a selected tool. Choosing another source updates subsequent links. Local files have no durable reference; download/reopen them in another tool. Links reopen the original source, not unsaved edits.

All editing/export runs in the browser. Nothing overwrites or uploads to the source. Downloads are explicit. File limit 10 MiB (ADMA text reader 1 MiB), tables 10,000 rows/100 columns, XLSX first worksheet only, ZIP 1,000 entries/40 MiB expanded/10 MiB per entry with path and CRC checks. Formula-like CSV exports are escaped. Image exports flatten animations; PDF is the browser's native viewer. No script/HTML execution or Markdown HTML rendering.

Geo Viewer uses official ArcGIS SDK 5.1 and OpenStreetMap, no new key. Supports WGS84 GeoJSON, coordinate CSV/TSV, basic KML/GPX, public FeatureServer/MapServer/WMS/WMTS URLs (subject to browser CORS). Uploaded features stay in the tab. Basemap and public service requests go to their providers. No shapefile/GeoTIFF reprojection, authenticated ArcGIS services, saved layer configuration or automatic cloud writeback yet.

ADMA third-party public roots come from its explicit public dashboard catalog because its token API omits third-party flags. Folder contents still use ADMA's authorized API. Private third-party roots cannot be classified separately until ADMA exposes that metadata in its API. Private items remain in ordinary account Data.
