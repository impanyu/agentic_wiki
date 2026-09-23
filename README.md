# AgenticWiKi

A question-addressed knowledge browser with wiki pages, persistent chat sessions, generated web apps, uploads, and cloud-storage integrations.

This repository is the standalone VM edition, copied from the Sites project at source commit `159ae2c38497a2a3e5a35ebc5287a9571335d83c`. It runs on **Node.js 24+**, Next.js, SQLite and a private filesystem object store. No Sites account, Cloudflare Worker, D1 service or R2 service is required.

## Run locally

```sh
cp .env.example .env.local
# Edit .env.local. Set OPENAI_API_KEY for generation.
npm ci
npm run dev
```

Open http://localhost:3000. Guest browsing works without Google setup. AI research, generation and sandbox execution require your server-side OpenAI API key. Files, pages, question vectors, conversations and session state persist under `data/` by default. Never commit that directory or your environment file.

For a native production process:

```sh
npm run build
npm start
```

Fast deploys: build on a workstation and ship only the bundle. `scripts/deploy/build-release.sh` builds, packs `.next/standalone` (without `node_modules`) and publishes it as GitHub release `deploy-<sha>`; on the VM `scripts/deploy/install-release.sh <sha>` checks out the commit, downloads the asset, links the VM's own `node_modules`, swaps `.next/standalone` and restarts the service. Downtime is the restart only.

Set `NODE_ENV=production` and `APP_URL=https://your-domain.example` in your service environment. Startup applies versioned migrations before accepting requests. A systemd example is in `deploy/agenticwiki.service`; adjust its Node path and service account for your VM.

## Deploy on a cloud VM with Docker

Use a Linux VM with Docker Engine and the Compose plugin; allow enough memory for the Next.js build (4 GB is a practical starting point).

1. Copy/clone this repository to the VM.
2. Copy `.env.example` to `.env.local`, set `APP_URL=https://wiki.example.com`, `DOMAIN=wiki.example.com`, your API key and OAuth settings. Restrict this file with `chmod 600 .env.local`.
3. Point the domain's DNS to the VM. Open inbound TCP 80/443; keep port 3000 private.
4. Start the app and HTTPS proxy:

```sh
docker compose --env-file .env.local --profile public up -d --build
docker compose logs -f app
```

Caddy provisions HTTPS certificates. Its reverse proxy flushes streamed responses immediately. The app uses a persistent Docker volume for SQLite and objects. Runtime containers run as the unprivileged `node` user. The image excludes local secrets and data; environment values are supplied only at runtime.

For localhost testing without Caddy, set `APP_URL=http://localhost:3000` and run `docker compose up -d --build app`. The app port binds to localhost only.

Do not run `docker compose down -v` unless intentionally deleting persistent data. Updates use the same `up -d --build` command and volume. Back up before schema changes; do not roll back code across incompatible migrations without restoring a matching data backup.

## Google sign-in and cloud storage

The VM edition uses server-managed Google OAuth sessions. It does **not** trust the former `oai-authenticated-*` headers. Sessions use random HttpOnly cookies with hashed tokens in SQLite, PKCE, single-use browser-bound state and a 30-day expiry. Sign-in requests only `openid email profile`; Drive authorization remains a separate user action.

Create/configure a Google OAuth **Web application** client and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Register these exact callback URLs for your domain:

- `https://wiki.example.com/auth/google/callback` — sign-in
- `https://wiki.example.com/api/storage/google/callback` — current Drive connector
- `https://wiki.example.com/api/connections/google-drive/callback` — retained legacy Drive connector

For local development register the corresponding `http://localhost:3000/...` callbacks. Configure Google's consent screen and permitted test users or public verification as appropriate. Full Drive access requires its own scopes and Google review; website deployment does not grant that access.

Generate a stable encryption key for saved storage tokens:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set `STORAGE_TOKEN_ENCRYPTION_KEY`; also set `GOOGLE_TOKEN_ENCRYPTION_KEY` for the legacy connector. Keep keys in the server environment and back them up securely. Losing them prevents decryption of saved connections. Dropbox and OneDrive use the corresponding environment values and `/api/storage/dropbox/callback` and `/api/storage/onedrive/callback` URLs.

Generic API credentials remain server secrets referenced by components; the operator-controlled execution policy defaults to denying external endpoints. See `app/components-registry/API-EXECUTION.md`.

## Architecture

- **Next.js Node server:** UI, route handlers and streaming responses; no hosting control-plane dependency.
- **SQLite:** existing schema and SQL preserved through `server/sqlite.mjs`. WAL, foreign keys, busy timeout and atomic batches support the application's locks and mappings. `scripts/migrate.mjs` records checksums and applies all 22 existing migrations in journal order.
- **Private objects:** `server/files.mjs` stores opaque keys as hashed filenames and uses atomic replacement. Application ACL checks still guard downloads. Existing `r2://FILES/...` values remain logical identifiers for compatibility; they no longer imply an R2 network request. No object directory is exposed as static content.
- **Runtime boundary:** `server/runtime.ts` supplies database, files and environment settings. Cloudflare types are retained only as development-time interface compatibility for existing callers and Drizzle; they are not a runtime service.
- **Identity:** Google subject IDs (`google:<sub>`) and database-backed sessions, with guest browsing retained.
- **AI and generated code:** routing and page agents retain their existing behavior. Generated backend programs continue to run in the configured remote OpenAI sandbox; they are not executed directly on the VM. GUI execution still needs optional E2B configuration.

This deployment targets **one VM with local persistent disk and one application instance**. SQLite is not a shared multi-host database. Horizontal scaling requires a separate database/object-storage adapter and durable job processing. In-flight generations may fail during a restart; saved contexts persist.

## Backups and moving existing data

Code copying does not copy the live Sites database, R2 objects, secrets, or accounts. The initial VM database is empty. See [data migration](docs/data-migration.md) before moving live content.

For a consistent Docker backup, stop the app while copying its data volume, then restart it. Back up the entire data directory (SQLite database, WAL files if present, and objects) and separately preserve the environment/encryption keys. For native deployments, stop the systemd service before copying `DATA_DIR`. Restore onto an empty volume with the correct UID/permissions. Keep backups private: they contain private pages, chats, session hashes and encrypted provider tokens.

## Validation

```sh
npm run typecheck
npm run test:vm
node --test tests/question-confidence.test.mjs tests/mapped-page-coverage.test.mjs tests/simple-routing.test.mjs tests/sandbox-lifecycle.test.mjs
npm run build
npm run test:smoke
```

`GET /api/health` checks database readiness without exposing configuration. Google OAuth tests use mocked provider responses; live sign-in requires your configured callback/domain. Docker engine execution must be verified on the deployment host if Docker is unavailable locally.

Reference documentation: [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/reference).
