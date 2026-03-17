import Database from "better-sqlite3";
import {
  CARD_COLUMNS,
  type AckRecord,
  type Actor,
  type AuditRecord,
  type BoardVeto,
  type Card,
  type AttemptRequest,
  type CardColumn,
  type SignalRecord,
  type CompactionEventContext,
  type TransitionRecord,
} from "../types.js";
import {
  AGENT_TRANSITIONS,
  HUMAN_TRANSITIONS,
  assertEnum,
  nowIso,
  validateAckRequest,
  validateAttemptRequest,
  validateSignalRequest,
  validateTransitionRequest,
  validateVetoRequest,
  requireAgentOwnership,
  requireHuman,
  HttpError,
  type KanbanStore,
} from "../store.js";
import { applyMigrations } from "./migrations.js";

export interface SQLiteKanbanStoreOptions {
  databasePath?: string;
  seedCards?: Card[];
}

export class SQLiteKanbanStore implements KanbanStore {
  private readonly db: Database.Database;

  constructor(options: SQLiteKanbanStoreOptions = {}) {
    this.db = new Database(options.databasePath ?? ":memory:");
    applyMigrations(this.db);
    if (options.seedCards && options.seedCards.length > 0) {
      this.seedCards(options.seedCards);
    }
  }

  listCards(filters: { agentId?: string; columns?: string[] }): Card[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.agentId) {
      conditions.push("owner_agent_id = ?");
      params.push(filters.agentId);
    }

    if (filters.columns && filters.columns.length > 0) {
      const validColumns = filters.columns.map((entry) =>
        assertEnum(entry, CARD_COLUMNS, "columns entry"),
      );
      const placeholders = validColumns.map(() => "?").join(",");
      conditions.push(`"column" IN (${placeholders})`);
      params.push(...validColumns);
    }

