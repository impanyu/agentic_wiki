# Connect Google Drive to AgenticWiKi

The Codex Google Drive connector belongs to the Codex session. AgenticWiKi is a separate application and needs its own OAuth client and each user's consent. E2B is not needed to list Drive folders.

## Google Cloud setup

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Drive API** in APIs & Services → Library.
3. Configure Google Auth Platform / OAuth consent: app name, support email, audience and developer contact. For initial testing, add the Google accounts that will connect as test users.
4. Add the read-only scope `https://www.googleapis.com/auth/drive.file`. It permits listing folder/file metadata, not reading file contents or writing files. It is a restricted scope: public distribution may require Google verification. Testing-mode refresh tokens for this scope may expire after seven days, requiring reconnection.
5. Create an OAuth client with application type **Web application**.
6. Add this exact authorized redirect URI:

   `https://wiki.aisoup.net/api/connections/google-drive/callback`

   For local development, separately add `http://localhost:5173/api/connections/google-drive/callback`. If the app moves to another cloud/domain, register that domain's callback too; the application uses its current origin.

## Server configuration

Set these in the VM service environment, keeping secrets private:

- `GOOGLE_CLIENT_ID`: the web application's client ID.
- `GOOGLE_CLIENT_SECRET`: its client secret.
- `GOOGLE_TOKEN_ENCRYPTION_KEY`: a stable random 32-byte key encoded as base64. Generate one locally with `openssl rand -base64 32`; store it directly in server secrets, never in chat or a component. Rotating it without re-encrypting records requires users to reconnect.

For local development only, use ignored `.env.local`. Do not upload an OAuth client JSON or token file through the site's data upload feature. No Google credentials have been configured by this implementation.

## Connect and use

Sign in to AgenticWiKi, then enter **list my Google Drive folders** in the address box. The generated page contains a **Connect Google Drive** button once the server is configured. Complete Google's consent screen, return to the page, and refresh folders. Use **Load more** until all pages have loaded. Listing includes non-trashed folders available to the authorized account, including accessible shared folders. **Disconnect** revokes the Google token and removes its stored connection.

## Storage and permissions

OAuth access/refresh tokens live only in encrypted private filesystem objects under `secrets/google-drive/`. AES-GCM binds each ciphertext to its per-user object path. These paths are not exposed by the data download endpoint, which permits only `uploads/` objects. Token values never appear in component definitions, agent context or browser responses.

A private credential component contains only `{provider:"google_drive",connectionRef:"google_drive"}`. The API component links to that reference; the registered backend always resolves the **current caller's** connection. Frontend, backend and API definitions are separate reusable components. Folder results are fetched live for the current caller and are not stored in page content or shared cache entries. The page agent may discuss returned folder metadata in that user's private session memory.

Authorization uses per-user state, a browser-bound HttpOnly state cookie, PKCE, expiry checks and one-time state consumption before code exchange. The scope and Google endpoints are fixed by the registered adapter; an agent cannot broaden them. Token refresh stays server-side.

## Verification status

The connection UI, missing-configuration behavior, token encryption/account binding and folder query construction are tested locally. Live Google consent, token refresh and folder retrieval must be tested after the OAuth client and server secrets are configured. The Google Drive integration is prepared, not already authorized.

Official references: [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list).
