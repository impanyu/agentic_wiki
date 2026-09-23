# ArcGIS Maps

Open `/tools?app=arcgis-publisher`. This native app uses the **ArcGIS Online connector**; it has no independent login or client-ID form. Both the generator and in-page agent discover enabled ArcGIS tools through the same current-user connector directory.

## Setup

Register the public OAuth client for user authentication with callback `https://wiki.aisoup.net/api/connectors/arcgis/callback`. Configure `ARCGIS_CLIENT_ID` and the existing encrypted connector vault. PKCE needs no client secret. Each user selects ArcGIS Online in Connectors and authorizes their own account. Access and refresh tokens are encrypted under that wiki principal's vault path, never put in saved pages or agent tool results. Refresh is locked per user. Disconnect removes the saved session. Authorization states are expiring, one-use and tied to both the signed-in wiki account and an HttpOnly cookie.

## Tools and permissions

`get_account`, `search_items`, `get_item`, `get_layer`, `query_layer`, `publish_file`, `publication_status`, `create_web_map` are independently selectable. All tools are selected on initial connection; turning the connector on selects all tools as with other connectors. Unchecked tools and disabled connections are rejected before execution. Native app pages without saved custom code let visitors publish or create maps with their own connector directly; other read-only pages allow reading only, and users fork them before publishing. ArcGIS enforces the connected account's privileges.

Publishing is split into submission, status checks and map creation so agents can decide their next step without a fixed backend workflow. Source files are read through the current user's authorized resource layer. GeoJSON, coordinate CSV/TSV and complete zipped shapefiles are supported; ADMA shapefiles with published GeoServer geometry can be converted. Files are limited to 10 MB. Source items, hosted layers and new web maps remain private. No tools delete, overwrite or publicly share items. Uncertain publication responses include the source item ID and instructions to inspect rather than repeat the upload.

The GUI uses these same permission-checked connector tools. Local files are first uploaded to Page files. Embedded private maps receive only the current user's access token through a private/no-store endpoint after get_item authorization; tokens never enter agent responses. The GUI clears maps when it observes disconnection or a principal change. A previously issued browser token may remain valid until ArcGIS expires it; disabling a connector blocks new server tool calls immediately.

## Verification

Tests exercise OAuth cross-user rejection and state replay, connector switches/tool checks/read-only enforcement, safe ArcGIS service URLs, and generator/in-page current-user dispatch. Live OAuth and map reads must be checked after registering the server callback. A real hosted publication is a separate external write and is not implied by successful mocked tests.
