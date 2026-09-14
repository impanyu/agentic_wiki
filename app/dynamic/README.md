# Dynamic destinations (first registered application)

- `unit-converter.tsx`: reusable React template.
- `execute.ts`: server-side executor registry, validation, and conversion calculations.
- `units.ts`: supported unit IDs, input/result types, and navigation parameter encoding.
- `../api/pages/[id]/run/route.ts`: same-origin execution endpoint; checks page visibility on every request.

A `pages` row stores `kind=dynamic` and `dynamic_config` with template ID, executor ID, version and localized labels. Code lives in the deployed source, not in database records. Only the registered `unit-converter-v1` executor may run. This version does not generate or evaluate arbitrary application code.

Question matching still retrieves five question-pool records, applies the LLM, then resolves the selected question's page. Question entries for this application carry `capability=unit-converter-v1`; the verifier can reuse the converter across different values and unit pairs. Current input is parsed separately and calculated by the backend, never copied from another user's result. Question aliases persist their parameters in `questions.parameters`.

New unsupported application requests continue through ordinary researched-article generation. Supported conversions cover length, mass, volume, time and temperature. Missing, ambiguous or unsupported unit inputs open the editable converter; currency exchange is not a registered application.

Execution results are returned to the client, not saved as shared article text. The page URL and saved underline parameters preserve the input. Back/Forward and underline clicks load the stored destination and execute its backend using those saved parameters, without embedding or LLM matching. Unit conversions are deterministic; changing inputs does not mutate other users' results.

To add another application, define and validate its input/output contract, implement an explicitly registered backend executor and frontend template, and extend capability recognition and rendering. Backend credentials and external data permissions belong to the server, not the template.

The typed component registry now generalizes this prototype. See `../components-registry/README.md` for stored generated templates/programs, notebook agents, native resource links, private ownership and data uploads.
