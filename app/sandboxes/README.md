# Backend execution and optional desktop access

Generated Python and JavaScript backend programs run in an OpenAI-hosted Agents API sandbox. They use the server's existing `OPENAI_API_KEY`; it needs Agents API read/write and Responses inference access. `OPENAI_SANDBOX_MODEL` optionally overrides `OPENAI_MODEL`. No application credentials enter the workspace.

Source and JSON inputs are uploaded under `/workspace`. A fixed setup command executes the saved source with a 30-second process limit, captures bounded logs, and writes an execution report. The model acknowledges completion; its prose is never accepted as program output. The server checks the completed turn, retrieves its matching report artifact, validates the JSON, then requests session deletion. Failed cleanup is retained as `cleanup_pending` with the provider session ID. There is a 180-second request deadline including sandbox provisioning and the model turn. Code runs with outbound network disabled.

Context files are scoped to the current user/page. Legacy `/home/user/context` input references are mapped to `/workspace/context`. Small files are inline uploads; larger files use temporary Files API records with one-hour expiry and explicit cleanup. The existing 40 MB attachment and 128 KB result limits remain.

Page backends return a validated view or one tool request. The Node.js server executes authorized storage, external API, data, research, or LLM operations using the visiting user's permissions. The next backend step receives those results in a fresh workspace. Sandboxes do not retain the application's persistent chat or page state; that stays in SQLite and private objects.

## Optional GUI desktop

Desktop computer use remains a separate E2B integration (`E2B_API_KEY`). It is used for screenshot/click/type interactions with graphical applications. It is not needed for backend code or API-based file browsing. The panel reports code and desktop configuration separately. GUI sessions last 10 minutes and are private to their owner; screenshots and actions use authenticated routes.

## Limits and verification

Authenticated users can create at most two active sandboxes and 100 attempts per rolling day. Guests and mismatched agent principals are rejected before allocation. Live Python and Node.js tests passed against OpenAI-hosted sandboxes with an uploaded JSON file and an artifact containing its computed sum. Contract tests cover isolation, failed turns, artifact selection, result limits, cleanup, and legacy input paths. E2B desktop execution has not been verified live.

- https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted
- https://developers.openai.com/api/docs/guides/agents-api/environments/files
