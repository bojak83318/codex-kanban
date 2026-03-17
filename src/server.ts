import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { HttpError, InMemoryKanbanStore, type KanbanStore } from "./store.js";
import { buildTokenRegistryFromEnv, type TokenRegistry } from "./auth.js";
import type { Actor, Card } from "./types.js";
import { MCPSecretsServerStub } from "./mcp/secrets-server.js";

function json(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

function notFound(response: ServerResponse): void {
  json(response, 404, { error: "Not found" });
}

function parseActor(request: IncomingMessage, auth: TokenRegistry): Actor {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return auth.ensure(value);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const body = Buffer.concat(chunks).toString("utf-8");
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function serializeCard(card: Card): Card {
  return structuredClone(card);
}

export interface AppOptions {
  store?: KanbanStore;
  auth?: TokenRegistry;
}

export function createApp(options: AppOptions = {}) {
  const store: KanbanStore = options.store ?? new InMemoryKanbanStore();
  const auth = options.auth ?? buildTokenRegistryFromEnv();
  const secretsServer = new MCPSecretsServerStub(store);

  const server = createServer(async (request, response) => {
    if (!request.url || !request.method) {
      notFound(response);
      return;
    }

    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname;

    try {
      if (request.method === "GET" && pathname === "/api/v1/cards") {
        const actor = parseActor(request, auth);
        const agentId =
          url.searchParams.get("agent_id") ??
          (actor.kind === "agent" ? actor.id : undefined);
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
        const actor = parseActor(request, auth);
        const body = await readJsonBody(request);
        const card = store.transitionCard(transitionMatch[1], actor, body);
        json(response, 200, { card: serializeCard(card) });
        return;
      }

      const signalMatch = pathname.match(/^\/api\/v1\/cards\/([^/]+)\/signals$/);
      if (request.method === "POST" && signalMatch) {
        const actor = parseActor(request, auth);
        const body = await readJsonBody(request);
        const signal = store.addSignal(signalMatch[1], actor, body);
        json(response, 201, { signal });
        return;
      }

      const ackMatch = pathname.match(/^\/api\/v1\/cards\/([^/]+)\/ack$/);
      if (request.method === "POST" && ackMatch) {
        const actor = parseActor(request, auth);
        const body = await readJsonBody(request);
        const ack = store.ackCard(ackMatch[1], actor, body);
        json(response, 200, { ack });
        return;
      }

      const attemptMatch = pathname.match(/^\/api\/v1\/cards\/([^/]+)\/attempts$/);
      if (request.method === "POST" && attemptMatch) {
        const actor = parseActor(request, auth);
        const body = await readJsonBody(request);
        const attemptCard = store.createAttempt(attemptMatch[1], actor, body);
        json(response, 201, { card: serializeCard(attemptCard) });
        return;
      }


      if (request.method === "POST" && pathname === "/api/v1/mcp/request_staging_deploy") {
        const actor = parseActor(request, auth);
        const body = await readJsonBody(request);
        const ticket = secretsServer.requestStagingDeploy(actor, body);
        json(response, 202, { ticket });
        return;
      }

      if (request.method === "POST" && pathname === "/api/v1/board/veto") {
        const actor = parseActor(request, auth);
        const body = await readJsonBody(request);
        const veto = store.applyBoardVeto(actor, body);
        json(response, 200, { veto });
        return;
      }

      notFound(response);
    } catch (error) {
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
