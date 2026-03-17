export const CARD_COLUMNS = [
  "backlog",
  "spec_review",
  "in_progress",
  "human_review",
  "integration",
  "done",
  "rejected",
] as const;

export type CardColumn = (typeof CARD_COLUMNS)[number];

export const SIGNAL_TYPES = [
  "blocked",
  "self_veto",
  "compaction_event",
  "test_failure",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const COMPACTION_EVENT_REASONS = [
  "25pct_threshold",
  "50pct_threshold",
  "75pct_threshold",
  "context_exhausted",
] as const;

export type CompactionEventReason = (typeof COMPACTION_EVENT_REASONS)[number];

export interface ProgressResumeState {
  session: number;
  timestamp: string;
  done: string[];
  inProgress: string[];
  blocked: string[];
  filesModified: string[];
  nextActionQueue: string[];
  nextAction: string;
}

export interface CompactionEventContext {
  reason: CompactionEventReason;
  summary: string;
  resumeState: ProgressResumeState;
}

export const ATTEMPT_STRATEGIES = [
  "direct_impl",
  "tdd_first",
  "functional_decomposition",
] as const;

export type AttemptStrategy = (typeof ATTEMPT_STRATEGIES)[number];

export const ACK_VERDICTS = [
  "approve",
  "reject",
  "request_changes",
] as const;

export type AckVerdict = (typeof ACK_VERDICTS)[number];

export type Actor =
  | { kind: "agent"; id: string }
  | { kind: "human"; id: string };

export interface DecisionSummary {
  action: string;
  logic_chain: string;
  projected_impact: string;
  reversible: boolean;
}

export interface CardArtifacts {
  pr_url?: string;
  branch?: string;
  worktree_path?: string;
  test_report_url?: string;
  coverage_delta?: number;
}

export interface TransitionRecord {
  at: string;
  actor: Actor;
  from: CardColumn;
  to: CardColumn;
  decision_summary: DecisionSummary;
  artifacts: CardArtifacts;
}

export interface SignalRecord {
  at: string;
  actor: Actor;
  type: SignalType;
  reason: string;
  context_snapshot_ref?: string;
  compaction_context?: CompactionEventContext;
}

export interface AckRecord {
  at: string;
  actor: Actor;
  verdict: AckVerdict;
  notes?: string;
}

export interface Card {
  id: string;
  title: string;
  owner_agent_id: string;
  column: CardColumn;
  parent_card_id?: string;
  attempt_index?: number;
  strategy?: AttemptStrategy;
  branch?: string;
  worktree_path?: string;
  latest_ack?: AckRecord;
  latest_human_transition?: TransitionRecord;
  transitions: TransitionRecord[];
  signals: SignalRecord[];
}

export interface BoardVeto {
  active: boolean;
  at: string;
  actor: Actor;
  reason: string;
  scope: string;
}

export type AuditEventType =
  | "transition"
  | "signal"
  | "ack"
  | "veto"
  | "staging_deploy_requested";

export interface AuditRecord {
  at: string;
  actor: Actor;
  event: AuditEventType;
  card_id?: string;
  details: Record<string, unknown>;
}

export interface TransitionRequest {
  from_column: CardColumn;
  to_column: CardColumn;
  decision_summary: DecisionSummary;
  artifacts?: CardArtifacts;
}

export interface SignalRequest {
  type: SignalType;
  reason: string;
  context_snapshot_ref?: string;
  compaction_context?: CompactionEventContext;
}

export interface AckRequest {
  verdict: AckVerdict;
  notes?: string;
}

export interface AttemptRequest {
  attempt_index: number;
  strategy: AttemptStrategy;
  worktree_path: string;
  branch: string;
}

export interface VetoRequest {
  reason: string;
  scope: string;
}

export interface AppState {
  cards: Map<string, Card>;
  audit: AuditRecord[];
  boardVeto?: BoardVeto;
}
