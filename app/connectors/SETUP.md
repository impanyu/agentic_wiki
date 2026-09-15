# User connectors

Open **Connectors** beside the address bar. Connections and tool permissions belong to the signed-in user, never to a page. Both generation agents and in-page agents discover enabled tools through `list_connectors`, then invoke `call_connector`. Generated apps use `connectors.list` / `connectors.call` with the visiting user's identity; never embed connector IDs from the author in reusable programs.

Google Drive, Dropbox and OneDrive reuse the existing OAuth setup described in `../storage/SETUP.md`. A connection can remain authorized while switched off. Disabled storage connectors are also blocked in legacy agent and app storage paths.

Custom MCP connectors support public HTTPS Streamable HTTP endpoints, JSON and SSE responses, session initialization, paginated tool discovery, and optional bearer tokens. A server that only supports stdio, legacy SSE or an interactive OAuth-only login is not supported by this form. Supply a compatible remote gateway or a server-supported bearer token. No server-provided code is installed or executed on the wiki VM.

MCP connectors start disabled. Select exposed tools, choose which trusted tools may run automatically, then turn on the connection. Calls without automatic permission appear in **Tool activity and approvals**. Calls from public pages require review even for automatic tools because the output may appear in shared content. Approval runs the exact stored arguments once; settings revisions, page access, account ownership and enabled status are checked again. Unknown execution outcomes are never automatically retried. Pending calls expire after ten minutes.

Set `STORAGE_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64) or reuse the existing `GOOGLE_TOKEN_ENCRYPTION_KEY`. This encrypts tokens and pending arguments/results with the existing server vault. Credentials never enter model prompts, client responses or page content. MCP destinations cannot use credentials in URLs, query parameters, redirects, private addresses or non-HTTPS ports. DNS addresses are validated and pinned to the TLS socket. Response and time limits apply.

Disabling a connector prevents new calls; it cannot undo an external call already accepted by a provider. Disconnecting deletes the locally stored MCP credential (or OAuth token); provider-side token revocation may also be managed in that provider's account settings.
