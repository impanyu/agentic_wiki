# Historical Sites deployment notes

Archived from the original deployment. These instructions do not apply to this VM repository; use README.md. Some historical behavior descriptions predate later application changes.

# Samepage

A single-page question browser. Enter a question in the address bar, or select answer text and use Highlight / Highlight & open. Click saved highlights to navigate. Back and Forward traverse both kinds of navigation.

## Answer cache

Cloudflare D1 stores pages, owners, visibility, question-to-page mappings, and 512-dimensional text-embedding-3-small vectors. The server scans accessible vectors in batches of 100, keeps the top five candidates, and asks a language model to compare the original question and saved answer. Confirmed equivalent questions map to the same page. Matching requires the same subject, scope, and intent: a region cannot match one province, or a category one example. Ambiguous fragments are not forced onto a candidate. Question mappings carry a matching-rule version; older exact mappings are checked once against current rules and only rejected mappings are removed, preserving their original pages. No match triggers OpenAI Responses web search and generation of a cited article. Page and original question inserts are atomic. Per-question leases prevent duplicate generation of the same text. Cache reads and unrelated questions run concurrently. The browser automatically waits for an in-progress identical question. A separate short finalization phase rechecks semantic matches before saving, so concurrent equivalent drafts converge on one accessible page. Jobs have a bounded deadline and release their own lease; expired leases can be replaced.

This initial implementation uses exact cosine search over vectors in D1, not a dedicated approximate-nearest-neighbor vector database. Large pools need a dedicated vector index and a durable job queue. AI equivalence judgments and generated facts remain probabilistic and should be evaluated for the intended subject domain.

## Article language and composition

The submitted text alone determines its language; highlighted text does not carry source-page context. Both exact and semantic lookups filter by the stored article language before reuse. Legacy pages are classified from their existing prose on first search, without rewriting their content. Chinese Simplified and Traditional are stored separately. Ambiguous Latin names or acronyms default to English when the text gives no language signal.

New article titles, summaries, sections, captions, and article labels use the detected language. The generated article is checked again before saving; a language mismatch fails the request rather than caching a wrong-language answer. Language detection and equivalence are model judgments. The browser toolbar remains in English, and original source names/image attribution are retained.

Articles have a contents list and topic-specific sections. Optional Wikimedia Commons images use real returned URLs and attribution, with model selection for relevance. Images and captions are stored with the article, preserving consistent cached pages.

## Identity and privacy

Sites provides ChatGPT sign-in. Direct Google OAuth is not implemented. Guests can generate public pages, which have no authenticated owner. Signed-in users own the pages they generate. All new pages default to public; only authenticated owners may change their page to private. Reusing a page does not transfer ownership or change visibility. ACL checks apply before matching, direct reads, and visibility writes. A private page is excluded from other users’ search candidates.

Page visibility is separate from the Sites hosting access policy: the initial deployment is owner-only until site access is explicitly changed.

## Streaming generation

The browser requests `Accept: text/event-stream` for navigation. Existing cache hits return JSON immediately after matching. On misses the server forwards real Responses API text deltas as SSE, followed by metadata and a final saved-page event. The UI renders a temporary article while it grows; sources and optional images arrive at completion. Only the complete, language-checked article is saved atomically with its question mapping and added to browser history. Drafts cannot be highlighted until their text has stabilized. Interrupted drafts are labeled unsaved, and Back/Forward sends a request-scoped cancellation token to stop generation before persistence, including through proxies that do not forward browser disconnect signals. Clients without the streaming Accept header retain the JSON API.

SSE parsing handles arbitrary network/UTF-8 splits, heartbeat frames, and truncated connections. Run `node --test tests/event-stream.test.mjs` with a Node runtime that supports TypeScript stripping.

## Navigation state

Answer records are server-persisted. Browser history stores only page IDs and entered text, per tab. Highlights are local interaction state and survive Back/Forward within the open app; they are not saved to the server or preserved after a reload. Reloading or opening a page link retrieves the answer through the same access checks.

## Local development

Use the existing package lock and `npm run install:ci`. Set OPENAI_API_KEY in ignored .env.local. OPENAI_MODEL defaults to gpt-5.4-mini. Production secrets belong in Sites environment settings, never in source or the hosting manifest.

Run `npm run db:generate` only when the schema changes. `npm run build` emits dist/server/wrangler.json. Apply pending SQL migrations locally using Wrangler D1 execute with the generated config and .wrangler/state. Never reapply migrations already used. Run `npm run dev` for the preview.

Local sign-in is the Sites starter’s simulated Seedy account. Hosted sign-in is performed by the Sites dispatcher.

## Verification

Verified TypeScript compilation and production build, live web-researched generation, semantic reuse of one page for paraphrased questions, public guest reads, private owner access, private guest rejection, and rejected guest writes. Browser checks covered text selection, a clickable highlight, navigation to the selected text, Back/Forward, and retained highlights. WebMCP registration, a valid navigation, and invalid input rejection were exercised.
