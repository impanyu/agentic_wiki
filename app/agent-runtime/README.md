# Persistent agent runtime

Page-generation notebook work and in-page tool calls use the same Responses execution loop. Each turn preserves provider output items (including reasoning) and pairs every function call with its result. Tool errors return to the model for recovery. Limits are 24 tool rounds / 48 calls per loop, a final synthesis round, a 180,000-character input budget and a ten-minute deadline; delegated notebook tasks have smaller limits. These are operational limits, not a promise that every provider capability is configured.

`agent_memory` is now an archive rather than a destructive FIFO. Recent actions, compacted summaries, session notes and a task plan form working context. The model can search/paginate archived actions and run events. Summaries do not delete source records. Prior records already deleted by the old implementation cannot be recovered. Raw provider reasoning is retained only within the active request chain, not in stored memory.

Run events record tool starts and finishes, approval proposals, terminal results and failures. Repeated call IDs in one loop are not re-executed. An interrupted external call may have taken effect: the next turn must inspect the recorded outcome/provider before retrying. This implementation does not automatically resume a disconnected turn, replay writes after a process restart, or claim exactly-once execution across processes. Users continue the persistent session with a follow-up message. Existing connector approval and page-access enforcement still apply, and page edits require Save changes.

The creator's page session inherits generation notes, actions and tool records. Public-page visitors receive separate sessions and use their own connections. All session-memory reads/writes enforce the agent owner. Secrets are redacted before persistence; connectors resolve credentials outside model-visible arguments.

Tests cover multi-round tool chaining, multiple calls, error recovery, duplicate IDs, budgets, cancellation, journal failures, archive retention, compaction, and principal isolation.
