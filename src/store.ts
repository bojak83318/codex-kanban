import {
  ACK_VERDICTS,
  ATTEMPT_STRATEGIES,
  CARD_COLUMNS,
  COMPACTION_EVENT_REASONS,
  SIGNAL_TYPES,
  type AckRecord,
  type AckRequest,
  type Actor,
  type AppState,
  type AttemptRequest,
  type BoardVeto,
  type Card,
  type CardColumn,
  type DecisionSummary,
  type SignalRecord,
  type SignalRequest,
  type TransitionRecord,
  type TransitionRequest,
  type VetoRequest,
  type AuditEventType,
  type AuditRecord,
  type CompactionEventContext,
} from "./types.js";
import { buildCompactionEventContextFromProgressMd } from "./lib/progress-resume.js";

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export const AGENT_TRANSITIONS: Record<CardColumn, CardColumn[]> = {
  backlog: ["spec_review"],
  spec_review: ["in_progress"],
  in_progress: ["human_review"],
  human_review: [],
  integration: [],
  done: [],
  rejected: ["backlog"],
};

export const HUMAN_TRANSITIONS: Record<CardColumn, CardColumn[]> = {
  backlog: [],
  spec_review: [],
  in_progress: [],
  human_review: ["integration", "rejected", "backlog"],
  integration: ["done", "rejected"],
  done: [],
  rejected: ["backlog"],
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${label} must be a non-empty string`);
  }
  return value;
}

export function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${label} must be a boolean`);
  }
  return value;
}

export function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new HttpError(400, `${label} must be a number`);
  }
  return value;
}

