import { createServer } from "node:http";
import { URL } from "node:url";
import { HttpError, InMemoryKanbanStore } from "./store.js";
function json(response, statusCode, payload) {
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(`${JSON.stringify(payload)}\n`);
}
function notFound(response) {
    json(response, 404, { error: "Not found" });
}
function parseActor(request) {
    const agentId = request.headers["x-agent-id"];
    const humanId = request.headers["x-human-id"];
    if (typeof agentId === "string" && agentId.trim() !== "") {
        return { kind: "agent", id: agentId };
    }
    if (typeof humanId === "string" && humanId.trim() !== "") {
        return { kind: "human", id: humanId };
    }
    throw new HttpError(401, "Missing x-agent-id or x-human-id header");
}
async function readJsonBody(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) {
        return {};
    }
    const body = Buffer.concat(chunks).toString("utf-8");
    try {
        return JSON.parse(body);
    }
    catch {
        throw new HttpError(400, "Request body must be valid JSON");
    }
}
function serializeCard(card) {
    return structuredClone(card);
}
export function createApp(options = {}) {
    const store = options.store ?? new InMemoryKanbanStore();
    const server = createServer(async (request, response) => {
        if (!request.url || !request.method) {
            notFound(response);
            return;
        }
        const url = new URL(request.url, "http://localhost");
        const pathname = url.pathname;
        try {
            if (request.method === "GET" && pathname === "/api/v1/cards") {
                const agentId = url.searchParams.get("agent_id") ?? undefined;
                const columnsValue = url.searchParams.get("columns") ?? undefined;
                const columns = columnsValue
                    ? columnsValue.split(",").map((entry) => entry.trim()).filter(Boolean)
                    : undefined;
                const cards = store.listCards({ agentId, columns }).map(serializeCard);
                json(response, 200, { cards });
                return;
            }
            const transitionMatch = pathname.match(/^\/api\/v1\/cards\/([^/]+)\/transition$/);
            if (request.method === "POST" && transitionMatch) {
                const actor = parseActor(request);
                const body = await readJsonBody(request);
                const card = store.transitionCard(transitionMatch[1], actor, body);
                json(response, 200, { card: serializeCard(card) });
                return;
            }
            const signalMatch = pathname.match(/^\/api\/v1\/cards\/([^/]+)\/signals$/);
            if (request.method === "POST" && signalMatch) {
                const actor = parseActor(request);
                const body = await readJsonBody(request);
                const signal = store.addSignal(signalMatch[1], actor, body);
                json(response, 201, { signal });
                return;
            }
            const ackMatch = pathname.match(/^\/api\/v1\/cards\/([^/]+)\/ack$/);
            if (request.method === "POST" && ackMatch) {
                const actor = parseActor(request);
                const body = await readJsonBody(request);
                const ack = store.ackCard(ackMatch[1], actor, body);
                json(response, 200, { ack });
                return;
            }
            const attemptMatch = pathname.match(/^\/api\/v1\/cards\/([^/]+)\/attempts$/);
            if (request.method === "POST" && attemptMatch) {
                const actor = parseActor(request);
                const body = await readJsonBody(request);
                const attemptCard = store.createAttempt(attemptMatch[1], actor, body);
                json(response, 201, { card: serializeCard(attemptCard) });
                return;
            }
            if (request.method === "POST" && pathname === "/api/v1/board/veto") {
                const actor = parseActor(request);
                const body = await readJsonBody(request);
                const veto = store.applyBoardVeto(actor, body);
                json(response, 200, { veto });
                return;
            }
            notFound(response);
        }
        catch (error) {
            if (error instanceof HttpError) {
                json(response, error.statusCode, { error: error.message });
                return;
            }
            json(response, 500, { error: "Internal server error" });
        }
    });
    return { server, store };
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const port = Number(process.env.PORT ?? "3000");
    const { server } = createApp();
    server.listen(port, () => {
        process.stdout.write(`codex-kanban listening on http://127.0.0.1:${port}\n`);
    });
}
