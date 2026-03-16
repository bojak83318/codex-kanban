import { describe, expect, test } from "vitest";
import {
  buildSingleAgentSpawnPlan,
  buildHumanReviewTransitionPayload,
} from "../../src/orchestrator/single-agent.js";
import { buildSingleAgentWorktreeSpec } from "../../src/orchestrator/worktree.js";

describe("single-agent spawn helpers", () => {
  test("builds a complete spawn plan", () => {
    const plan = buildSingleAgentSpawnPlan({
      ticketId: "T-9000",
      agentId: "agent-9000",
      kanbanApiBaseUrl: "http://localhost/api",
      baseBranch: "develop",
      worktreeRoot: "./tmp",
      securityRules: ["Wear a mask"],
      additionalNotes: "Focus on safety",
    });

    expect(plan.spec.branchName).toBe("t-9000-6201a89e");
    expect(plan.spec.baseBranch).toBe("develop");
    expect(plan.instructions).toContain("Ticket ID: T-9000");
    expect(plan.instructions).toContain("Agent ID: agent-9000");
    expect(plan.instructions).toContain("Kanban API: http://localhost/api");
    expect(plan.instructions).toContain("1. Wear a mask");
    expect(plan.creationCommands).toEqual([
      "git fetch origin develop",
      "git checkout develop",
      "git checkout -b t-9000-6201a89e",
      "git worktree add ./tmp/t-9000-6201a89e t-9000-6201a89e",
    ]);
    expect(plan.humanReviewTransitionPayload.to_column).toBe("human_review");
    expect(plan.humanReviewTransitionPayload.artifacts?.branch).toBe("t-9000-6201a89e");
  });

  test("human review payload merges overrides", () => {
    const spec = buildSingleAgentWorktreeSpec({ ticketId: "T-1" });
    const payload = buildHumanReviewTransitionPayload(spec, {
      decisionSummary: { action: "Custom action" },
      artifactOverrides: { pr_url: "http://example.com/pr" },
    });

    expect(payload.decision_summary.action).toBe("Custom action");
    expect(payload.artifacts?.pr_url).toBe("http://example.com/pr");
    expect(payload.artifacts?.branch).toBe(spec.branchName);
  });
});
