# Moving live Sites data to the VM

The source copy deliberately excludes production records, uploaded objects, local `.env` files and provider credentials. Do not point a fresh migration runner at a partially imported database.

1. Schedule a maintenance window and freeze writes to the original site.
2. Export the complete D1 database as SQLite-compatible SQL using the authorized Sites/Cloudflare export mechanism. Export every R2 object with its exact original key and bytes. Keep this export encrypted/private. The source's local `.wrangler` database is not a production export.
3. Create a fresh VM database with `npm run db:migrate`. Import application table data into that schema in foreign-key dependency order, inside a transaction. Exclude provider-specific metadata, `app_migrations`, generation leases and new VM authentication tables. Preserve application IDs, mappings, dependencies, visibility, timestamps and vector JSON. Do not blindly execute exported CREATE TABLE statements over a migrated schema.
4. Import each object using `FileBucket.put(originalKey, bytes)` from `server/files.mjs`; copying raw R2 keys into the hash-addressed object directory will not work. Preserve the `r2://FILES/...` logical references in component payloads. Verify expected counts and attachment reads.
5. Sites account IDs and Google subject IDs are different. Establish an explicit, administrator-verified old-ID → new-ID mapping; never infer ownership from display names. Audit all owner/user/principal fields, chat scopes, agent IDs derived from owners, replacement rows and JSON payloads before migrating ownership. Do not mass-replace strings blindly. Test private-page access with two distinct users before switching traffic.
6. Reconnect Google Drive/Dropbox/OneDrive on the VM. OAuth tokens and authorization state are bound to the original client, user identity and encrypted object path. Preserve the encryption keys only for any records you deliberately migrate; do not assume old connections will transfer automatically.
7. Verify public/private access, search mappings, histories, chat, file downloads, and new generation. Keep the original export and a rollback plan before switching DNS.

A production data/identity transfer is a separate operation from this code refactor. No export or live record mutation has been performed by this repository setup.
