import { HttpError, type KanbanStore } from "../store.js";
import type {
  AttemptStrategy,
  BoardVeto,
  Card,
  CardArtifacts,
  DecisionSummary,
  TransitionRequest,
  VetoScope,
} from "../types.js";
import { HOTLNotifierStub, type HOTLNotification } from "./hotl.js";
import {
  buildHumanReviewTransitionPayload,
  generateSingleAgentInstructionTemplate,
} from "./single-agent.js";
import { buildSingleAgentWorktreeSpec, worktreeCreationCommands } from "./worktree.js";

export interface AttemptBranchConfig {
  parentCardId: string;
  agentId: string;
  strategies: AttemptStrategy[];
  kanbanApiBaseUrl: string;
  baseBranch?: string;
  worktreeRoot?: string;
  securityRules?: string[];
}

export interface AttemptBranchPlan {
  parentCardId: string;
  attempts: MultiAgentSpawnPlan[];
}

export interface MultiAgentSpawnPlan {
  cardId: string;
  branchName: string;
  worktreePath: string;
  strategy: AttemptStrategy;
  lineage: {
    parentCardId: string;
    attemptIndex: number;
  };
  creationCommands: string[];
  instructions: string;
  transitionPayload: TransitionRequest | null;
}

export interface MultiAgentRunResult {
  cardId: string;
  agentId: string;
  status: "completed" | "blocked_by_veto";
  blockedBy?: VetoScope;
  notification?: HOTLNotification;
}

export type MultiAgentExecutor = (plan: MultiAgentSpawnPlan) => Promise<void>;

export interface ParallelExecutionConfig {
  cardIds: string[];
  notifier?: HOTLNotifierStub;
}

export class MultiAgentOrchestrator {
  constructor(
    private readonly store: KanbanStore,
    private readonly notifier: HOTLNotifierStub = new HOTLNotifierStub(),
  ) {}

  createAttemptBranchPlan(config: AttemptBranchConfig): AttemptBranchPlan {
    if (config.strategies.length === 0) {
      throw new Error("At least one strategy is required");
    }

    const parentCard = this.store.getCard(config.parentCardId);
    const attempts = config.strategies.map((strategy, index) => {
      const attemptIndex = index + 1;
      const spec = buildSingleAgentWorktreeSpec({
        ticketId: config.parentCardId,
        attemptIndex,
        baseBranch: config.baseBranch,
        worktreeRoot: config.worktreeRoot,
      });

      const createdCard = this.store.createAttempt(
        config.parentCardId,
        { kind: "agent", id: config.agentId },
        {
          attempt_index: attemptIndex,
          strategy,
          branch: spec.branchName,
          worktree_path: spec.worktreePath,
        },
      );

      const transitionPayload = buildHumanReviewTransitionPayload(spec, {
        decisionSummary: buildAttemptDecisionSummary(parentCard, strategy, attemptIndex),
        artifactOverrides: buildAttemptArtifacts(parentCard, spec.branchName, spec.worktreePath),
      });

      return {
        cardId: createdCard.id,
        branchName: spec.branchName,
        worktreePath: spec.worktreePath,
        strategy,
        lineage: {
          parentCardId: parentCard.id,
          attemptIndex,
        },
        creationCommands: worktreeCreationCommands(spec),
        instructions: generateSingleAgentInstructionTemplate(spec, {
          agentId: config.agentId,
          kanbanApiBaseUrl: config.kanbanApiBaseUrl,
          securityRules: config.securityRules ?? [],
          additionalNotes: `Attempt strategy: ${strategy}`,
        }),
        transitionPayload,
      } satisfies MultiAgentSpawnPlan;
    });

    return {
      parentCardId: config.parentCardId,
      attempts,
    };
  }

