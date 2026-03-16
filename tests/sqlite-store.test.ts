import { HttpError } from "../src/store.js";
import { SQLiteKanbanStore } from "../src/storage/sqlite.js";
import type { Actor, Card } from "../src/types.js";

function seedCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-42",
    title: "SQLite card",
    owner_agent_id: "agent-42",
    column: "in_progress",
    transitions: [],
    signals: [],
    ...overrides,
  };
}

const COMPACTION_PROGRESS_MD = `
## Session 3 — 2026-03-16T15:30:00Z
### DONE
- Finalized compaction routing
### IN_PROGRESS
- Tidy resume helpers
### BLOCKED
- Waiting on shared schema
### FILES_MODIFIED
- src/lib/progress-resume.ts
### NEXT_ACTION
- Add JWT middleware to /transition
`;

describe("SQLiteKanbanStore", () => {
  test("enforces human approval before integration", () => {
    const store = new SQLiteKanbanStore({ seedCards: [seedCard()] });
    const agent: Actor = { kind: "agent", id: "agent-42" };
    const human: Actor = { kind: "human", id: "reviewer-1" };

    store.transitionCard("T-42", agent, {
      from_column: "in_progress",
      to_column: "human_review",
      decision_summary: {
        action: "Phase move",
        logic_chain: "Ready for review",
        projected_impact: "Testing",
        reversible: true,
      },
    });

    expect(() =>
      store.transitionCard("T-42", agent, {
        from_column: "human_review",
        to_column: "integration",
        decision_summary: {
          action: "Skip review",
          logic_chain: "Should fail",
          projected_impact: "Shortcut",
          reversible: false,
        },
      }),
    ).toThrow(HttpError);

    store.ackCard("T-42", human, { verdict: "approve" });

    const promoted = store.transitionCard("T-42", human, {
      from_column: "human_review",
      to_column: "integration",
      decision_summary: {
        action: "Promote",
        logic_chain: "Ack approved",
        projected_impact: "Integration",
        reversible: true,
      },
    });

    expect(promoted.column).toBe("integration");
    expect(promoted.latest_ack?.verdict).toBe("approve");
    const audits = store.getAudits();
    expect(audits.map((entry) => entry.event)).toContain("transition");
    expect(audits.map((entry) => entry.event)).toContain("ack");
  });

  test("records signals and vetoes in the audit log", () => {
    const store = new SQLiteKanbanStore({ seedCards: [seedCard()] });
    const agent: Actor = { kind: "agent", id: "agent-42" };
    const human: Actor = { kind: "human", id: "reviewer-1" };

    store.addSignal("T-42", agent, {
      type: "blocked",
      reason: "Waiting",
    });

    const veto = store.applyBoardVeto(human, {
      reason: "Hold",
      scope: "all",
    });

    expect(veto.active).toBe(true);
    expect(veto.scope).toBe("all");
    const events = store.getAudits().map((entry) => entry.event);
    expect(events).toContain("signal");
    expect(events).toContain("veto");
  });

  test("records compaction context for signals", () => {
    const store = new SQLiteKanbanStore({ seedCards: [seedCard()] });
    const agent: Actor = { kind: "agent", id: "agent-42" };

    const signal = store.addSignal("T-42", agent, {
      type: "compaction_event",
      reason: "75pct_threshold",
      progress_md: COMPACTION_PROGRESS_MD,
    });

    expect(signal.compaction_context).toBeDefined();
    expect(signal.compaction_context?.summary).toContain("DONE 1");
    expect(signal.compaction_context?.resumeState.nextAction).toBe(
      "Add JWT middleware to /transition",
    );
  });

  test("blocks branch and worktree collisions for attempts", () => {
    const store = new SQLiteKanbanStore({
      seedCards: [
        seedCard({
          branch: "conflict-branch",
          worktree_path: "./agents/conflict",
        }),
      ],
    });
    const agent: Actor = { kind: "agent", id: "agent-42" };

    expect(() =>
      store.createAttempt("T-42", agent, {
        attempt_index: 2,
        strategy: "direct_impl",
        branch: "conflict-branch",
        worktree_path: "./agents/unique",
      }),
    ).toThrow(HttpError);

    expect(() =>
      store.createAttempt("T-42", agent, {
        attempt_index: 3,
        strategy: "direct_impl",
        branch: "vk/T-42-attempt-3",
        worktree_path: "./agents/conflict",
      }),
    ).toThrow(HttpError);
  });
});
