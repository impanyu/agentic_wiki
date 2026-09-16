# AgenticWiki architecture

The application has three layers:

1. **Agents** (`app/agents`): the generator and the persistent in-page agent share a Responses tool loop, tool catalog, execution journal and session memory. Routing keeps its existing fixed workflow to select or reuse a destination. The generator chooses its actions and output kind; the in-page agent chooses whether to answer, inspect, call tools, execute an app or stage an edit. Neither has a mandatory notebook, researcher, planner or reviewer pass.
2. **Pages and web apps** (`app/page-programs`, `app/templates`, `app/chat`): typed artifacts, deterministic validation/materialization, renderers, app execution and user-controlled edit previews. The artifact contract is a data format, not an agent workflow. Invalid drafts return errors to the same loop. No page edit is committed until the user clicks Save changes.
3. **Tools and data** (`app/connectors`, `app/components-registry`, `app/storage`, `app/sandboxes`, `db`): external connectors, search, files, isolated execution, reusable component storage and memory. The component registry is a library, not a notebook agent. Tools enforce current-user and page permissions at execution time.

A cache miss creates a generator identity. Its model chooses any permitted sequence of tools and can finalize without tools when evidence and functionality do not require them. No predetermined intent → research → compose → review sequence is imposed. Artifact validation occurs before saving and can send corrective feedback into the same agent loop. Specialized computer-use execution remains a tool, invoked only when selected by the agent; it is not a generation stage.

Routing and lightweight classification use GPT-5.4 Mini with `none` reasoning. Generator/in-page calls use GPT-5.6 Terra with `low` reasoning by default. Optional coding specialists default to `medium`. The primary agents can select `medium` or `high` for a harder next step using `set_reasoning_effort`, then return to `low`. These are latency-conscious starting settings, not a claim of a universal optimum. Environment overrides are documented in `.env.example`.

Each model call records its model, reasoning effort, elapsed milliseconds and provider usage in `agent_run_events`; tool and validation events stay in the same run. Calls are bounded to prevent runaway work. External writes remain ordered rather than being blindly parallelized.

Generator and in-page agents can optionally invoke coding, research, or review specialists through delegate_task. Specialists inherit the authenticated user, scoped page, tool availability, and parent constraints; tool execution rechecks current permissions. They never acquire the page owner’s privileges. Delegation is bounded to two nested levels and shares the parent cancellation deadline.

Disambiguation links are constrained by a deterministic graph check: no cycles and at most three consecutive index pages, including existing question aliases. The generator receives the remaining constraint and can explain meanings in a substantive leaf article instead of introducing another index. The graph is checked again under the publication lock.
