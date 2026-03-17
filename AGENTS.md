
## Review guidelines
- Column state machine transitions must be enforced server-side, never client-trusted.
- JWT ownership guards must use real signed tokens, not mocked header checks.
- Audit log entries must capture actor, timestamp, from_state, and to_state.
- POST /transition and related routes must never return credential data in response bodies.
- Any route missing authentication middleware is a P0 finding.
- progress.md NEXT_ACTION field must be present and non-empty on all compaction events.
- Secrets-gated tools must not be callable from sub-agents outside the integration column.
- self_veto signals must immediately freeze the session — no further tool calls after emission.
- Attempt creation must reject duplicate branch names and worktree paths.

## Phase 7 status
- Phase 7 - Final Acceptance Review complete (verification-only work is done).
