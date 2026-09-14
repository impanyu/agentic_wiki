# Cloud storage setup

AgenticWiKi supports Google Drive, Dropbox and OneDrive through per-user OAuth. Configure clients in each provider console and store values only as server secrets. Do not put tokens in pages, component payloads, prompts or source control.

Set a stable `STORAGE_TOKEN_ENCRYPTION_KEY` containing the base64 encoding of 32 random bytes. Existing `GOOGLE_TOKEN_ENCRYPTION_KEY` is an optional fallback. OAuth tokens, pending states and proposed mutations are AES-GCM encrypted in the private filesystem object store and bound to the user/provider path. Do not rotate this key without re-encrypting existing records or reconnecting accounts.

| Provider | Server settings | Exact callback path |
| --- | --- | --- |
| Google Drive | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | /api/storage/google/callback |
| Dropbox | DROPBOX_CLIENT_ID, DROPBOX_CLIENT_SECRET | /api/storage/dropbox/callback |
| OneDrive | ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET | /api/storage/onedrive/callback |

Prefix callbacks with the deployed origin `https://samepage-knowledge-cache.random-walk.chatgpt.site`. Register localhost callbacks separately for development. Configure the OAuth application as a web application and enable the respective storage API. Microsoft accounts require a registration supporting the intended personal/organizational account types. Dropbox app-folder versus full-Dropbox access is chosen in its console.

Google requests drive.metadata.readonly and drive.file: broad metadata browsing, but file contents and changes are limited to files the app is authorized to access. It does not grant unrestricted modification of every Drive file. Existing read-only Google connections use their original endpoint; reconnect through Cloud storage for this new integration. Dropbox requests files.metadata.read/write and files.content.read/write. OneDrive uses delegated Files.ReadWrite plus offline_access.

After configuration, sign in and open Cloud storage on an application page, select a provider and Connect. Each visitor connects their own account. Disconnect deletes AgenticWiKi's local token; revoke the grant in the provider's account settings to revoke authorization there as well.

Tools support paginated listing, bounded text reads (64 KB), folder creation, text-file upload (64 KB), rename, move, copy and trash. Provider-specific limitations still apply: Google workspace-native exports, large/binary uploads, sharing permissions and cross-drive moves are not implemented. OneDrive copy may be asynchronous; a pending response is not a completion claim. Every mutation requires review and explicit Apply. Proposals expire after ten minutes; encrypted expired records currently remain until bucket lifecycle cleanup or operator removal.

The integration has mocked provider and authorization tests. Real OAuth and provider operations must be validated after the credentials are configured; they were not exercised during this deployment.

References: [Google scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Dropbox OAuth](https://developers.dropbox.com/oauth-guide), [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
