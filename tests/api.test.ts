import type { AddressInfo } from "node:net";
import { createApp, InMemoryKanbanStore } from "../src/index.js";
import { DEFAULT_AGENT_TOKEN_VALUE, DEFAULT_HUMAN_TOKEN_VALUE } from "../src/auth.js";
import type { Card } from "../src/types.js";

function seedCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-42",
    title: "Implement transition gate",
    owner_agent_id: "agent-42",
    column: "in_progress",
    transitions: [],
    signals: [],
    ...overrides,
  };
}

const AGENT_AUTH_HEADER = {
  Authorization: `Bearer ${DEFAULT_AGENT_TOKEN_VALUE()}`,
};
const HUMAN_AUTH_HEADER = {
  Authorization: `Bearer ${DEFAULT_HUMAN_TOKEN_VALUE()}`,
};

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

async function startServer(cards: Card[] = []) {
  const store = new InMemoryKanbanStore(cards);
  const { server } = createApp({ store });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  }

  return {
    request,
    store,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

describe("codex-kanban api", () => {
  test("filters cards by agent and columns", async () => {
    const app = await startServer([
      seedCard(),
      seedCard({
        id: "T-43",
        owner_agent_id: "agent-43",
        column: "backlog",
      }),
      seedCard({
        id: "T-44",
        column: "human_review",
      }),
    ]);

    try {
      const response = await app.request(
        "/api/v1/cards?agent_id=agent-42&columns=in_progress,human_review",
        {
          headers: AGENT_AUTH_HEADER,
        },
      );

      expect(response.status).toBe(200);
      expect(response.body.cards).toHaveLength(2);
      expect(response.body.cards.map((card: Card) => card.id)).toEqual(["T-42", "T-44"]);
    } finally {
      await app.close();
    }
  });

  test("agent can transition to human_review but not integration", async () => {
    const app = await startServer([seedCard()]);

    try {
      const first = await app.request("/api/v1/cards/T-42/transition", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          from_column: "in_progress",
          to_column: "human_review",
          decision_summary: {
            action: "Implemented slice",
            logic_chain: "State machine and tests are in place",
            projected_impact: "Local package only",
            reversible: true,
          },
          artifacts: {
            branch: "vk/T-42",
            worktree_path: "./agents/T-42",
          },
        }),
      });

      expect(first.status).toBe(200);
      expect(first.body.card.column).toBe("human_review");

      const second = await app.request("/api/v1/cards/T-42/transition", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          from_column: "human_review",
          to_column: "integration",
          decision_summary: {
            action: "Tried to self-approve",
            logic_chain: "Should fail",
            projected_impact: "Would bypass review",
            reversible: false,
          },
        }),
      });

      expect(second.status).toBe(409);
      expect(second.body.error).toContain("agent cannot move card");
    } finally {
      await app.close();
    }
  });

  test("human approval is required before integration", async () => {
    const app = await startServer([
      seedCard({
        column: "human_review",
      }),
    ]);

    try {
      const blocked = await app.request("/api/v1/cards/T-42/transition", {
        method: "POST",
        headers: HUMAN_AUTH_HEADER,
        body: JSON.stringify({
          from_column: "human_review",
          to_column: "integration",
          decision_summary: {
            action: "Promote",
            logic_chain: "Looks fine",
            projected_impact: "Integration",
            reversible: true,
          },
        }),
      });

      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toContain("Human approval is required");

      const ack = await app.request("/api/v1/cards/T-42/ack", {
        method: "POST",
        headers: HUMAN_AUTH_HEADER,
        body: JSON.stringify({
          verdict: "approve",
          notes: "Proceed to integration",
        }),
      });

      expect(ack.status).toBe(200);
      expect(ack.body.ack.verdict).toBe("approve");

      const promoted = await app.request("/api/v1/cards/T-42/transition", {
        method: "POST",
        headers: HUMAN_AUTH_HEADER,
        body: JSON.stringify({
          from_column: "human_review",
          to_column: "integration",
          decision_summary: {
            action: "Promote",
            logic_chain: "Approved review",
            projected_impact: "Integration branch unblocked",
            reversible: true,
          },
        }),
      });

      expect(promoted.status).toBe(200);
      expect(promoted.body.card.column).toBe("integration");
    } finally {
      await app.close();
    }
  });

  test("agent can emit signals and spawn attempts for owned cards", async () => {
    const app = await startServer([seedCard()]);

    try {
      const signal = await app.request("/api/v1/cards/T-42/signals", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          type: "blocked",
          reason: "Waiting on reviewer",
          context_snapshot_ref: "snap://session-1/turn-8",
        }),
      });

      expect(signal.status).toBe(201);
      expect(signal.body.signal.type).toBe("blocked");

      const attempt = await app.request("/api/v1/cards/T-42/attempts", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          attempt_index: 2,
          strategy: "tdd_first",
          branch: "vk/T-42-attempt-2",
          worktree_path: "./agents/T-42-attempt-2",
        }),
      });

      expect(attempt.status).toBe(201);
      expect(attempt.body.card.parent_card_id).toBe("T-42");
      expect(attempt.body.card.strategy).toBe("tdd_first");
    } finally {
      await app.close();
    }
  });

  test("compaction_event requires progress_md contents", async () => {
    const app = await startServer([seedCard()]);

    try {
      const response = await app.request("/api/v1/cards/T-42/signals", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          type: "compaction_event",
          reason: "25pct_threshold",
        }),
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("progress_md must be a non-empty string");
    } finally {
      await app.close();
    }
  });

  test("compaction_event persists resume context", async () => {
    const app = await startServer([seedCard()]);

    try {
      const response = await app.request("/api/v1/cards/T-42/signals", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          type: "compaction_event",
          reason: "50pct_threshold",
          progress_md: COMPACTION_PROGRESS_MD,
        }),
      });

      expect(response.status).toBe(201);
      const signal = response.body.signal;
      expect(signal.compaction_context?.reason).toBe("50pct_threshold");
      expect(signal.compaction_context?.summary).toContain("DONE 1");
      expect(signal.compaction_context?.resumeState.nextAction).toBe(
        "Add JWT middleware to /transition",
      );

      const storedCard = app.store.listCards({ agentId: "agent-42" })[0];
      expect(storedCard.signals[0].compaction_context?.resumeState.nextAction).toBe(
        "Add JWT middleware to /transition",
      );
    } finally {
      await app.close();
    }
  });

  test("attempt creation rejects branch and worktree collisions", async () => {
    const app = await startServer([
      seedCard({
        branch: "conflict-branch",
        worktree_path: "./agents/conflict",
      }),
    ]);

    try {
      const branchConflict = await app.request("/api/v1/cards/T-42/attempts", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          attempt_index: 2,
          strategy: "direct_impl",
          branch: "conflict-branch",
          worktree_path: "./agents/unique",
        }),
      });
      expect(branchConflict.status).toBe(409);

      const worktreeConflict = await app.request("/api/v1/cards/T-42/attempts", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          attempt_index: 3,
          strategy: "direct_impl",
          branch: "vk/T-42-attempt-3",
          worktree_path: "./agents/conflict",
        }),
      });
      expect(worktreeConflict.status).toBe(409);
    } finally {
      await app.close();
    }
  });

  test("board veto is human-only", async () => {
    const app = await startServer([seedCard()]);

    try {
      const denied = await app.request("/api/v1/board/veto", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          reason: "Stop work",
          scope: "all",
        }),
      });

      expect(denied.status).toBe(403);

      const allowed = await app.request("/api/v1/board/veto", {
        method: "POST",
        headers: HUMAN_AUTH_HEADER,
        body: JSON.stringify({
          reason: "Incident in integration",
          scope: "column:integration",
        }),
      });

      expect(allowed.status).toBe(200);
      expect(allowed.body.veto.active).toBe(true);
      expect(allowed.body.veto.scope).toBe("column:integration");
    } finally {
      await app.close();
    }
  });

  test("audit log records transitions, signals, ACKs, and vetoes", async () => {
    const app = await startServer([seedCard()]);

    try {
      await app.request("/api/v1/cards/T-42/transition", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          from_column: "in_progress",
          to_column: "human_review",
          decision_summary: {
            action: "Stage ready",
            logic_chain: "Unit tests pass",
            projected_impact: "Prepare for review",
            reversible: true,
          },
        }),
      });

      await app.request("/api/v1/cards/T-42/signals", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          type: "blocked",
          reason: "Waiting on dependency",
        }),
      });

      await app.request("/api/v1/cards/T-42/ack", {
        method: "POST",
        headers: HUMAN_AUTH_HEADER,
        body: JSON.stringify({
          verdict: "approve",
        }),
      });

      await app.request("/api/v1/board/veto", {
        method: "POST",
        headers: HUMAN_AUTH_HEADER,
        body: JSON.stringify({
          reason: "Hold for release planning",
          scope: "integration",
        }),
      });

      const audits = app.store.getAudits();
      expect(audits).toHaveLength(4);
      expect(audits.map((entry) => entry.event)).toEqual([
        "transition",
        "signal",
        "ack",
        "veto",
      ]);
      const transitionAudit = audits.find((entry) => entry.event === "transition");
      expect(transitionAudit?.card_id).toBe("T-42");
      expect(transitionAudit?.details).toHaveProperty("from");
      expect(transitionAudit?.details).toHaveProperty("to");
      } finally {
        await app.close();
      }
    });
  });



  test("self_veto freezes subsequent tool calls", async () => {
    const app = await startServer([seedCard()]);

    try {
      const vetoSignal = await app.request("/api/v1/cards/T-42/signals", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          type: "self_veto",
          reason: "Unsafe execution path detected",
        }),
      });
      expect(vetoSignal.status).toBe(201);

      const blockedAttempt = await app.request("/api/v1/cards/T-42/attempts", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          attempt_index: 2,
          strategy: "direct_impl",
          branch: "vk/T-42-post-veto",
          worktree_path: "./agents/T-42-post-veto",
        }),
      });
      expect(blockedAttempt.status).toBe(423);

      const blockedTransition = await app.request("/api/v1/cards/T-42/transition", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          from_column: "in_progress",
          to_column: "human_review",
          decision_summary: {
            action: "Continue despite veto",
            logic_chain: "Should be blocked",
            projected_impact: "Unsafe",
            reversible: true,
          },
        }),
      });
      expect(blockedTransition.status).toBe(423);
    } finally {
      await app.close();
    }
  });

  test("red-team: request_staging_deploy cannot exfiltrate credentials", async () => {
    const app = await startServer([
      seedCard({
        column: "integration",
        latest_ack: {
          at: new Date().toISOString(),
          actor: { kind: "human", id: "reviewer-1" },
          verdict: "approve",
        },
      }),
    ]);

    try {
      const response = await app.request("/api/v1/mcp/request_staging_deploy", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          card_id: "T-42",
          target_env: "staging",
        }),
      });

      expect(response.status).toBe(202);
      expect(response.body.ticket.tool).toBe("request_staging_deploy");
      expect(response.body.ticket).not.toHaveProperty("credentials");
      expect(JSON.stringify(response.body)).not.toContain("token");
      expect(JSON.stringify(response.body)).not.toContain("secret");
    } finally {
      await app.close();
    }
  });

  test("red-team: request_staging_deploy is blocked outside integration column", async () => {
    const app = await startServer([
      seedCard({
        column: "human_review",
        latest_ack: {
          at: new Date().toISOString(),
          actor: { kind: "human", id: "reviewer-1" },
          verdict: "approve",
        },
      }),
    ]);

    try {
      const response = await app.request("/api/v1/mcp/request_staging_deploy", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          card_id: "T-42",
        }),
      });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain("integration column");
    } finally {
      await app.close();
    }
  });

  test("red-team: agent self-ACK attempts are rejected", async () => {
    const app = await startServer([seedCard()]);

    try {
      const response = await app.request("/api/v1/cards/T-42/ack", {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify({
          verdict: "approve",
          notes: "self-approval attack",
        }),
      });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Human identity required");
    } finally {
      await app.close();
    }
  });

  test("requires a valid bearer token for card queries", async () => {
    const app = await startServer([seedCard()]);

    try {
      const missing = await app.request("/api/v1/cards");
      expect(missing.status).toBe(401);

      const invalid = await app.request("/api/v1/cards", {
        headers: { Authorization: "Bearer missing-token" },
      });
      expect(invalid.status).toBe(401);
    } finally {
      await app.close();
    }
  });
