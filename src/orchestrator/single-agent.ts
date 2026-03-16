import type { CardArtifacts, DecisionSummary, TransitionRequest } from "../types.js";
import { bindSingleAgentPrompt, buildSingleAgentWorktreeSpec, worktreeCreationCommands } from "./worktree.js";
import type { SingleAgentWorktreeSpec } from "./worktree.js";

export interface SingleAgentSpawnConfig {
  ticketId: string;
  agentId: string;
  kanbanApiBaseUrl: string;
  attemptIndex?: number;
  baseBranch?: string;
  worktreeRoot?: string;
  securityRules?: string[];
  additionalNotes?: string;
  decisionSummaryOverrides?: Partial<DecisionSummary>;
  artifactOverrides?: Partial<CardArtifacts>;
}

export interface SingleAgentSpawnPlan {
  spec: SingleAgentWorktreeSpec;
  instructions: string;
  creationCommands: string[];
  humanReviewTransitionPayload: TransitionRequest;
}

export function generateSingleAgentInstructionTemplate(
  spec: SingleAgentWorktreeSpec,
  config: Pick<SingleAgentSpawnConfig, "agentId" | "kanbanApiBaseUrl" | "securityRules" | "additionalNotes">,
): string {
  return bindSingleAgentPrompt(spec, {
    agentId: config.agentId,
    kanbanApiBaseUrl: config.kanbanApiBaseUrl,
    securityRules: config.securityRules ?? [],
    additionalNotes: config.additionalNotes,
  });
}

export function buildSingleAgentSpawnPlan(config: SingleAgentSpawnConfig): SingleAgentSpawnPlan {
  if (!config.ticketId?.trim()) {
    throw new Error("ticketId is required");
  }
  if (!config.agentId?.trim()) {
    throw new Error("agentId is required");
  }
  if (!config.kanbanApiBaseUrl?.trim()) {
    throw new Error("kanbanApiBaseUrl is required");
  }

  const spec = buildSingleAgentWorktreeSpec({
    ticketId: config.ticketId,
    attemptIndex: config.attemptIndex,
    baseBranch: config.baseBranch,
    worktreeRoot: config.worktreeRoot,
  });

  const instructions = generateSingleAgentInstructionTemplate(spec, config);

  return {
    spec,
    instructions,
    creationCommands: worktreeCreationCommands(spec),
    humanReviewTransitionPayload: buildHumanReviewTransitionPayload(spec, {
      decisionSummary: config.decisionSummaryOverrides,
      artifactOverrides: config.artifactOverrides,
    }),
  };
}

export function buildHumanReviewTransitionPayload(
  spec: SingleAgentWorktreeSpec,
  overrides?: {
    decisionSummary?: Partial<DecisionSummary>;
    artifactOverrides?: Partial<CardArtifacts>;
  },
): TransitionRequest {
  const summary: DecisionSummary = {
    ...buildDefaultDecisionSummary(spec.ticketId),
    ...(overrides?.decisionSummary ?? {}),
  };

  const artifacts: CardArtifacts = {
    branch: spec.branchName,
    worktree_path: spec.worktreePath,
    ...(overrides?.artifactOverrides ?? {}),
  };

  return {
    from_column: "in_progress",
    to_column: "human_review",
    decision_summary: summary,
    artifacts,
  };
}

function buildDefaultDecisionSummary(ticketId: string): DecisionSummary {
  return {
    action: `Elevate ${ticketId} to human review`,
    logic_chain: "Implementation and local validation are complete",
    projected_impact: "Ready for human inspection",
    reversible: true,
  };
}
