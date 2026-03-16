export declare const CARD_COLUMNS: readonly ["backlog", "spec_review", "in_progress", "human_review", "integration", "done", "rejected"];
export type CardColumn = (typeof CARD_COLUMNS)[number];
export declare const SIGNAL_TYPES: readonly ["blocked", "self_veto", "compaction_event", "test_failure"];
export type SignalType = (typeof SIGNAL_TYPES)[number];
export declare const ATTEMPT_STRATEGIES: readonly ["direct_impl", "tdd_first", "functional_decomposition"];
export type AttemptStrategy = (typeof ATTEMPT_STRATEGIES)[number];
export declare const ACK_VERDICTS: readonly ["approve", "reject", "request_changes"];
export type AckVerdict = (typeof ACK_VERDICTS)[number];
export type Actor = {
    kind: "agent";
    id: string;
} | {
    kind: "human";
    id: string;
};
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
    boardVeto?: BoardVeto;
}
