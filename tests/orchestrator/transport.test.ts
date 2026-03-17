import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { CodexMcpTransport } from "../../src/orchestrator/codex-mcp-transport.js";
import { OpenAIAgentTransport } from "../../src/orchestrator/agents-sdk-transport.js";

let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
    }) as unknown as typeof fetch;
  });

afterEach(() => {
  if (originalFetch) {
    global.fetch = originalFetch;
  }
  vi.restoreAllMocks();
});

describe("transports", () => {
  test("OpenAIAgentTransport sends structured payload when transition is present", async () => {
    const transport = new OpenAIAgentTransport({ apiKey: "openaikey", model: "test-model" });

    await transport.run({
      instructions: "run this agent",
      transitionPayload: {
        from_column: "in_progress",
        to_column: "human_review",
        decision_summary: {
          action: "action",
          logic_chain: "chain",
          projected_impact: "impact",
          reversible: true,
        },
      },
      lineage: { parentCardId: "T-1", attemptIndex: 1 },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchMock = global.fetch as Mock;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/agents/test-model/runs");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer openaikey",
    });

    const body = JSON.parse(init.body as string);
    expect(body.instructions).toBe("run this agent");
    expect(body.metadata).toEqual({ lineage: { parentCardId: "T-1", attemptIndex: 1 } });
    expect(body.inputs).toHaveLength(1);
    expect(body.inputs[0]).toMatchObject({
      role: "user",
      name: "transition_payload",
      type: "application/json",
    });
  });

  test("OpenAIAgentTransport sends empty inputs when transition is null", async () => {
    const transport = new OpenAIAgentTransport({ apiKey: "openaikey", model: "test-model" });

    await transport.run({
      instructions: "no transition",
      transitionPayload: null,
      lineage: { parentCardId: "T-2", attemptIndex: 2 },
    });

    const fetchMock = global.fetch as Mock;
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.inputs).toEqual([]);
  });

  test("CodexMcpTransport posts to MCP with payload and lineage", async () => {
    const transport = new CodexMcpTransport({ mcpServerUrl: "http://mcp-server", authToken: "token-1" });

    await transport.run({
      instructions: "mcp run",
      transitionPayload: null,
      lineage: { parentCardId: "T-3", attemptIndex: 3 },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchMock = global.fetch as Mock;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://mcp-server/runs");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer token-1",
    });
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      instructions: "mcp run",
      payload: null,
      lineage: { parentCardId: "T-3", attemptIndex: 3 },
    });
  });
});
