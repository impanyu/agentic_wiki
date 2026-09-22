# ArcGIS Publisher

Open `/tools?app=arcgis-publisher`. The generator may reuse `kind=native`, `nativeApp=arcgis-publisher`. Source references are visit parameters, never shared page data.

## Setup

Register an ArcGIS Online application for **user authentication**, with redirect URL `https://wiki.aisoup.net/arcgis-oauth-callback.html` (also register a local callback for development). Set `ARCGIS_CLIENT_ID` and optionally `ARCGIS_PORTAL_URL` in the server environment. The app also accepts a client ID in its settings. This is a public OAuth client using the SDK's authorization-code/PKCE flow; do not configure or expose a client secret. The callback follows Esri's jsapi-resources/oauth sample.

Each visitor connects their own ArcGIS account. The account must have `portal:publisher:publishFeatures`. Browser login to ArcGIS alone does not authorize AgenticWiKi. Source reads reuse existing current-user connector/page permissions. No ArcGIS credential is sent to the AgenticWiKi server or put in links/page content.

## Publishing

Choose one local or connected file, review the upload notice, then click Publish. GeoJSON, coordinate CSV/TSV, KML and GPX are normalized to WGS84 GeoJSON. Complete zipped shapefiles can be uploaded directly. For ADMA .shp resources already published in its GeoServer, the app obtains authorized metadata and reads the same public WFS geometry used by the map preview. Unpublished shapefiles require a ZIP. Existing 10 MB and geometry limits apply; raster publishing is not supported.

The app uploads a private source item, publishes a hosted feature layer, polls status (up to three minutes), and saves a private Web Map containing the service's layers. It renders that actual saved map with the authenticated ArcGIS SDK and provides external source/layer/map links. Sharing remains an explicit action in ArcGIS Online. No originals are deleted or overwritten. Hosted storage may consume organization credits.

Partial failures keep item links, and the Publish button cannot submit the same in-memory operation twice. The latest item IDs per ArcGIS account/source page are kept in this browser for recovery after reconnecting; no tokens are stored by this app. A lost response can still leave an unknown server-created item: inspect ArcGIS Content before retrying. This is not a transactional or cross-device job queue. Browser close does not cancel a submitted ArcGIS job.
