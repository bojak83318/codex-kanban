import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { createApp, InMemoryKanbanStore } from "../../src/index.js";
import { DEFAULT_AGENT_TOKEN_VALUE, DEFAULT_HUMAN_TOKEN_VALUE } from "../../src/auth.js";
import { buildSingleAgentSpawnPlan } from "../../src/orchestrator/single-agent.js";
import type { Card } from "../../src/types.js";

const AGENT_AUTH_HEADER = {
  Authorization: `Bearer ${DEFAULT_AGENT_TOKEN_VALUE}`,
};
const HUMAN_AUTH_HEADER = {
  Authorization: `Bearer ${DEFAULT_HUMAN_TOKEN_VALUE}`,
};

function seedCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-42",
    title: "Implement single-agent flow",
    owner_agent_id: "agent-42",
    column: "in_progress",
    transitions: [],
    signals: [],
    ...overrides,
  };
}

async function startServer(cards: Card[] = []) {
  const store = new InMemoryKanbanStore(cards);
  const { server } = createApp({ store });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    request: async (path: string, init: RequestInit = {}) => {
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
    },
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

describe("single-agent orchestrator flow", () => {
  test("creates a worktree, transitions through review, and reaches integration", async () => {
    const card = seedCard();
    const app = await startServer([card]);

    try {
      const plan = buildSingleAgentSpawnPlan({
        ticketId: card.id,
        agentId: card.owner_agent_id,
        kanbanApiBaseUrl: app.baseUrl,
        baseBranch: "main",
      });

      // Worktree creation should reference the sanitized branch.
      expect(plan.creationCommands[2]).toContain(`git checkout -b ${plan.spec.branchName}`);
      expect(plan.creationCommands[3]).toContain(plan.spec.worktreePath);

      // Execution instructions include environment and rules.
      expect(plan.instructions).toContain(`Kanban API: ${app.baseUrl}`);
      expect(plan.instructions).toContain(`Worktree: ${plan.spec.worktreePath}`);

      // Transition from in_progress -> human_review as the agent.
      const transition = await app.request(`/api/v1/cards/${card.id}/transition`, {
        method: "POST",
        headers: AGENT_AUTH_HEADER,
        body: JSON.stringify(plan.humanReviewTransitionPayload),
      });

      expect(transition.status).toBe(200);
      expect(transition.body.card.column).toBe("human_review");

      // Human ACK before integration.
      const ack = await app.request(`/api/v1/cards/${card.id}/ack`, {
        method: "POST",
        headers: HUMAN_AUTH_HEADER,
        body: JSON.stringify({
          verdict: "approve",
          notes: "Ready for integration",
        }),
      });
      expect(ack.status).toBe(200);

      // Human drives the integration transition.
      const promote = await app.request(`/api/v1/cards/${card.id}/transition`, {
        method: "POST",
        headers: HUMAN_AUTH_HEADER,
        body: JSON.stringify({
          from_column: "human_review",
          to_column: "integration",
          decision_summary: {
            action: "Promote to integration",
            logic_chain: "Human review approved",
            projected_impact: "Integration queue",
            reversible: true,
          },
          artifacts: {
            branch: plan.spec.branchName,
            worktree_path: plan.spec.worktreePath,
          },
        }),
      });

      expect(promote.status).toBe(200);
      expect(promote.body.card.column).toBe("integration");
    } finally {
      await app.close();
    }
  });
});
