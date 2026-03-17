import { describe, expect, test } from "vitest";
import { HOTLNotifierStub } from "../../src/orchestrator/hotl.js";
import { MultiAgentOrchestrator } from "../../src/orchestrator/multi-agent.js";
import {
  type AttemptBranchCreatedEvent,
  type HumanReviewTransitionEvent,
  type HotlNotificationEvent,
  type OrchestratorInstrumentation,
  type ParallelExecutionStartedEvent,
  type VetoBlockedExecutionEvent,
} from "../../src/orchestrator/instrumentation.js";
import { InMemoryKanbanStore } from "../../src/store.js";
import type { Card } from "../../src/types.js";

class RecordingInstrumentation implements OrchestratorInstrumentation {
  readonly attemptEvents: AttemptBranchCreatedEvent[] = [];
  readonly parallelEvents: ParallelExecutionStartedEvent[] = [];
  readonly vetoEvents: VetoBlockedExecutionEvent[] = [];
  readonly transitionEvents: HumanReviewTransitionEvent[] = [];
  readonly hotlEvents: HotlNotificationEvent[] = [];

  recordAttemptBranchCreated(event: AttemptBranchCreatedEvent): void {
    this.attemptEvents.push(event);
  }

  recordParallelExecutionStarted(event: ParallelExecutionStartedEvent): void {
    this.parallelEvents.push(event);
  }

  recordVetoBlockedExecution(event: VetoBlockedExecutionEvent): void {
    this.vetoEvents.push(event);
  }

  recordHumanReviewTransition(event: HumanReviewTransitionEvent): void {
    this.transitionEvents.push(event);
  }

  recordHotlNotification(event: HotlNotificationEvent): void {
    this.hotlEvents.push(event);
  }
}

function buildParentCard(): Card {
  return {
    id: "T-101",
    title: "Instrumented parent card",
    owner_agent_id: "agent-101",
    column: "in_progress",
    transitions: [],
    signals: [],
  };
}

function buildInProgressCard(index: number): Card {
  return {
    id: `T-${index}`,
    title: `Card ${index}`,
    owner_agent_id: `agent-${index}`,
    column: "in_progress",
    branch: `branch-${index}`,
    worktree_path: `./agents/branch-${index}`,
    transitions: [],
    signals: [],
  };
}

describe("orchestrator instrumentation", () => {
  test("flags attempt branch creation", () => {
    const store = new InMemoryKanbanStore([buildParentCard()]);
    const instrumentation = new RecordingInstrumentation();
    const orchestrator = new MultiAgentOrchestrator(store, new HOTLNotifierStub(), instrumentation);

    orchestrator.createAttemptBranchPlan({
      parentCardId: "T-101",
      agentId: "agent-101",
      strategies: ["direct_impl", "tdd_first"],
      kanbanApiBaseUrl: "http://localhost:3000/api/v1",
      worktreeRoot: "./agents",
    });

    expect(instrumentation.attemptEvents).toHaveLength(1);
    const event = instrumentation.attemptEvents[0];
    expect(event.parentCardId).toBe("T-101");
    expect(event.agentId).toBe("agent-101");
    expect(event.attemptCardIds).toHaveLength(2);
    expect(event.attemptCardIds.every((id) => id.startsWith("T-101/attempt-"))).toBe(true);
    expect(event.strategies).toEqual(["direct_impl", "tdd_first"]);
  });

  test("captures parallel execution, transition, HOTL, and veto events", async () => {
    const cards = [1, 2, 3, 4, 5].map((index) => buildInProgressCard(index));
    const store = new InMemoryKanbanStore(cards);
    const instrumentation = new RecordingInstrumentation();
    const notifier = new HOTLNotifierStub();
    const orchestrator = new MultiAgentOrchestrator(store, notifier, instrumentation);
    const human = { kind: "human" as const, id: "reviewer-1" };

    store.applyBoardVeto(human, { reason: "freeze agent 3", scope: "agent:agent-3" });

    await orchestrator.runParallelAgents({ cardIds: cards.map((card) => card.id), notifier }, async () => {
      // no-op executor
    });

    expect(instrumentation.parallelEvents).toHaveLength(1);
    expect(instrumentation.parallelEvents[0].cardIds).toEqual(cards.map((card) => card.id));
    expect(instrumentation.parallelEvents[0].parallelism).toBe(5);

    expect(instrumentation.vetoEvents).toHaveLength(1);
    expect(instrumentation.vetoEvents[0]).toMatchObject({
      cardId: "T-3",
      agentId: "agent-3",
      vetoScope: "agent:agent-3",
    });

    expect(instrumentation.transitionEvents.map((event) => event.cardId)).toEqual([
      "T-1",
      "T-2",
      "T-4",
      "T-5",
    ]);
    expect(instrumentation.transitionEvents.every((event) => event.transition.to_column === "human_review")).toBe(
      true,
    );

    expect(instrumentation.hotlEvents).toHaveLength(4);
    expect(instrumentation.hotlEvents.every((event) => event.notification.cardId !== "T-3")).toBe(true);
  });
});