  async runParallelAgents(
    config: ParallelExecutionConfig,
    execute: MultiAgentExecutor,
  ): Promise<MultiAgentRunResult[]> {
    if (config.cardIds.length < 5) {
      throw new Error("Parallel orchestration requires at least 5 cards");
    }

    const notifier = config.notifier ?? this.notifier;

    return Promise.all(
      config.cardIds.map(async (cardId) => {
        const card = this.store.getCard(cardId);
        const blockScope = this.findBlockingVeto(card);
        if (blockScope) {
          return {
            cardId,
            agentId: card.owner_agent_id,
            status: "blocked_by_veto",
            blockedBy: blockScope,
          } satisfies MultiAgentRunResult;
        }

        const existingHumanReviewTransition = this.findLatestHumanReviewTransition(card);
        if (card.column !== "in_progress" && !existingHumanReviewTransition) {
          throw new HttpError(409, `Card ${card.id} does not have a human_review transition`);
        }

        const fallbackSpec = buildSingleAgentWorktreeSpec({
          ticketId: card.id,
          attemptIndex: card.attempt_index,
          baseBranch: "main",
          worktreeRoot: card.worktree_path ? "." : undefined,
        });
        const spec = {
          ...fallbackSpec,
          branchName: card.branch ?? fallbackSpec.branchName,
          worktreePath: card.worktree_path ?? fallbackSpec.worktreePath,
        };

        const transitionPayload = card.column === "in_progress"
          ? buildHumanReviewTransitionPayload(spec, {
              decisionSummary: buildAttemptDecisionSummary(
                card,
                card.strategy ?? "direct_impl",
                card.attempt_index ?? 1,
              ),
              artifactOverrides: buildAttemptArtifacts(card, spec.branchName, spec.worktreePath),
            })
          : null;

        const plan: MultiAgentSpawnPlan = {
          cardId: card.id,
          branchName: spec.branchName,
          worktreePath: spec.worktreePath,
          strategy: card.strategy ?? "direct_impl",
          lineage: {
            parentCardId: card.parent_card_id ?? card.id,
            attemptIndex: card.attempt_index ?? 1,
          },
          creationCommands: worktreeCreationCommands(spec),
          instructions: generateSingleAgentInstructionTemplate(spec, {
            agentId: card.owner_agent_id,
            kanbanApiBaseUrl: "http://localhost:3000/api/v1",
            securityRules: [],
            additionalNotes: "Parallel multi-agent execution",
          }),
          transitionPayload,
        };

        await execute(plan);
        const notification = transitionPayload
          ? notifier.notifyHumanReview(
              { ...card, column: "human_review" },
              {
                at: new Date().toISOString(),
                actor: { kind: "agent", id: card.owner_agent_id },
                from: transitionPayload.from_column,
                to: transitionPayload.to_column,
                decision_summary: transitionPayload.decision_summary,
                artifacts: transitionPayload.artifacts ?? {},
              },
            )
          : undefined;
        return {
          cardId,
          agentId: card.owner_agent_id,
          status: "completed",
          notification,
        } satisfies MultiAgentRunResult;
      }),
    );
  }

  private findBlockingVeto(card: Card): VetoScope | null {
    const vetos = this.store.getBoardVetos();
    for (const veto of vetos) {
      if (!veto.active) {
        continue;
      }
      if (veto.scope === "all") {
        return veto.scope;
      }
      if (veto.scope === `agent:${card.owner_agent_id}`) {
        return veto.scope;
      }
      if (veto.scope === `column:${card.column}`) {
        return veto.scope;
      }
    }
    return null;
  }

  private findLatestHumanReviewTransition(card: Card) {
    const transitions = [...card.transitions].reverse();
    return transitions.find((entry) => entry.to === "human_review") ?? null;
  }
}

function buildAttemptDecisionSummary(
  parentCard: Card,
  strategy: AttemptStrategy,
  attemptIndex: number,
): Partial<DecisionSummary> {
  return {
    action: `Attempt ${attemptIndex} for ${parentCard.id}`,
    logic_chain: `Branching with ${strategy} strategy`,
    projected_impact: `Independent attempt for ${parentCard.id}`,
    reversible: true,
  };
}

function buildAttemptArtifacts(
  parentCard: Card,
  branchName: string,
  worktreePath: string,
): Partial<CardArtifacts> {
  return {
    branch: branchName,
    worktree_path: worktreePath,
    pr_url: undefined,
    test_report_url: undefined,
    coverage_delta: undefined,
  };
}
