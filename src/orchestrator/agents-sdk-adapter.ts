import type { MultiAgentExecutor, MultiAgentSpawnPlan } from "./multi-agent.js";
import type { TransitionRequest } from "../types.js";

export interface AgentTransport {
  run(params: {
    instructions: string;
    transitionPayload: TransitionRequest | null;
    lineage: {
      parentCardId: string;
      attemptIndex: number;
    };
  }): Promise<void>;
}

export class AgentsSdkAdapter {
  constructor(private transport: AgentTransport) {}

  async execute(plan: MultiAgentSpawnPlan): Promise<void> {
    await this.transport.run({
      instructions: plan.instructions,
      transitionPayload: plan.transitionPayload ?? null,
      lineage: plan.lineage,
    });
  }
}
