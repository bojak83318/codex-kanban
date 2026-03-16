import { ACK_VERDICTS, ATTEMPT_STRATEGIES, CARD_COLUMNS, SIGNAL_TYPES, } from "./types.js";
export class HttpError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
    }
}
const AGENT_TRANSITIONS = {
    backlog: ["spec_review"],
    spec_review: ["in_progress"],
    in_progress: ["human_review"],
    human_review: [],
    integration: [],
    done: [],
    rejected: ["backlog"],
};
const HUMAN_TRANSITIONS = {
    backlog: [],
    spec_review: [],
    in_progress: [],
    human_review: ["integration", "rejected", "backlog"],
    integration: ["done", "rejected"],
    done: [],
    rejected: ["backlog"],
};
function nowIso() {
    return new Date().toISOString();
}
function assertObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new HttpError(400, `${label} must be an object`);
    }
    return value;
}
function assertString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new HttpError(400, `${label} must be a non-empty string`);
    }
    return value;
}
function assertBoolean(value, label) {
    if (typeof value !== "boolean") {
        throw new HttpError(400, `${label} must be a boolean`);
    }
    return value;
}
function assertNumber(value, label) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new HttpError(400, `${label} must be a number`);
    }
    return value;
}
function assertEnum(value, allowed, label) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        throw new HttpError(400, `${label} must be one of: ${allowed.join(", ")}`);
    }
    return value;
}
function requireCard(state, cardId) {
    const card = state.cards.get(cardId);
    if (!card) {
        throw new HttpError(404, `Card ${cardId} not found`);
    }
    return card;
}
function requireAgentOwnership(card, actor) {
    if (actor.kind !== "agent") {
        throw new HttpError(403, "Agent identity required");
    }
    if (card.owner_agent_id !== actor.id) {
        throw new HttpError(403, `Agent ${actor.id} does not own card ${card.id}`);
    }
}
function requireHuman(actor) {
    if (actor.kind !== "human") {
        throw new HttpError(403, "Human identity required");
    }
}
function validateDecisionSummary(value) {
    const record = assertObject(value, "decision_summary");
    return {
        action: assertString(record.action, "decision_summary.action"),
        logic_chain: assertString(record.logic_chain, "decision_summary.logic_chain"),
        projected_impact: assertString(record.projected_impact, "decision_summary.projected_impact"),
        reversible: assertBoolean(record.reversible, "decision_summary.reversible"),
    };
}
function validateTransitionRequest(value) {
    const record = assertObject(value, "transition request");
    return {
        from_column: assertEnum(record.from_column, CARD_COLUMNS, "from_column"),
        to_column: assertEnum(record.to_column, CARD_COLUMNS, "to_column"),
        decision_summary: validateDecisionSummary(record.decision_summary),
        artifacts: record.artifacts == null
            ? {}
            : assertObject(record.artifacts, "artifacts"),
    };
}
function validateSignalRequest(value) {
    const record = assertObject(value, "signal request");
    const contextSnapshot = record.context_snapshot_ref;
    return {
        type: assertEnum(record.type, SIGNAL_TYPES, "type"),
        reason: assertString(record.reason, "reason"),
        context_snapshot_ref: contextSnapshot == null
            ? undefined
            : assertString(contextSnapshot, "context_snapshot_ref"),
    };
}
function validateAckRequest(value) {
    const record = assertObject(value, "ack request");
    const notes = record.notes;
    return {
        verdict: assertEnum(record.verdict, ACK_VERDICTS, "verdict"),
        notes: notes == null ? undefined : assertString(notes, "notes"),
    };
}
function validateAttemptRequest(value) {
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
function validateVetoRequest(value) {
    const record = assertObject(value, "veto request");
    return {
        reason: assertString(record.reason, "reason"),
        scope: assertString(record.scope, "scope"),
    };
}
export class InMemoryKanbanStore {
    state;
    constructor(seedCards = []) {
        this.state = {
            cards: new Map(seedCards.map((card) => [card.id, structuredClone(card)])),
        };
    }
    listCards(filters) {
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
    transitionCard(cardId, actor, payload) {
        const request = validateTransitionRequest(payload);
        const card = requireCard(this.state, cardId);
        if (card.column !== request.from_column) {
            throw new HttpError(409, `Card ${card.id} is in ${card.column}, not ${request.from_column}`);
        }
        const transitions = actor.kind === "agent" ? AGENT_TRANSITIONS[card.column] : HUMAN_TRANSITIONS[card.column];
        if (!transitions.includes(request.to_column)) {
            throw new HttpError(409, `${actor.kind} cannot move card from ${card.column} to ${request.to_column}`);
        }
        if (actor.kind === "agent") {
            requireAgentOwnership(card, actor);
            if (request.to_column === "integration" ||
                request.to_column === "done") {
                throw new HttpError(403, "Agent cannot self-transition past human_review");
            }
        }
        else {
            requireHuman(actor);
            if (card.column === "human_review" && request.to_column === "integration") {
                if (!card.latest_ack || card.latest_ack.verdict !== "approve") {
                    throw new HttpError(409, "Human approval is required before integration");
                }
            }
        }
        const transition = {
            at: nowIso(),
            actor,
            from: request.from_column,
            to: request.to_column,
            decision_summary: request.decision_summary,
            artifacts: request.artifacts ?? {},
        };
        card.column = request.to_column;
        card.transitions.push(transition);
        if (actor.kind === "human") {
            card.latest_human_transition = transition;
        }
        return structuredClone(card);
    }
    addSignal(cardId, actor, payload) {
        const request = validateSignalRequest(payload);
        const card = requireCard(this.state, cardId);
        requireAgentOwnership(card, actor);
        const signal = {
            at: nowIso(),
            actor,
            type: request.type,
            reason: request.reason,
            context_snapshot_ref: request.context_snapshot_ref,
        };
        card.signals.push(signal);
        return structuredClone(signal);
    }
    ackCard(cardId, actor, payload) {
        requireHuman(actor);
        const request = validateAckRequest(payload);
        const card = requireCard(this.state, cardId);
        const ack = {
            at: nowIso(),
            actor,
            verdict: request.verdict,
            notes: request.notes,
        };
        card.latest_ack = ack;
        return structuredClone(ack);
    }
    createAttempt(parentCardId, actor, payload) {
        const request = validateAttemptRequest(payload);
        const parent = requireCard(this.state, parentCardId);
        requireAgentOwnership(parent, actor);
        const attemptId = `${parentCardId}/attempt-${request.attempt_index}`;
        if (this.state.cards.has(attemptId)) {
            throw new HttpError(409, `Attempt ${attemptId} already exists`);
        }
        const attemptCard = {
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
    applyBoardVeto(actor, payload) {
        requireHuman(actor);
        const request = validateVetoRequest(payload);
        const veto = {
            active: true,
            at: nowIso(),
            actor,
            reason: request.reason,
            scope: request.scope,
        };
        this.state.boardVeto = veto;
        return structuredClone(veto);
    }
}
