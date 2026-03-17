import { AgentTransport } from "./agents-sdk-adapter.js";
import type { TransitionRequest } from "../types.js";

export interface CodexMcpTransportOptions {
  mcpServerUrl: string;
  authToken: string;
}

export class CodexMcpTransport implements AgentTransport {
  private readonly endpoint: string;
  constructor(private readonly options: CodexMcpTransportOptions) {
    this.endpoint = `${options.mcpServerUrl.replace(/\/+$/, "")}/runs`;
  }

  async run(params: {
    instructions: string;
    transitionPayload: TransitionRequest | null;
    lineage: { parentCardId: string; attemptIndex: number };
  }): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${this.options.authToken}`,
      },
      body: JSON.stringify({
        instructions: params.instructions,
        payload: params.transitionPayload,
        lineage: params.lineage,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MCP run failed: ${response.status} ${response.statusText} - ${text}`);
    }
  }
}
