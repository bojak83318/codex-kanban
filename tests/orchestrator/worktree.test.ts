import { describe, expect, test } from "vitest";
import {
  bindSingleAgentPrompt,
  buildSingleAgentWorktreeSpec,
  worktreeCleanupCommands,
  worktreeCreationCommands,
} from "../../src/orchestrator/worktree.js";

describe("single-agent worktree helpers", () => {
  test("builds sanitized branch and worktree spec for attempts", () => {
    const spec = buildSingleAgentWorktreeSpec({
      ticketId: "T-42",
      attemptIndex: 2,
    });

    expect(spec.branchName).toBe("t-42-ae25d54f-attempt-2");
    expect(spec.worktreePath).toBe("./agents/t-42-ae25d54f-attempt-2");
    expect(spec.baseBranch).toBe("main");
  });

  test("sanitizes complex ticket ids and honors custom roots", () => {
    const spec = buildSingleAgentWorktreeSpec({
      ticketId: "Feature/ABC 123",
      baseBranch: "develop",
      worktreeRoot: "./worktrees",
    });

    expect(spec.branchName).toBe("feature-abc-123-b9c2a858");
    expect(spec.worktreePath).toBe("./worktrees/feature-abc-123-b9c2a858");
    expect(spec.baseBranch).toBe("develop");
  });

  test("creation and cleanup commands reference spec details", () => {
    const spec = buildSingleAgentWorktreeSpec({
      ticketId: "T-99",
      attemptIndex: 1,
      baseBranch: "release",
      worktreeRoot: "./tmp",
    });

    expect(worktreeCreationCommands(spec)).toEqual([
      "git fetch origin release",
      "git checkout release",
      "git checkout -b t-99-dad72bc4-attempt-1",
      "git worktree add ./tmp/t-99-dad72bc4-attempt-1 t-99-dad72bc4-attempt-1",
    ]);

    expect(worktreeCleanupCommands(spec)).toEqual([
      "git worktree remove --force ./tmp/t-99-dad72bc4-attempt-1",
      "git branch -D t-99-dad72bc4-attempt-1",
    ]);
  });

  test("prompt binding includes all required sections", () => {
    const spec = buildSingleAgentWorktreeSpec({
      ticketId: "T-hello",
      attemptIndex: 1,
    });

    const prompt = bindSingleAgentPrompt(spec, {
      agentId: "agent-1",
      kanbanApiBaseUrl: "http://localhost:3000",
      securityRules: ["Never bypass human review."],
      additionalNotes: "Please coordinate with the reviewer.",
    });

    expect(prompt).toContain("Ticket ID: T-hello");
    expect(prompt).toContain("Agent ID: agent-1");
    expect(prompt).toContain("Branch: t-hello-2c5b68f3-attempt-1");
    expect(prompt).toContain("Worktree: ./agents/t-hello-2c5b68f3-attempt-1");
    expect(prompt).toContain("Non-negotiable security rules:");
    expect(prompt).toContain("1. Never bypass human review.");
    expect(prompt).toContain("Additional context:");
    expect(prompt).toContain("Please coordinate with the reviewer.");
  });
});
