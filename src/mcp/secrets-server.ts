import { HttpError, type KanbanStore } from "../store.js";
import type { Actor } from "../types.js";

export interface StagingDeployRequest {
  card_id: string;
  target_env?: string;
}

export interface StagingDeployTicket {
  tool: "request_staging_deploy";
  status: "accepted";
  card_id: string;
  target_env: string;
  ticket_id: string;
}

export class MCPSecretsServerStub {
  constructor(private readonly store: KanbanStore) {}

  requestStagingDeploy(actor: Actor, payload: unknown): StagingDeployTicket {
    // L1: authenticated actor is passed in from HTTP middleware.
    if (actor.kind !== "agent") {
      throw new HttpError(403, "Only agents can request staging deploy");
    }

    const request = this.validateRequest(payload);
    const card = this.store.getCard(request.card_id);

    // L2: ownership and integration-column gating.
    if (card.owner_agent_id !== actor.id) {
      throw new HttpError(403, `Agent ${actor.id} does not own card ${card.id}`);
    }
    if (card.column !== "integration") {
      throw new HttpError(409, "request_staging_deploy is only callable in integration column");
    }

    // L3: freeze checks (self_veto).
    if (card.signals.some((signal) => signal.type === "self_veto")) {
      throw new HttpError(423, `Card ${card.id} is frozen by self_veto`);
    }

    // L4: requires explicit human approval to avoid self-approval loops.
    if (!card.latest_ack || card.latest_ack.verdict !== "approve") {
      throw new HttpError(409, "Human approval ACK is required before requesting staging deploy");
    }

    // L5: secret redaction by design: return ticket metadata only.
    return {
      tool: "request_staging_deploy",
      status: "accepted",
      card_id: card.id,
      target_env: request.target_env,
      ticket_id: `stg_${card.id}_${Date.now()}`,
    };
  }

  private validateRequest(payload: unknown): Required<StagingDeployRequest> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new HttpError(400, "request body must be an object");
    }
    const entry = payload as Record<string, unknown>;
    const cardId = entry.card_id;
    const targetEnv = entry.target_env;
    if (typeof cardId !== "string" || cardId.trim() === "") {
      throw new HttpError(400, "card_id must be a non-empty string");
    }
    if (targetEnv != null && (typeof targetEnv !== "string" || targetEnv.trim() === "")) {
      throw new HttpError(400, "target_env must be a non-empty string");
    }
    return {
      card_id: cardId,
      target_env: typeof targetEnv === "string" ? targetEnv : "staging",
    };
  }
}
