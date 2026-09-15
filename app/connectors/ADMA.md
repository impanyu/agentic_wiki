# ADMA connector

Fixed origin: https://adma.aisoup.net. The public API documentation at https://adma.aisoup.net/documentation/#api-endpoints documents `Authorization: Token <token>` (not Bearer or OAuth). The deployed files/folders endpoints were checked and return HTTP 401 with `WWW-Authenticate: Token` without credentials.

Users enter their existing ADMA token in Connectors → ADMA. Creation verifies it using GET `/api/v1/folders/`, then stores it in the per-user encrypted connector vault. No passwords are accepted or stored. The ADMA documentation describes obtaining tokens through POST `/api/v1/auth/token/` or its administrator `create_api_token` command; this connector does not generate or rotate credentials.

Tools:
- `list_files`: GET `/api/v1/files/`, optional `folder_id`, `is_public`, `file_type`.
- `list_folders`: GET `/api/v1/folders/`, optional `parent_id`, `is_public`.
- `folder_info`: GET `/api/v1/folders/{id}/info/`.
- `read_text_file`: GET `/api/v1/files/{id}/download/`. Only text/JSON/XML-compatible response types are supported; 1 MiB transport limit. Binary images, PDFs and ZIPs are not decoded as text.
- `upload_text_file`: multipart POST `/api/v1/files/upload/`, one UTF-8 `files` part plus optional `folder_id` and explicit `is_public` (defaults false). Maximum content 48,000 characters, with the shared connector request-size limit also enforced. This creates a file; it does not update an existing file.

Uploads are write tools and use the existing operation approval flow. Shared/read-only page rules and per-user connector switches apply. Session-authenticated browser endpoints such as `/api/item/delete/` are deliberately not treated as token REST endpoints. Complete authenticated read/upload verification requires an ADMA account token; no customer data was uploaded during implementation.
