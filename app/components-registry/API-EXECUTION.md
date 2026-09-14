# Credential resolution and generic HTTP execution

The executor follows the API component's native `credential` edge (ID + version), checks both component ACLs and the credential's private ownership, then resolves `secretRef` from server environment secrets. Secret values are never stored in component definitions, native links, agent FIFO memory, or browser responses. Local secrets may be placed in the ignored `.env.local`; hosted values belong in the VM service environment. Never upload a secret file into the searchable Data pool.

A credential component stores only:

```json
{"provider":"Example API","secretRef":"COMPONENT_SECRET_EXAMPLE"}
```

## Server authorization policy

Set `COMPONENT_API_POLICY` as a server environment variable. It is intentionally outside the agent-writable component pool. Creating a credential component with a guessed secretRef does **not** authorize the caller to use that secret. Each grant requires the actual user's principal plus an exact endpoint and method. Agent roles never grant extra access.

```json
{
  "anonymous": [
    {"url":"https://api.open-meteo.com/v1/forecast","methods":["GET"]}
  ],
  "credentials": {
    "COMPONENT_SECRET_EXAMPLE": {
      "userIds": ["YOUR_AUTHENTICATED_USER_ID"],
      "endpoints": [{"url":"https://api.example.com/v1/items","methods":["GET","POST"]}],
      "auth": {"location":"header","name":"Authorization","prefix":"Bearer "}
    }
  }
}
```

Set `COMPONENT_SECRET_EXAMPLE` separately to the actual credential. The policy contains no secret value. Query-key authentication uses `{"location":"query","name":"api_key"}`. For OAuth APIs, supply a currently valid access token via the secret binding; interactive OAuth authorization and automatic refresh are not implemented. The `userIds` values are the application's authenticated user IDs, or `guest:<samepage_visitor UUID>` for an explicitly authorized guest. Prefer account identities for durable credential grants. The default policy enables **no endpoints and no credentials**.

## API operation definitions

The owner can open an API component and choose **Configure HTTP operations**. Saving creates a new private executable API component, preserving the old component and connecting them with `derived_from`/`executable` edges. An existing credential link is inherited, or the owner can provide their own credential component ID. Authentication policy still must be configured on the server.

Example `http` definition for the forecast API:

```json
{
  "operations": [{
    "name":"forecast",
    "method":"GET",
    "path":"/v1/forecast",
    "parameters":[
      {"name":"latitude","location":"query","type":"number","required":true},
      {"name":"longitude","location":"query","type":"number","required":true},
      {"name":"current_weather","location":"query","type":"boolean","required":false}
    ],
    "response":"json"
  }]
}
```

The component retains its existing `baseUrl`, documentation, and authentication metadata, with `execution:"http"` and the `http` definition. Supported operations are GET/POST/PUT/PATCH/DELETE, declared query parameters, JSON body fields, and JSON/text responses. Paths are fixed, normalized, and cannot redirect to another origin. Custom arbitrary headers, multipart uploads, streaming responses, path templates, and OAuth refresh are outside this executor's current contract.

The notebook `execute_api` tool lets routing, coding and page agents call configured GET operations. The API component UI also exposes execution. Non-GET requests require explicit user confirmation in that UI; the agent tool cannot grant that confirmation. No network call is automatically retried.

## Failure and containment

Missing links, unavailable secrets, unconfigured operations and denied grants return distinct safe error codes. The server authorizes the endpoint/method/user **before** reading the secret. Redirects are blocked, errors never include upstream bodies/headers, requests time out after 20 seconds, and responses are limited to 256 KiB. Common literal/JSON/URL/base64 echoes of the injected secret are redacted. These safeguards do not make an untrusted API safe: the operator must enable only endpoints trusted to receive the credential, and narrowly scope credentials at the provider too.

For tests, `http-transport.ts` injects a mock fetch and secret reader so authentication, denial, redaction and error behavior can be verified without real credentials. The actual resolver in `api-executor.ts` uses server bindings and permission-checked native links only.

## Using APIs in stored page workflows

A workflow step may reference an `api_adapter` component instead of a backend program. `bindings` map API parameter names to form/earlier-result fields. `outputs` map result field names to JSON pointers in the returned API body. The resulting scalar fields can feed later calculation steps and the page template. Workflow API calls are GET-only; write operations require the API component UI confirmation.

```json
{
  "kind":"workflow",
  "steps":[{
    "name":"weather",
    "component":{"id":"YOUR_API_COMPONENT_ID","version":1},
    "operation":"forecast",
    "bindings":{"latitude":"latitude","longitude":"longitude"},
    "outputs":{"elevation":"/elevation"}
  }]
}
```
