import { describe, expect, test } from "vitest";
import { HOTLNotifierStub } from "../../src/orchestrator/hotl.js";
import { MultiAgentOrchestrator } from "../../src/orchestrator/multi-agent.js";
import { InMemoryKanbanStore } from "../../src/store.js";
import type { Card } from "../../src/types.js";

function seedParentCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-500",
    title: "Implement parallel path",
    owner_agent_id: "agent-500",
    column: "in_progress",
    transitions: [],
    signals: [],
    ...overrides,
  };
}

function seedReviewedCard(index: number, column: Card["column"] = "human_review"): Card {
  const id = `T-${index}`;
  return {
    id,
    title: `Card ${index}`,
    owner_agent_id: `agent-${index}`,
    column,
    branch: `branch-${index}`,
    worktree_path: `./agents/branch-${index}`,
    transitions: [
      {
        at: `2026-03-17T00:00:0${index}Z`,
        actor: { kind: "agent", id: `agent-${index}` },
        from: "in_progress",
        to: "human_review",
        decision_summary: {
          action: `Review ${id}`,
          logic_chain: "Ready for review",
          projected_impact: "Safe",
          reversible: index % 2 === 0,
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

describe("multi-agent orchestration", () => {
  test("creates 1:N attempt branches with lineage", () => {
    const store = new InMemoryKanbanStore([seedParentCard()]);
    const orchestrator = new MultiAgentOrchestrator(store);

    const branchPlan = orchestrator.createAttemptBranchPlan({
      parentCardId: "T-500",
      agentId: "agent-500",
      strategies: ["direct_impl", "tdd_first", "functional_decomposition"],
      kanbanApiBaseUrl: "http://localhost:3000/api/v1",
      worktreeRoot: "./agents",
    });

    expect(branchPlan.attempts).toHaveLength(3);
    expect(branchPlan.attempts[0].lineage).toEqual({
      parentCardId: "T-500",
      attemptIndex: 1,
    });
    expect(store.getCard("T-500/attempt-2").parent_card_id).toBe("T-500");
    expect(store.getCard("T-500/attempt-3").attempt_index).toBe(3);
  });

  test("runs five agents in parallel without duplicate HOTL notifications for already-reviewed cards", async () => {
    const cards = [1, 2, 3, 4, 5].map((index) => seedReviewedCard(index));
    const store = new InMemoryKanbanStore(cards);
    const notifier = new HOTLNotifierStub();
    const orchestrator = new MultiAgentOrchestrator(store, notifier);
    const executed: string[] = [];
    const plans = [];

    const results = await orchestrator.runParallelAgents(
      { cardIds: cards.map((card) => card.id), notifier },
      async (plan) => {
        executed.push(plan.cardId);
        plans.push(plan);
      },
    );

    expect(executed).toHaveLength(5);
    expect(results.every((entry) => entry.status === "completed")).toBe(true);
    expect(plans.every((plan) => plan.transitionPayload === null)).toBe(true);
    expect(notifier.getNotifications()).toHaveLength(0);
  });

  test("builds a human_review transition payload only for cards still in progress", async () => {
    const cards = [1, 2, 3, 4, 5].map((index) =>
      seedParentCard({
        id: `T-${index}`,
        title: `Card ${index}`,
        owner_agent_id: `agent-${index}`,
        attempt_index: index,
        strategy: "direct_impl",
        branch: `branch-${index}`,
        worktree_path: `./agents/branch-${index}`,
      }),
    );
    const store = new InMemoryKanbanStore(cards);
    const notifier = new HOTLNotifierStub();
    const orchestrator = new MultiAgentOrchestrator(store, notifier);
    const plans = [];

    const results = await orchestrator.runParallelAgents(
      { cardIds: cards.map((card) => card.id), notifier },
      async (plan) => {
        plans.push(plan);
      },
    );

    expect(results.every((entry) => entry.status === "completed")).toBe(true);
    expect(plans).toHaveLength(5);
    expect(plans.every((plan) => plan.transitionPayload?.from_column === "in_progress")).toBe(true);
    expect(plans.every((plan) => plan.transitionPayload?.to_column === "human_review")).toBe(true);
    expect(notifier.getNotifications()).toHaveLength(5);
  });

  test("blocks execution for all, column, and agent scoped vetoes", async () => {
    const cards = [
      seedReviewedCard(1, "human_review"),
      seedReviewedCard(2, "integration"),
      seedReviewedCard(3, "human_review"),
      seedReviewedCard(4, "integration"),
      seedReviewedCard(5, "human_review"),
    ];
    const store = new InMemoryKanbanStore(cards);
    const orchestrator = new MultiAgentOrchestrator(store);
    const human = { kind: "human" as const, id: "reviewer-1" };

    store.applyBoardVeto(human, { reason: "freeze integration", scope: "column:integration" });
    store.applyBoardVeto(human, { reason: "freeze agent 3", scope: "agent:agent-3" });

    const firstResults = await orchestrator.runParallelAgents(
      { cardIds: cards.map((card) => card.id) },
      async () => {},
    );

    expect(firstResults.find((entry) => entry.cardId === "T-2")?.status).toBe("blocked_by_veto");
    expect(firstResults.find((entry) => entry.cardId === "T-4")?.blockedBy).toBe("column:integration");
    expect(firstResults.find((entry) => entry.cardId === "T-3")?.blockedBy).toBe("agent:agent-3");

    const globalStore = new InMemoryKanbanStore(cards);
    const globalOrchestrator = new MultiAgentOrchestrator(globalStore);
    globalStore.applyBoardVeto(human, { reason: "freeze all", scope: "all" });
    const globalResults = await globalOrchestrator.runParallelAgents(
      { cardIds: cards.map((card) => card.id) },
      async () => {},
    );
    expect(globalResults.every((entry) => entry.blockedBy === "all")).toBe(true);
  });
});
