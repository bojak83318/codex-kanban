import type { AttemptStrategy, TransitionRecord, TransitionRequest, VetoScope } from "../types.js";
import type { HOTLNotification } from "./hotl.js";

export interface AttemptBranchCreatedEvent {
  parentCardId: string;
  agentId: string;
  attemptCardIds: string[];
  strategies: AttemptStrategy[];
}

export interface ParallelExecutionStartedEvent {
  cardIds: string[];
  parallelism: number;
}

export interface VetoBlockedExecutionEvent {
  cardId: string;
  agentId: string;
  vetoScope: VetoScope;
}

export interface HumanReviewTransitionEvent {
  cardId: string;
  agentId: string;
  attemptIndex?: number;
  transition: TransitionRequest;
}

export interface HotlNotificationEvent {
  cardId: string;
  notification: HOTLNotification;
  transition: TransitionRecord;
}

export interface OrchestratorInstrumentation {
  recordAttemptBranchCreated?(event: AttemptBranchCreatedEvent): void;
  recordParallelExecutionStarted?(event: ParallelExecutionStartedEvent): void;
  recordVetoBlockedExecution?(event: VetoBlockedExecutionEvent): void;
  recordHumanReviewTransition?(event: HumanReviewTransitionEvent): void;
  recordHotlNotification?(event: HotlNotificationEvent): void;
}

export class NoopOrchestratorInstrumentation implements OrchestratorInstrumentation {
  recordAttemptBranchCreated(): void {}
  recordParallelExecutionStarted(): void {}
  recordVetoBlockedExecution(): void {}
  recordHumanReviewTransition(): void {}
  recordHotlNotification(): void {}
}
