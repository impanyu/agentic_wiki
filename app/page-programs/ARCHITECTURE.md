# AgenticWiKi

## Stable addresses and contextual execution

The question pool is the semantic address space. A new address is embedded, the five closest accessible questions in the same language are passed to the routing agent, and only a confirmed question match resolves its mapped page. A matched query is also indexed against that page. Otherwise the router creates a new page and mapping. Page refresh and wiki editing update the existing page ID. Saved underline destinations and navigation history reuse their page IDs.

The user-facing pool contains pages only: static wiki entries and applications. Legacy resource records are excluded from page search. Internal versioned backend/template/API/data records remain implementation dependencies, not additional searchable page types. Old pages remain readable; the migration does not delete user data or recode existing applications.

The immutable frontend catalog contains wiki, chat, file browser, dashboard, form and table templates. The router searches this catalog before composing a new page. Arbitrary generated frontend code is no longer accepted for new pages.

## Application programs

The coding agent saves a JavaScript or Python backend program with the page. Its procedure is a bounded state machine: `main({input, results})` returns one named tool call or a validated view. Each continuation starts a fresh OpenAI-hosted sandbox with prior results; the program must not depend on process memory. Maximum seven tool calls plus the final view, subject also to existing per-user sandbox quotas. Each VM has a 30-second program timeout and requests session cleanup in finally. No application secret or OAuth token is supplied to the VM; code runs without network access. The host broker performs permitted storage, API, uploaded-data, research and LLM calls as the visiting user.

Only validated data goes into pre-coded React templates. Responses are ephemeral per visitor; they do not overwrite the shared page definition, question mappings or another user's session. An unavailable execution provider leaves the saved definition intact and displays a setup error. Programs are not advertised as tested before execution. Live execution uses the existing OPENAI_API_KEY with Agents API read/write and Responses inference access. OPENAI_SANDBOX_MODEL optionally overrides the existing app model. No E2B key is needed for backend programs.

File mutations create encrypted, user-bound pending actions. The UI displays the exact change and a separate Apply action. Repeated approval returns the stored result. An uncertain provider response is never retried automatically. Generic API writes retain the existing explicit-confirmation policy and cannot run through the autonomous program broker.

## Persistent sessions and editing

Each `(user ID, page ID)` has a stable session agent. Completed message/reply turns are stored permanently in SQLite, paginated 50 at a time. Long conversations use a persisted summary plus recent turns as context. The operational action/result FIFO is separate. Surviving legacy FIFO messages are imported; previously discarded historical messages cannot be recovered.

Static wiki pages show their Chat section by default. The page content, accessible files and history provide the agent context. Wiki chat is visible to everyone who can access the page. Only the owner may stage and save article changes. Concrete edits are staged as private filesystem proposals with a preview and Save changes button. Saving checks ownership, revision and lease expiry, and repositions existing underline anchors when their text survives. App and session conversations retain their per-user scope.

## Deployment

Migration 0012 adds conversation turns and summaries without removing existing records. Provider setup is documented in `app/storage/SETUP.md`; backend execution setup remains in `app/sandboxes/README.md`. Existing legacy application executors remain supported. New application generation uses the saved-program path.

Backend source and inputs are materialized under /workspace. A fixed setup command runs the stored program and writes its JSON execution report before the model turn. The model only acknowledges completion. The server verifies the completed turn and downloads its execution report artifact; it never treats assistant prose as execution output. Network access is disabled. Large input files use temporary Files API uploads with one-hour expiry and explicit deletion. Desktop computer use remains a separate optional E2B service.

Page-scoped frontend edits use `propose_app_revision` with `kind: code` (wiki chat exposes `propose_page_code`). `dynamic.pageCode` stores HTML, CSS and JavaScript with before/after/replace placement. Native panels remain for additive edits. Replacement affects only this page. JavaScript is syntax-checked before staging; the unsaved preview runs in an opaque-origin iframe without tool access. Saved code invokes `window.pageTools.call(name,args)`: the host validates message source and the server rechecks page write access, then dispatches the existing visitor-scoped toolbox. Credentials never enter the iframe. Public read-only visitors cannot execute tool-backed code. Generated backend revisions retain the existing sandbox-program path. No generated code modifies the platform checkout.

Registered-page compatibility repair is applied consistently during reads, chat and saving. An explicitly customized definition is not repaired back to the original template. Map preferences are inherited from the current page and by the map tool when opened with its source page.
