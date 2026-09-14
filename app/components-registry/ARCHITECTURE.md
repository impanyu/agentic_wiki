## Page routing and refresh

Page navigation uses the `questions` pool directly: rank the top five accessible, same-language question records by embedding similarity, then let the routing agent verify equivalence using only their question texts. Retrieve the mapped page after a match and remember the new question as another mapping. A miss composes a page and stores its mapping; a final lookup under the publication lock prevents concurrent equivalent requests from publishing duplicate pages.

Content quality does not determine whether a question matched. For owned reference articles, current-information requests or a last check older than 30 days trigger an optional review. If needed, research and update the existing row in place, retaining ID, owner, visibility and question mappings. Record `updated_at` and `checked_at` separately from creation time. Keep the saved page if refresh fails. Re-anchor surviving highlight text, retaining saved destinations; text that disappeared or is ambiguous is not underlined at an incorrect position. Dynamic applications retain their existing execution behavior. Other users' public pages remain read-only.

No new page replacements are created by this flow. Existing replacement records are supported only for compatibility with previously saved URLs. The front end and `/api/ask` accept page searches only. Non-page component lookup remains internal to agents; uploads are supporting resources and do not enter page navigation or page history.

# Intent-driven composition

A request describes an outcome; it does not select a hard-coded business application. Routing first identifies the required interaction, then searches the five nearest accessible question mappings and asks the LLM for equivalence. Candidate output capability must satisfy the requested interaction: an article is not an interactive chart. Question language and subject/time/geographic scope remain part of equivalence. Saved destinations and history still load directly.

On a miss, composition delegates work to agents with the caller's identity and a bounded action/result FIFO. Research produces evidence, coding produces component definitions, and validation gates persistence. The typed component notebook remains long-term memory. Templates, datasets, backend programs, workflows and API adapters have independent IDs, versions, mappings and native dependencies. New components are private. No GDP-specific routing, seed data or page repair is included.

The execution capabilities currently available are:

- Reference articles with researched citations.
- Interactive chart templates with independently stored, sourced JSON datasets; line/bar controls, series visibility, range selection and CSV download.
- Generated form frontends and bounded backend expression programs, with calculated example validation.
- Pre-coded template catalog: wiki, conversational app, file browser, dashboard, form/results and table-first data. The router uses `search_templates` and selects a catalog ID. Agents generate content, configuration and backend logic, never frontend HTML/CSS/JavaScript. Previously saved sandbox frontends remain readable for compatibility.
- Registered multi-step workflows using backend programs and configured API operations, including credential resolution described in API-EXECUTION.md.

Execution contracts and permissions are the boundary, not a catalog of subjects. New rendering or server execution engines can be added behind these contracts. Unknown component types remain searchable inert data until a runtime supports them; writing a component does not grant execution privileges. The system must never substitute a reference article or fake results for an application it cannot execute.

## Current limits

Arbitrary generated JavaScript/Python backend programs now have an E2B execution adapter, and GUI tasks have a private desktop/computer-agent path. Activation requires the server-side E2B key. See ../sandboxes/README.md for execution contracts, permissions, limits and live verification status. The code agent can run and repair generated backend programs against examples before registering their page components. The runtime does not expose dependency installation, persistent volumes or arbitrary credential access.

Browser-only generated apps still have no direct server/credential bridge; backend tasks use form/workflow components. Computer-use sessions are operational state scoped to the current user, rather than publicly reusable components. Additional execution providers can implement the same program and desktop contracts.

Template source lives in `app/templates/`; the wiki renderer remains `app/answer-text.tsx`, forms use `components-registry/form.tsx`, and chat uses `components-registry/page-chat.tsx`. Template IDs are stored in page labels; dynamic configs bind registered renderers to backend capabilities. File browsers display current-user data and connected Drive metadata, not fabricated file lists. Missing connections remain explicit.
