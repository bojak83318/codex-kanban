import type { MultiAgentOrchestrator, MultiAgentRunResult } from "./multi-agent.js";
import { AgentsSdkAdapter, type AgentTransport } from "./agents-sdk-adapter.js";
import { HOTLNotifierStub } from "./hotl.js";

export class McpOrchestrationHandler {
  constructor(private orchestrator: MultiAgentOrchestrator) {}

  async runBatch(
    cardIds: string[],
    transport: AgentTransport,
    notifier?: HOTLNotifierStub,
  ): Promise<MultiAgentRunResult[]> {
    const adapter = new AgentsSdkAdapter(transport);
    return this.orchestrator.runParallelAgents(
      { cardIds, notifier },
      (plan) => adapter.execute(plan),
    );
  }
}
