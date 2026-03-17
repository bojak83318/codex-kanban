import { createHmac, timingSafeEqual } from "node:crypto";
import type { Actor } from "./types.js";
import { HttpError } from "./store.js";

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

function readJwtSecretFromEnv(): string | undefined {
  return process.env.KANBAN_JWT_SECRET;
}

function requireJwtSecret(jwtSecret: string | undefined): string {
  if (!jwtSecret) {
    throw new Error("KANBAN_JWT_SECRET must be set");
  }
  return jwtSecret;
}

interface JwtPayload {
  sub: string;
  kind: Actor["kind"];
  iat: number;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf-8");
}

function signPart(headerB64: string, payloadB64: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
}

function parseJwt(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "Bearer token must be a JWT");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const expectedSignature = signPart(headerB64, payloadB64, secret);
  const actual = Buffer.from(signatureB64, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new HttpError(403, "Invalid auth token signature");
  }

  const header = JSON.parse(base64UrlDecode(headerB64));
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new HttpError(401, "Unsupported JWT header");
  }

  const payload = JSON.parse(base64UrlDecode(payloadB64)) as Partial<JwtPayload>;
  if (!payload.sub || (payload.kind !== "agent" && payload.kind !== "human")) {
    throw new HttpError(401, "Invalid JWT claims");
  }

  return {
    sub: payload.sub,
    kind: payload.kind,
    iat: typeof payload.iat === "number" ? payload.iat : 0,
  };
}

function signJwt(actor: Actor, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: actor.id,
      kind: actor.kind,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const signature = signPart(header, payload, secret);
  return `${header}.${payload}.${signature}`;
}

export class TokenRegistry {
  private readonly jwtSecret: string;

  constructor(jwtSecret: string | undefined) {
    this.jwtSecret = requireJwtSecret(jwtSecret);
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

    const payload = parseJwt(token, this.jwtSecret);
    return { kind: payload.kind, id: payload.sub };
  }
}

const DEFAULT_AGENT_ID = process.env.KANBAN_AGENT_ID ?? "agent-42";
const DEFAULT_HUMAN_ID = process.env.KANBAN_HUMAN_ID ?? "reviewer-1";

export function buildTokenRegistryFromEnv(): TokenRegistry {
  return new TokenRegistry(readJwtSecretFromEnv());
}

export function DEFAULT_AGENT_TOKEN_VALUE(): string {
  return signJwt(
    { kind: "agent", id: DEFAULT_AGENT_ID },
    requireJwtSecret(readJwtSecretFromEnv()),
  );
}

export function DEFAULT_HUMAN_TOKEN_VALUE(): string {
  return signJwt(
    { kind: "human", id: DEFAULT_HUMAN_ID },
    requireJwtSecret(readJwtSecretFromEnv()),
  );
}
