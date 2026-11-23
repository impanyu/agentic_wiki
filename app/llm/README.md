# LLM layer

Every model call in the app goes through `app/llm` (`respond`, `respondStream`, `embedder`,
`siteEmbed`). Callers keep speaking a subset of the OpenAI **Responses API** and add a task
`class`; the layer picks a provider/model, translates, meters, and falls back.

```ts
import {respond} from '@/app/llm';
const r = await respond({class: 'fast', model: model(), instructions, input, text: {format}}, signal);
```

## Files
- `catalog.ts` – the one config file: providers, model ids, capabilities (tools, vision,
  json_schema, context, max output), known limits (RPM/RPD/TPM/concurrency, daily reset zone)
  and the chain for each class. Override at deploy time with `LLM_CATALOG_OVERRIDES` (JSON,
  deep-merged; arrays replace).
- `prices.ts` – OpenAI $/1M tokens (input, cached input, output) plus web-search calls.
  **Keep it current**: the monthly budget is computed from it.
- `translate.ts` – Responses ⇄ Chat Completions (instructions→system, images, function tools,
  function_call/function_call_output ⇄ tool_calls/tool messages, json_schema→response_format,
  reasoning effort, usage) and sanitizing of free-provider items before an OpenAI request.
- `search.ts` – `web_search(query,count)` function tool backed by Jina → Tavily → Exa.
- `limits.ts` – per-model sliding-minute RPM/TPM, daily RPD (UTC or midnight Pacific),
  concurrency slots, 429 cooldowns (Retry-After honored).
- `schema.ts` – small JSON-Schema validator for providers without native structured output.
- `core.ts` – the router (pure, dependencies injected; tested by `tests/llm-layer.test.mjs`).
- `index.ts` – wiring to env, SQLite usage table and the OpenAI reasoning defaults.

## Classes
| class | use | default chain |
|---|---|---|
| `premium` | reader-waiting page generation, reviewer verdicts, app QA | OpenAI (caller's model) → free part of `agent` |
| `agent` | the builders: team editors and collectors (judges — reviewer, manager — use `premium`); a builder step that fails on this chain is redone on `premium` | NRP glm-5 → kimi → deepseek-v4-flash → qwen3 → Gemini 4 Hydrogen → OpenRouter Nemotron Ultra → Groq gpt-oss-120b → OpenAI |
| `fast` | routing, classification, metadata, language detection, summaries | Gemini flash-lite → NRP gpt-oss → OpenAI |
| `vision` | image understanding | NRP qwen3 → NRP gemma → Gemini flash → OpenRouter Nemotron VL → OpenAI |
| `review` | independent reviewer; pass `avoidModel` (the editor's model) | `agent` chain, other families first |
| `embed` | entity index vectors (`embedder()`) | one fixed model: `ENTITY_EMBED_MODEL` or NRP qwen3-embedding → Gemini embedding → OpenAI 3-small; `ENTITY_EMBED_DIM` (768) |
| `site-embed` | question/page-profile vectors (`siteEmbed()`) | fixed OpenAI text-embedding-3-small, 512 dims |

A model is used only when its provider key is set. With only `OPENAI_API_KEY`, every class
resolves to OpenAI with the caller's model and body unchanged (production behavior).

Requests are filtered by need: images → vision-capable models (non-vision classes also try the
vision chain); `input_file` parts or built-in tools other than `web_search` → OpenAI only;
`web_search` → free models only when a search API key exists, otherwise OpenAI.

## Budget
OpenAI calls are metered per call (usage × `prices.ts`, + $0.01 per built-in web search) into
`llm_usage` (migration `0033_llm_usage`). When the UTC month's OpenAI spend reaches
`LLM_MONTHLY_BUDGET_USD` (default 300), OpenAI is skipped until the 1st of next month and
`premium` continues on the free chain; if no free model can serve a request it fails with
`AI_LIMIT`. Embeddings are metered but not blocked (they cannot fall back). `llmSpend()` returns
`{month, spentUsd, budgetUsd, remainingUsd, overBudget, resetsAt}`; `llmStatus()` shows live
rate state and the resolved chains.

## Routing mechanics
Per call: skip models that are over budget, cooling down, or out of RPM/TPM/RPD/concurrency
(waits up to 60 s when everything usable is only briefly limited); 429 → cooldown (Retry-After,
or the provider default; daily-quota messages park the model until its reset) and next model;
5xx/network → one retry, then next; other 4xx, timeouts and invalid structured output → next.
A stream falls back only before its first delta. Each call writes an `llm_usage` row (also failed
attempts); agent runs additionally get `llm` (provider, model, class, latency, cost, fallbacks)
in their `model_finished` events in `agent_run_events`.

## Web search on free providers
`{type:'web_search'}` becomes the function tool `web_search(query,count)`. The layer executes it
itself and returns OpenAI-shaped `web_search_call` items (`status`, `action.query`,
`action.sources`), so existing evidence checks (`searched()`, the agent loop's `webSearched`)
work unchanged. Results ride on the item (`llm.results`) so later turns replay them correctly on
any provider. Free models cite via inline Markdown links (no `url_citation` annotations).

## Env vars
`OPENAI_API_KEY`, `NRP_LLM_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`,
`JINA_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `LLM_MONTHLY_BUDGET_USD`,
`LLM_CATALOG_OVERRIDES`, `ENTITY_EMBED_MODEL`, `ENTITY_EMBED_DIM` (plus the existing
`OPENAI_MODEL`, `OPENAI_AGENT_MODEL`, `OPENAI_*_REASONING_EFFORT`).

## Not routed here
Image generation (`app/agents/drawing.ts`), transcription (`app/api/transcribe`) and hosted
sandboxes (`app/sandboxes/openai-provider.ts`) stay on OpenAI directly.
