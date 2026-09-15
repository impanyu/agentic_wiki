# Cloud storage setup

AgenticWiKi supports Google Drive, Dropbox and OneDrive through per-user OAuth. Configure clients in each provider console and store values only as server secrets. Do not put tokens in pages, component payloads, prompts or source control.

Set a stable `STORAGE_TOKEN_ENCRYPTION_KEY` containing the base64 encoding of 32 random bytes. Existing `GOOGLE_TOKEN_ENCRYPTION_KEY` is an optional fallback. OAuth tokens, pending states and proposed mutations are AES-GCM encrypted in the private filesystem object store and bound to the user/provider path. Do not rotate this key without re-encrypting existing records or reconnecting accounts.

| Provider | Server settings | Exact callback path |
| --- | --- | --- |
| Google Drive | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | /api/storage/google/callback |
| Dropbox | DROPBOX_CLIENT_ID, DROPBOX_CLIENT_SECRET | /api/storage/dropbox/callback |
| OneDrive | ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET | /api/storage/onedrive/callback |

Prefix callbacks with the deployed origin `https://wiki.aisoup.net`. Register localhost callbacks separately for development. Configure the OAuth application as a web application and enable the respective storage API. Microsoft accounts require a registration supporting the intended personal/organizational account types. Dropbox app-folder versus full-Dropbox access is chosen in its console.

Google requests `drive.readonly` and `drive.file`: all Drive files can be listed and read; changes are limited to files selected through Picker or created by this app. Every mutation still requires explicit confirmation. Declare both scopes in Google Auth Platform Data Access. The read-only scope is restricted and public distribution requires the applicable Google verification. Dropbox requests files.metadata.read/write and files.content.read/write. OneDrive uses delegated Files.ReadWrite plus offline_access.

After configuration, sign in and open Cloud storage on an application page, select a provider and Connect. Each visitor connects their own account. Disconnect deletes AgenticWiKi's local token; revoke the grant in the provider's account settings to revoke authorization there as well.

Tools support paginated listing, bounded text reads (64 KB), folder creation, text-file upload (64 KB), rename, move, copy and trash. Provider-specific limitations still apply: Google workspace-native content editing, large/binary uploads, sharing permissions and cross-drive moves are not implemented. OneDrive copy may be asynchronous; a pending response is not a completion claim. Every mutation requires review and explicit Apply. Proposals expire after ten minutes; encrypted expired records currently remain until bucket lifecycle cleanup or operator removal.

The integration has mocked provider and authorization tests. Real OAuth and provider operations must be validated after the credentials are configured; they were not exercised during this deployment.

References: [Google scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Dropbox OAuth](https://developers.dropbox.com/oauth-guide), [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## Google full reading and per-file writing

Both Google OAuth paths request `drive.readonly` and `drive.file`. Users must reconnect after the scope change. Unknown, partial, or broad-write saved grants are not used.

Enable Google Picker API in the same Cloud project as the OAuth client. Set
`GOOGLE_PICKER_API_KEY` on the server to a dedicated browser API key restricted to
Google Picker API and HTTP referrers `https://wiki.aisoup.net/*` and
`https://docs.google.com/*`. The latter is required for Google's Picker iframe.
The key is intentionally delivered to the browser; OAuth client secrets and
refresh tokens remain server-side. `/api/storage/google/picker` requires a
signed-in same-origin POST and returns only the current user's short-lived token
with `Cache-Control: no-store`, respecting connector enablement.

Users choose files at `/drive-picker` (linked from Connectors and Cloud storage).
Picker grants write access to selected files; listing and reading use the full-Drive read-only grant. Picking one file never grants write access to its containing folder or siblings. Created files are also writable. Google Docs/Sheets/Slides are exported as text/CSV for reading.
