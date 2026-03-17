import { describe, expect, it, vi } from "vitest";
import { HOTLNotifierStub } from "../../src/orchestrator/hotl.js";
import type { AgentTransport } from "../../src/orchestrator/agents-sdk-adapter.js";
import { McpOrchestrationHandler } from "../../src/orchestrator/mcp-handler.js";
import { MultiAgentOrchestrator } from "../../src/orchestrator/multi-agent.js";
import { InMemoryKanbanStore } from "../../src/store.js";
import type { Card } from "../../src/types.js";

function buildInProgressCard(index: number): Card {
  const id = `T-${index}`;
  return {
    id,
    title: `Card ${index}`,
    owner_agent_id: `agent-${index}`,
    column: "in_progress",
    branch: `branch-${index}`,
    worktree_path: `./agents/branch-${index}`,
    transitions: [
      {
        at: `2026-03-17T00:00:0${index}Z`,
        actor: { kind: "agent" as const, id: `agent-${index}` },
        from: "in_progress",
        to: "human_review",
        decision_summary: {
          action: "handoff to review",
          logic_chain: "state is ready",
          projected_impact: "safe",
          reversible: true,
        },
        artifacts: {
          branch: `branch-${index}`,
          worktree_path: `./agents/branch-${index}`,
        },
      },
    ],
    signals: [],
  };
}

function buildIntegrationCard(): Card {
  return {
    id: "T-integration",
    title: "blocked card",
    owner_agent_id: "agent-integration",
    column: "integration",
    branch: "branch-integration",
    worktree_path: "./agents/branch-integration",
    transitions: [
      {
        at: "2026-03-17T00:00:00Z",
        actor: { kind: "agent" as const, id: "agent-integration" },
        from: "in_progress",
        to: "human_review",
        decision_summary: {
          action: "ready for human review",
          logic_chain: "complete",
          projected_impact: "safe",
          reversible: true,
        },
        artifacts: {
          branch: "branch-integration",
          worktree_path: "./agents/branch-integration",
        },
      },
      {
        at: "2026-03-17T00:00:05Z",
        actor: { kind: "human" as const, id: "reviewer" },
        from: "human_review",
        to: "integration",
        decision_summary: {
          action: "push to integration",
          logic_chain: "approved",
          projected_impact: "safe",
          reversible: false,
        },
        artifacts: {
          branch: "branch-integration",
          worktree_path: "./agents/branch-integration",
        },
      },
    ],
    signals: [],
  };
}

function createTransport(store: InMemoryKanbanStore) {
  const internalStore = store as unknown as { state: { cards: Map<string, Card> } };
  const run = vi.fn<
    Parameters<AgentTransport["run"]>,
    ReturnType<AgentTransport["run"]>
  >(async ({ lineage }: Parameters<AgentTransport["run"]>[0]) => {
    const card = internalStore.state.cards.get(lineage.parentCardId);
    if (card) {
      card.column = "human_review";
    }
  });

  return { run } as AgentTransport & { run: typeof run };
}

describe("McpOrchestrationHandler", () => {
  it("calls the transport once per non-vetoed card", async () => {
    const cards = [1, 2, 3, 4, 5].map(buildInProgressCard);
    const store = new InMemoryKanbanStore(cards);
    const orchestrator = new MultiAgentOrchestrator(store);
    const handler = new McpOrchestrationHandler(orchestrator);
    const transport = createTransport(store);

    const results = await handler.runBatch(cards.map((card) => card.id), transport);

    expect(transport.run).toHaveBeenCalledTimes(5);
    expect(results.every((entry) => entry.status === "completed")).toBe(true);
  });

  it("emits HOTL notifications for every human-review transition", async () => {
    const cards = [1, 2, 3, 4, 5].map(buildInProgressCard);
    const store = new InMemoryKanbanStore(cards);
    const orchestrator = new MultiAgentOrchestrator(store);
    const handler = new McpOrchestrationHandler(orchestrator);
    const notifier = new HOTLNotifierStub();
    const transport = createTransport(store);

    await handler.runBatch(cards.map((card) => card.id), transport, notifier);

    expect(notifier.getNotifications()).toHaveLength(cards.length);
  });

  it("skips transport calls for cards blocked by a column integration veto", async () => {
    const inProgressCards = [1, 2, 3, 4, 5].map(buildInProgressCard);
    const integrationCard = buildIntegrationCard();
    const store = new InMemoryKanbanStore([...inProgressCards, integrationCard]);
    const orchestrator = new MultiAgentOrchestrator(store);
    const handler = new McpOrchestrationHandler(orchestrator);
    const transport = createTransport(store);
    const human = { kind: "human" as const, id: "reviewer" };

    store.applyBoardVeto(human, { reason: "freeze integration", scope: "column:integration" });

    const results = await handler.runBatch(
      [...inProgressCards.map((card) => card.id), integrationCard.id],
      transport,
    );

    expect(transport.run).toHaveBeenCalledTimes(inProgressCards.length);
    const blockedResult = results.find((entry) => entry.cardId === integrationCard.id);
    expect(blockedResult?.status).toBe("blocked_by_veto");
    expect(blockedResult?.blockedBy).toBe("column:integration");
  });
});