    const query = `SELECT * FROM cards${
      conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : ""
    }`;
    const rows = this.db.prepare(query).all(...params);
    return rows.map((row: any) => this.buildCardFromRow(row));
  }

  getCard(cardId: string): Card {
    return this.buildCard(cardId);
  }

  getAudits(): AuditRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_events ORDER BY id ASC")
      .all();
    return rows.map((row: any) => ({
      at: row.at,
      actor: { kind: row.actor_kind as Actor["kind"], id: row.actor_id },
      event: row.event,
      card_id: row.card_id ?? undefined,
      details: JSON.parse(row.details),
    }));
  }

  logStagingDeployAudit(
    actor: Actor,
    cardId: string,
    targetEnv: string,
    ticketId: string,
  ): void {
    this.logAudit("staging_deploy_requested", actor, cardId, {
      target_env: targetEnv,
      ticket_id: ticketId,
    });
  }

  transitionCard(cardId: string, actor: Actor, payload: unknown): Card {
    const request = validateTransitionRequest(payload);
    const transitionOperation = this.db.transaction(() => {
      const card = this.buildCard(cardId);
      this.requireCardNotFrozen(card);
      if (card.column !== request.from_column) {
        throw new HttpError(
          409,
          `Card ${cardId} is in ${card.column}, not ${request.from_column}`,
        );
      }

      const availableTransitions =
        actor.kind === "agent"
          ? AGENT_TRANSITIONS[card.column]
          : HUMAN_TRANSITIONS[card.column];
      if (!availableTransitions.includes(request.to_column)) {
        throw new HttpError(
          409,
          `${actor.kind} cannot move card from ${card.column} to ${request.to_column}`,
        );
      }

      if (actor.kind === "agent") {
        requireAgentOwnership(card, actor);
        if (request.to_column === "integration" || request.to_column === "done") {
          throw new HttpError(403, "Agent cannot self-transition past human_review");
        }
      } else {
        requireHuman(actor);
        if (
          card.column === "human_review" &&
          request.to_column === "integration"
        ) {
          if (!card.latest_ack || card.latest_ack.verdict !== "approve") {
            throw new HttpError(
              409,
              "Human approval is required before integration",
            );
          }
        }
      }

      const at = nowIso();
      const artifacts = request.artifacts ?? {};
      this.db
        .prepare(
          `INSERT INTO transitions (
            card_id,
            at,
            actor_kind,
            actor_id,
            from_column,
            to_column,
            decision_action,
            decision_logic_chain,
            decision_projected_impact,
            decision_reversible,
            artifact_branch,
            artifact_worktree_path,
            artifact_pr_url,
            artifact_test_report_url,
            artifact_coverage_delta
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          cardId,
          at,
          actor.kind,
          actor.id,
          request.from_column,
          request.to_column,
          request.decision_summary.action,
          request.decision_summary.logic_chain,
          request.decision_summary.projected_impact,
          request.decision_summary.reversible ? 1 : 0,
          artifacts.branch ?? null,
          artifacts.worktree_path ?? null,
          artifacts.pr_url ?? null,
          artifacts.test_report_url ?? null,
          artifacts.coverage_delta ?? null,
        );

      this.db
        .prepare("UPDATE cards SET column = ? WHERE id = ?")
        .run(request.to_column, cardId);

      this.logAudit(
        "transition",
        actor,
        cardId,
        {
          from: request.from_column,
          to: request.to_column,
          from_state: request.from_column,
          to_state: request.to_column,
          decision_summary: request.decision_summary,
          artifacts,
        },
      );

      return this.buildCard(cardId);
    });

    return transitionOperation();
  }

  addSignal(cardId: string, actor: Actor, payload: unknown): SignalRecord {
    const request = validateSignalRequest(payload);
    const card = this.buildCard(cardId);
    this.requireCardNotFrozen(card);
    requireAgentOwnership(card, actor);

    const at = nowIso();
    const compactionPayload = request.compaction_context
      ? JSON.stringify(request.compaction_context)
      : null;
    this.db
      .prepare(
        `INSERT INTO signals (
          card_id,
          at,
          actor_kind,
          actor_id,
          type,
          reason,
          context_snapshot_ref,
          compaction_context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cardId,
        at,
        actor.kind,
        actor.id,
        request.type,
        request.reason,
        request.context_snapshot_ref ?? null,
        compactionPayload,
      );

    const signal = this.db
      .prepare("SELECT * FROM signals WHERE card_id = ? ORDER BY id DESC LIMIT 1")
      .get(cardId);

    this.logAudit("signal", actor, cardId, {
      type: request.type,
      reason: request.reason,
      context_snapshot_ref: request.context_snapshot_ref,
    });

    return this.mapSignalRow(signal);
  }

  ackCard(cardId: string, actor: Actor, payload: unknown): AckRecord {
    const request = validateAckRequest(payload);
    const card = this.buildCard(cardId);
    this.requireCardNotFrozen(card);
    requireHuman(actor);

    const at = nowIso();
    this.db
      .prepare(
        "INSERT INTO acks (card_id, at, actor_kind, actor_id, verdict, notes) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        cardId,
        at,
        actor.kind,
        actor.id,
        request.verdict,
        request.notes ?? null,
      );

    this.logAudit("ack", actor, cardId, {
      verdict: request.verdict,
      notes: request.notes,
    });

    return {
      at,
      actor,
      verdict: request.verdict,
      notes: request.notes,
    };
  }

  createAttempt(
    parentCardId: string,
    actor: Actor,
    payload: unknown,
  ): Card {
    const request = validateAttemptRequest(payload);
    const parent = this.buildCard(parentCardId);
    this.requireCardNotFrozen(parent);
    requireAgentOwnership(parent, actor);
    this.ensureUniqueBranchAndWorktree(request);

    const attemptId = `${parentCardId}/attempt-${request.attempt_index}`;
    const exists =
      this.db
        .prepare("SELECT COUNT(*) as count FROM cards WHERE id = ?")
        .get(attemptId).count ?? 0;
    if (exists > 0) {
      throw new HttpError(409, `Attempt ${attemptId} already exists`);
    }

    this.db
      .prepare(
        `INSERT INTO cards (
          id,
          title,
          owner_agent_id,
          column,
          parent_card_id,
          attempt_index,
          strategy,
          branch,
          worktree_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attemptId,
        `${parent.title} (attempt ${request.attempt_index})`,
        parent.owner_agent_id,
        parent.column,
        parent.id,
        request.attempt_index,
        request.strategy,
        request.branch,
        request.worktree_path,
      );

    return this.buildCard(attemptId);
  }

  applyBoardVeto(actor: Actor, payload: unknown): BoardVeto {
    const request = validateVetoRequest(payload);
    requireHuman(actor);

    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO board_veto (scope, active, at, actor_kind, actor_id, reason)
         VALUES (?, 1, ?, ?, ?, ?)
         ON CONFLICT(scope) DO UPDATE SET
           active=1,
           at=excluded.at,
           actor_kind=excluded.actor_kind,
           actor_id=excluded.actor_id,
           reason=excluded.reason`,
      )
      .run(request.scope, at, actor.kind, actor.id, request.reason);

    this.logAudit("veto", actor, undefined, {
      reason: request.reason,
      scope: request.scope,
    });

    return {
      active: true,
      at,
      actor,
      reason: request.reason,
      scope: request.scope,
    };
  }

  private buildCard(cardId: string): Card {
    const row = this.requireCardRow(cardId);
    return this.buildCardFromRow(row);
  }

  private requireCardRow(cardId: string): any {
    const row = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
    if (!row) {
      throw new HttpError(404, `Card ${cardId} not found`);
    }
    return row;
  }

  private buildCardFromRow(row: any): Card {
    const transitions = this.db
      .prepare("SELECT * FROM transitions WHERE card_id = ? ORDER BY id ASC")
      .all(row.id)
      .map((transitionRow: any) => this.mapTransitionRow(transitionRow));

    const signals = this.db
      .prepare("SELECT * FROM signals WHERE card_id = ? ORDER BY id ASC")
      .all(row.id)
      .map((signalRow: any) => this.mapSignalRow(signalRow));

    const latestAckRow = this.db
      .prepare("SELECT * FROM acks WHERE card_id = ? ORDER BY id DESC LIMIT 1")
      .get(row.id);

    const latestHumanTransitionRow = this.db
      .prepare(
        "SELECT * FROM transitions WHERE card_id = ? AND actor_kind = 'human' ORDER BY id DESC LIMIT 1",
      )
      .get(row.id);

    const card: Card = {
      id: row.id,
      title: row.title,
      owner_agent_id: row.owner_agent_id,
      column: row.column,
      parent_card_id: row.parent_card_id ?? undefined,
      attempt_index: row.attempt_index ?? undefined,
      strategy: row.strategy ?? undefined,
      branch: row.branch ?? undefined,
      worktree_path: row.worktree_path ?? undefined,
      latest_ack: latestAckRow
        ? {
            at: latestAckRow.at,
            actor: {
              kind: latestAckRow.actor_kind as Actor["kind"],
              id: latestAckRow.actor_id,
            },
            verdict: latestAckRow.verdict,
            notes: latestAckRow.notes ?? undefined,
          }
        : undefined,
      latest_human_transition: latestHumanTransitionRow
        ? this.mapTransitionRow(latestHumanTransitionRow)
        : undefined,
      transitions,
      signals,
    };

    return structuredClone(card);
  }

  private mapTransitionRow(row: any): TransitionRecord {
    return {
      at: row.at,
      actor: {
        kind: row.actor_kind as Actor["kind"],
        id: row.actor_id,
      },
      from: row.from_column as CardColumn,
      to: row.to_column as CardColumn,
      decision_summary: {
        action: row.decision_action,
        logic_chain: row.decision_logic_chain,
        projected_impact: row.decision_projected_impact,
        reversible: Boolean(row.decision_reversible),
      },
      artifacts: {
        branch: row.artifact_branch ?? undefined,
        worktree_path: row.artifact_worktree_path ?? undefined,
        pr_url: row.artifact_pr_url ?? undefined,
        test_report_url: row.artifact_test_report_url ?? undefined,
        coverage_delta: row.artifact_coverage_delta ?? undefined,
      },
    };
  }

  private mapSignalRow(row: any): SignalRecord {
    return {
      at: row.at,
      actor: {
        kind: row.actor_kind as Actor["kind"],
        id: row.actor_id,
      },
      type: row.type as SignalRecord["type"],
      reason: row.reason,
      context_snapshot_ref: row.context_snapshot_ref ?? undefined,
      compaction_context: row.compaction_context
        ? (JSON.parse(row.compaction_context) as CompactionEventContext)
        : undefined,
    };
  }


  private requireCardNotFrozen(card: Card): void {
    if (card.signals.some((signal) => signal.type === "self_veto")) {
      throw new HttpError(423, `Card ${card.id} is frozen by self_veto`);
    }
  }

  private ensureUniqueBranchAndWorktree(request: AttemptRequest): void {
    this.assertUniqueColumnValue("branch", request.branch, "Branch");
    this.assertUniqueColumnValue("worktree_path", request.worktree_path, "Worktree path");
  }

  private assertUniqueColumnValue(
    column: "branch" | "worktree_path",
    value: string,
    label: string,
  ): void {
    const row = this.db
      .prepare(`SELECT id FROM cards WHERE ${column} = ? LIMIT 1`)
      .get(value);
    if (row) {
      throw new HttpError(409, `${label} ${value} already used by card ${row.id}`);
    }
  }

  private logAudit(
    event: string,
    actor: Actor,
    cardId: string | undefined,
    details: Record<string, unknown>
  ): void {
    this.db
      .prepare(
        "INSERT INTO audit_events (at, actor_kind, actor_id, event, card_id, details) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        nowIso(),
        actor.kind,
        actor.id,
        event,
        cardId ?? null,
        JSON.stringify(details),
      );
  }

  private seedCards(cards: Card[]): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO cards (
        id,
        title,
        owner_agent_id,
        column,
        parent_card_id,
        attempt_index,
        strategy,
        branch,
        worktree_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const transaction = this.db.transaction((entries: Card[]) => {
      for (const card of entries) {
        insert.run(
          card.id,
          card.title,
          card.owner_agent_id,
          card.column,
          card.parent_card_id ?? null,
          card.attempt_index ?? null,
          card.strategy ?? null,
          card.branch ?? null,
          card.worktree_path ?? null,
        );
      }
    });

    transaction(cards);
  }
}
