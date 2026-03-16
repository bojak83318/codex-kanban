import type { Actor } from "./types.js";
import { HttpError } from "./store.js";

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

export interface TokenDefinition {
  token: string;
  actor: Actor;
}

export class TokenRegistry {
  private readonly actorsByToken = new Map<string, Actor>();

  constructor(definitions: TokenDefinition[]) {
    for (const definition of definitions) {
      if (!definition.token) {
        throw new Error("Token value cannot be empty");
      }
      this.actorsByToken.set(definition.token, definition.actor);
    }
  }

  resolve(token: string): Actor | undefined {
    return this.actorsByToken.get(token);
  }

  ensure(actorToken: string | undefined): Actor {
    if (!actorToken) {
      throw new HttpError(401, "Missing Authorization header");
    }

    const match = BEARER_PREFIX.exec(actorToken);
    if (!match) {
      throw new HttpError(401, "Authorization header must be a Bearer token");
    }

    const token = match[1].trim();
    if (token === "") {
      throw new HttpError(401, "Bearer token cannot be empty");
    }

    const actor = this.resolve(token);
    if (!actor) {
      throw new HttpError(403, "Invalid auth token");
    }

    return actor;
  }
}

const DEFAULT_AGENT_ID = process.env.KANBAN_AGENT_ID ?? "agent-42";
const DEFAULT_AGENT_TOKEN = process.env.KANBAN_AGENT_TOKEN ?? "dev-agent-token";
const DEFAULT_HUMAN_ID = process.env.KANBAN_HUMAN_ID ?? "reviewer-1";
const DEFAULT_HUMAN_TOKEN = process.env.KANBAN_HUMAN_TOKEN ?? "dev-human-token";

function parseEnvTokens(value: string | undefined, kind: Actor["kind"]): TokenDefinition[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf(":");
      if (index < 0) {
        throw new Error(
          `Invalid KANBAN_${kind.toUpperCase()}_TOKENS entry for index ${entry.indexOf(":")}; expected format <id>:<token> (entry redacted)`,
        );
      }

      const id = entry.slice(0, index).trim();
      const token = entry.slice(index + 1).trim();
      if (!id || !token) {
        throw new Error(
          `Invalid KANBAN_${kind.toUpperCase()}_TOKENS entry (redacted); id and token are required`,
        );
      }

      return {
        token,
        actor: { kind, id },
      };
    });
}

export function buildTokenRegistryFromEnv(): TokenRegistry {
  const entries: TokenDefinition[] = [];
  entries.push(...parseEnvTokens(process.env.KANBAN_AGENT_TOKENS, "agent"));
  entries.push({ token: DEFAULT_AGENT_TOKEN, actor: { kind: "agent", id: DEFAULT_AGENT_ID } });
  entries.push(...parseEnvTokens(process.env.KANBAN_HUMAN_TOKENS, "human"));
  entries.push({ token: DEFAULT_HUMAN_TOKEN, actor: { kind: "human", id: DEFAULT_HUMAN_ID } });
  return new TokenRegistry(entries);
}

export const DEFAULT_AGENT_TOKEN_VALUE = DEFAULT_AGENT_TOKEN;
export const DEFAULT_HUMAN_TOKEN_VALUE = DEFAULT_HUMAN_TOKEN;
