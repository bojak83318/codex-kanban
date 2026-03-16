import { type AckRecord, type Actor, type BoardVeto, type Card, type SignalRecord } from "./types.js";
export declare class HttpError extends Error {
    readonly statusCode: number;
    constructor(statusCode: number, message: string);
}
export declare class InMemoryKanbanStore {
    private readonly state;
    constructor(seedCards?: Card[]);
    listCards(filters: {
        agentId?: string;
        columns?: string[];
    }): Card[];
    transitionCard(cardId: string, actor: Actor, payload: unknown): Card;
    addSignal(cardId: string, actor: Actor, payload: unknown): SignalRecord;
    ackCard(cardId: string, actor: Actor, payload: unknown): AckRecord;
    createAttempt(parentCardId: string, actor: Actor, payload: unknown): Card;
    applyBoardVeto(actor: Actor, payload: unknown): BoardVeto;
}