export function assertEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpError(400, `${label} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function requireCard(state: AppState, cardId: string): Card {
  const card = state.cards.get(cardId);
  if (!card) {
    throw new HttpError(404, `Card ${cardId} not found`);
  }
  return card;
}

export function requireAgentOwnership(card: Card, actor: Actor): void {
  if (actor.kind !== "agent") {
    throw new HttpError(403, "Agent identity required");
  }
  if (card.owner_agent_id !== actor.id) {
    throw new HttpError(403, `Agent ${actor.id} does not own card ${card.id}`);
  }
}

export function requireHuman(actor: Actor): void {
  if (actor.kind !== "human") {
    throw new HttpError(403, "Human identity required");
  }
}

function isCardFrozen(card: Card): boolean {
  return card.signals.some((signal) => signal.type === "self_veto");
}

function requireCardNotFrozen(card: Card): void {
  if (isCardFrozen(card)) {
    throw new HttpError(423, `Card ${card.id} is frozen by self_veto`);
  }
}

export function validateDecisionSummary(value: unknown): DecisionSummary {
  const record = assertObject(value, "decision_summary");
  return {
    action: assertString(record.action, "decision_summary.action"),
    logic_chain: assertString(record.logic_chain, "decision_summary.logic_chain"),
    projected_impact: assertString(
      record.projected_impact,
      "decision_summary.projected_impact",
    ),
    reversible: assertBoolean(record.reversible, "decision_summary.reversible"),
  };
}

export function validateTransitionRequest(value: unknown): TransitionRequest {
  const record = assertObject(value, "transition request");
  return {
    from_column: assertEnum(record.from_column, CARD_COLUMNS, "from_column"),
    to_column: assertEnum(record.to_column, CARD_COLUMNS, "to_column"),
    decision_summary: validateDecisionSummary(record.decision_summary),
    artifacts:
      record.artifacts == null
        ? {}
        : (assertObject(record.artifacts, "artifacts") as TransitionRequest["artifacts"]),
  };
}

export function validateSignalRequest(value: unknown): SignalRequest {
  const record = assertObject(value, "signal request");
  const contextSnapshot = record.context_snapshot_ref;
  const signalType = assertEnum(record.type, SIGNAL_TYPES, "type");
  let reason: string;
  let compactionContext: CompactionEventContext | undefined;

  if (signalType === "compaction_event") {
    const compactionReason = assertEnum(
      record.reason,
      COMPACTION_EVENT_REASONS,
      "reason",
    );
    const progressMd = assertString(record.progress_md, "progress_md");
    compactionContext = buildCompactionEventContextFromProgressMd(
      progressMd,
      compactionReason,
    );
    reason = compactionReason;
  } else {
    reason = assertString(record.reason, "reason");
  }

  return {
    type: signalType,
    reason,
    context_snapshot_ref:
      contextSnapshot == null
        ? undefined
        : assertString(contextSnapshot, "context_snapshot_ref"),
    compaction_context: compactionContext,
  };
}

export function validateAckRequest(value: unknown): AckRequest {
  const record = assertObject(value, "ack request");
  const notes = record.notes;
  return {
    verdict: assertEnum(record.verdict, ACK_VERDICTS, "verdict"),
    notes: notes == null ? undefined : assertString(notes, "notes"),
  };
}

export function validateAttemptRequest(value: unknown): AttemptRequest {
  const record = assertObject(value, "attempt request");
  const attemptIndex = assertNumber(record.attempt_index, "attempt_index");
  if (!Number.isInteger(attemptIndex) || attemptIndex < 1) {
    throw new HttpError(400, "attempt_index must be a positive integer");
  }
  return {
    attempt_index: attemptIndex,
    strategy: assertEnum(record.strategy, ATTEMPT_STRATEGIES, "strategy"),
    worktree_path: assertString(record.worktree_path, "worktree_path"),
    branch: assertString(record.branch, "branch"),
  };
}

export function validateVetoRequest(value: unknown): VetoRequest {
  const record = assertObject(value, "veto request");
  return {
    reason: assertString(record.reason, "reason"),
    scope: assertString(record.scope, "scope"),
  };
}

export class InMemoryKanbanStore implements KanbanStore {
  private readonly state: AppState;

  constructor(seedCards: Card[] = []) {
    this.state = {
      cards: new Map(seedCards.map((card) => [card.id, structuredClone(card)])),
      audit: [],
    };
  }

  listCards(filters: { agentId?: string; columns?: string[] }): Card[] {
    let cards = Array.from(this.state.cards.values());
    if (filters.agentId) {
      cards = cards.filter((card) => card.owner_agent_id === filters.agentId);
    }
    if (filters.columns && filters.columns.length > 0) {
      const allowed = new Set(filters.columns);
      cards = cards.filter((card) => allowed.has(card.column));
    }
    return cards.map((card) => structuredClone(card));
  }

  getCard(cardId: string): Card {
    const card = requireCard(this.state, cardId);
    return structuredClone(card);
  }

  getAudits(): AuditRecord[] {
    return this.state.audit.map((entry) => structuredClone(entry));
  }

  private logAudit(
    event: AuditEventType,
    actor: Actor,
    cardId: string | undefined,
    details: Record<string, unknown>,
  ): void {
    const record: AuditRecord = {
      at: nowIso(),
      actor,
      event,
      card_id: cardId,
      details: structuredClone(details),
    };
    this.state.audit.push(record);
  }

  transitionCard(cardId: string, actor: Actor, payload: unknown): Card {
    const request = validateTransitionRequest(payload);
    const card = requireCard(this.state, cardId);
    requireCardNotFrozen(card);
    if (card.column !== request.from_column) {
      throw new HttpError(
        409,
        `Card ${card.id} is in ${card.column}, not ${request.from_column}`,
      );
    }

    const transitions =
      actor.kind === "agent" ? AGENT_TRANSITIONS[card.column] : HUMAN_TRANSITIONS[card.column];
    if (!transitions.includes(request.to_column)) {
      throw new HttpError(
        409,
        `${actor.kind} cannot move card from ${card.column} to ${request.to_column}`,
      );
    }

    if (actor.kind === "agent") {
      requireAgentOwnership(card, actor);
      if (
        request.to_column === "integration" ||
        request.to_column === "done"
      ) {
        throw new HttpError(403, "Agent cannot self-transition past human_review");
      }
    } else {
      requireHuman(actor);
      if (card.column === "human_review" && request.to_column === "integration") {
        if (!card.latest_ack || card.latest_ack.verdict !== "approve") {
          throw new HttpError(409, "Human approval is required before integration");
        }
      }
    }

    const transition: TransitionRecord = {
      at: nowIso(),
      actor,
      from: request.from_column,
      to: request.to_column,
      decision_summary: request.decision_summary,
      artifacts: request.artifacts ?? {},
    };

    card.column = request.to_column;
    card.transitions.push(transition);
    if (request.artifacts?.branch) { card.branch = request.artifacts.branch; }
    if (request.artifacts?.worktree_path) { card.worktree_path = request.artifacts.worktree_path; }
    if (actor.kind === "human") {
      card.latest_human_transition = transition;
    }

    this.logAudit("transition", actor, card.id, {
      from: request.from_column,
      to: request.to_column,
      from_state: request.from_column,
      to_state: request.to_column,
      decision_summary: request.decision_summary,
    });
    return structuredClone(card);
  }

  addSignal(cardId: string, actor: Actor, payload: unknown): SignalRecord {
    const request = validateSignalRequest(payload);
    const card = requireCard(this.state, cardId);
    requireCardNotFrozen(card);
    requireAgentOwnership(card, actor);
    const signal: SignalRecord = {
      at: nowIso(),
      actor,
      type: request.type,
      reason: request.reason,
      context_snapshot_ref: request.context_snapshot_ref,
      compaction_context: request.compaction_context,
    };
    card.signals.push(signal);

    const auditDetails: Record<string, unknown> = {
      type: request.type,
      reason: request.reason,
      context_snapshot_ref: request.context_snapshot_ref,
    };
    if (request.compaction_context) {
      auditDetails.compaction_summary = request.compaction_context.summary;
      auditDetails.resume_state = request.compaction_context.resumeState;
    }

    this.logAudit("signal", actor, card.id, auditDetails);
    return structuredClone(signal);
  }

  ackCard(cardId: string, actor: Actor, payload: unknown): AckRecord {
    requireHuman(actor);
    const request = validateAckRequest(payload);
    const card = requireCard(this.state, cardId);
    requireCardNotFrozen(card);
    const ack: AckRecord = {
      at: nowIso(),
      actor,
      verdict: request.verdict,
      notes: request.notes,
    };
    card.latest_ack = ack;

    this.logAudit("ack", actor, card.id, {
      verdict: request.verdict,
      notes: request.notes,
    });
    return structuredClone(ack);
  }

  createAttempt(parentCardId: string, actor: Actor, payload: unknown): Card {
    const request = validateAttemptRequest(payload);
    const parent = requireCard(this.state, parentCardId);
    requireCardNotFrozen(parent);
    requireAgentOwnership(parent, actor);
    this.ensureUniqueBranchAndWorktree(request);

    const attemptId = `${parentCardId}/attempt-${request.attempt_index}`;
    if (this.state.cards.has(attemptId)) {
      throw new HttpError(409, `Attempt ${attemptId} already exists`);
    }

    const attemptCard: Card = {
      id: attemptId,
      title: `${parent.title} (attempt ${request.attempt_index})`,
      owner_agent_id: parent.owner_agent_id,
      column: parent.column,
      parent_card_id: parent.id,
      attempt_index: request.attempt_index,
      strategy: request.strategy,
      branch: request.branch,
      worktree_path: request.worktree_path,
      latest_ack: undefined,
      latest_human_transition: undefined,
      transitions: [],
      signals: [],
    };

    this.state.cards.set(attemptCard.id, attemptCard);
    return structuredClone(attemptCard);
  }

  private ensureUniqueBranchAndWorktree(request: AttemptRequest): void {
    for (const card of this.state.cards.values()) {
      if (card.branch && card.branch === request.branch) {
        throw new HttpError(409, `Branch ${request.branch} already used by card ${card.id}`);
      }
      if (card.worktree_path && card.worktree_path === request.worktree_path) {
        throw new HttpError(
          409,
          `Worktree path ${request.worktree_path} already used by card ${card.id}`,
        );
      }
    }
  }

  applyBoardVeto(actor: Actor, payload: unknown): BoardVeto {
    requireHuman(actor);
    const request = validateVetoRequest(payload);
    const veto: BoardVeto = {
      active: true,
      at: nowIso(),
      actor,
      reason: request.reason,
      scope: request.scope,
    };
    this.state.boardVeto = veto;

    this.logAudit("veto", actor, undefined, {
      reason: request.reason,
      scope: request.scope,
    });
    return structuredClone(veto);
  }
}

export interface KanbanStore {
  listCards(filters: { agentId?: string; columns?: string[] }): Card[];
  getCard(cardId: string): Card;
  getAudits(): AuditRecord[];
  transitionCard(cardId: string, actor: Actor, payload: unknown): Card;
  addSignal(cardId: string, actor: Actor, payload: unknown): SignalRecord;
  ackCard(cardId: string, actor: Actor, payload: unknown): AckRecord;
  createAttempt(parentCardId: string, actor: Actor, payload: unknown): Card;
  applyBoardVeto(actor: Actor, payload: unknown): BoardVeto;
}
