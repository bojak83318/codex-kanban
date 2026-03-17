import type { AddressInfo } from "node:net";
import { createApp, InMemoryKanbanStore } from "../src/index.js";
import { DEFAULT_AGENT_TOKEN_VALUE } from "../src/auth.js";
import type { Card } from "../src/types.js";

const AGENT_AUTH_HEADER = {
  Authorization: `Bearer ${DEFAULT_AGENT_TOKEN_VALUE()}`,
};

function seedCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-42",
    title: "Verify security guards",
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

describe("api verification hooks", () => {
  test("request_staging_deploy logs a staging_deploy_requested audit entry", async () => {
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
      const audits = app.store.getAudits();
      const deployAudit = audits.find((entry) => entry.event === "staging_deploy_requested");
      expect(deployAudit).toBeDefined();
      expect(deployAudit?.card_id).toBe("T-42");
      expect(deployAudit?.details).toHaveProperty("target_env", "staging");
      expect(deployAudit?.details).toHaveProperty("ticket_id", response.body.ticket.ticket_id);
    } finally {
      await app.close();
    }
  });

  test("mutating endpoints require valid authentication", async () => {
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
      const endpoints = [
        {
          path: "/api/v1/cards/T-42/transition",
          method: "POST",
          body: {
            from_column: "in_progress",
            to_column: "human_review",
            decision_summary: {
              action: "Authorize",
              logic_chain: "Need JWT",
              projected_impact: "Guarded",
              reversible: true,
            },
          },
        },
        {
          path: "/api/v1/cards/T-42/signals",
          method: "POST",
          body: {
            type: "blocked",
            reason: "auth-check",
          },
        },
        {
          path: "/api/v1/cards/T-42/ack",
          method: "POST",
          body: {
            verdict: "approve",
          },
        },
        {
          path: "/api/v1/cards/T-42/attempts",
          method: "POST",
          body: {
            attempt_index: 2,
            strategy: "direct_impl",
            branch: "vk/T-42-auth",
            worktree_path: "./agents/T-42-auth",
          },
        },
        {
          path: "/api/v1/board/veto",
          method: "POST",
          body: {
            reason: "auth guard",
            scope: "all",
          },
        },
        {
          path: "/api/v1/mcp/request_staging_deploy",
          method: "POST",
          body: {
            card_id: "T-42",
          },
        },
      ];

      for (const entry of endpoints) {
        const response = await app.request(entry.path, {
          method: entry.method,
          body: JSON.stringify(entry.body),
        });
        expect(response.status).toBe(401);
      }
    } finally {
      await app.close();
    }
  });
});
