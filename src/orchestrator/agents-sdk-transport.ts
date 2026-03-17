import { AgentTransport } from "./agents-sdk-adapter.js";
import type { TransitionRequest } from "../types.js";

export interface OpenAIAgentTransportOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class OpenAIAgentTransport implements AgentTransport {
  private readonly endpoint: string;
  constructor(private readonly options: OpenAIAgentTransportOptions) {
    const base = options.baseUrl?.replace(/\/+$/, "") ?? "https://api.openai.com";
    this.endpoint = `${base}/v1/agents/${options.model}/runs`;
  }

  async run(params: {
    instructions: string;
    transitionPayload: TransitionRequest | null;
    lineage: { parentCardId: string; attemptIndex: number };
  }): Promise<void> {
    const inputs = params.transitionPayload
      ? [
          {
            role: "user",
            name: "transition_payload",
            type: "application/json",
            content: JSON.stringify(params.transitionPayload),
          },
        ]
      : [];

    const body = {
      instructions: params.instructions,
      metadata: {
        lineage: params.lineage,
      },
      inputs,
    };

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI Agents run failed: ${response.status} ${response.statusText} - ${text}`);
    }
  }
}
