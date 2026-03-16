import { createApp, InMemoryKanbanStore } from "../src/index.js";
function seedCard(overrides = {}) {
    return {
        id: "T-42",
        title: "Implement transition gate",
        owner_agent_id: "agent-42",
        column: "in_progress",
        transitions: [],
        signals: [],
        ...overrides,
    };
}
async function startServer(cards = []) {
    const store = new InMemoryKanbanStore(cards);
    const { server } = createApp({ store });
    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    async function request(path, init = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            ...init,
            headers: {
                "content-type": "application/json",
                ...(init.headers ?? {}),
            },
        });
        return {
            status: response.status,
            body: await response.json(),
        };
    }
    return {
        request,
        close: async () => {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        },
    };
}
describe("codex-kanban api", () => {
    test("filters cards by agent and columns", async () => {
        const app = await startServer([
            seedCard(),
            seedCard({
                id: "T-43",
                owner_agent_id: "agent-43",
                column: "backlog",
            }),
            seedCard({
                id: "T-44",
                column: "human_review",
            }),
        ]);
        try {
            const response = await app.request("/api/v1/cards?agent_id=agent-42&columns=in_progress,human_review");
            expect(response.status).toBe(200);
            expect(response.body.cards).toHaveLength(2);
            expect(response.body.cards.map((card) => card.id)).toEqual(["T-42", "T-44"]);
        }
        finally {
            await app.close();
        }
    });
    test("agent can transition to human_review but not integration", async () => {
        const app = await startServer([seedCard()]);
        try {
            const first = await app.request("/api/v1/cards/T-42/transition", {
                method: "POST",
                headers: { "x-agent-id": "agent-42" },
                body: JSON.stringify({
                    from_column: "in_progress",
                    to_column: "human_review",
                    decision_summary: {
                        action: "Implemented slice",
                        logic_chain: "State machine and tests are in place",
                        projected_impact: "Local package only",
                        reversible: true,
                    },
                    artifacts: {
                        branch: "vk/T-42",
                        worktree_path: "./agents/T-42",
                    },
                }),
            });
            expect(first.status).toBe(200);
            expect(first.body.card.column).toBe("human_review");
            const second = await app.request("/api/v1/cards/T-42/transition", {
                method: "POST",
                headers: { "x-agent-id": "agent-42" },
                body: JSON.stringify({
                    from_column: "human_review",
                    to_column: "integration",
                    decision_summary: {
                        action: "Tried to self-approve",
                        logic_chain: "Should fail",
                        projected_impact: "Would bypass review",
                        reversible: false,
                    },
                }),
            });
            expect(second.status).toBe(409);
            expect(second.body.error).toContain("agent cannot move card");
        }
        finally {
            await app.close();
        }
    });
    test("human approval is required before integration", async () => {
        const app = await startServer([
            seedCard({
                column: "human_review",
            }),
        ]);
        try {
            const blocked = await app.request("/api/v1/cards/T-42/transition", {
                method: "POST",
                headers: { "x-human-id": "reviewer-1" },
                body: JSON.stringify({
                    from_column: "human_review",
                    to_column: "integration",
                    decision_summary: {
                        action: "Promote",
                        logic_chain: "Looks fine",
                        projected_impact: "Integration",
                        reversible: true,
                    },
                }),
            });
            expect(blocked.status).toBe(409);
            expect(blocked.body.error).toContain("Human approval is required");
            const ack = await app.request("/api/v1/cards/T-42/ack", {
                method: "POST",
                headers: { "x-human-id": "reviewer-1" },
                body: JSON.stringify({
                    verdict: "approve",
                    notes: "Proceed to integration",
                }),
            });
            expect(ack.status).toBe(200);
            expect(ack.body.ack.verdict).toBe("approve");
            const promoted = await app.request("/api/v1/cards/T-42/transition", {
                method: "POST",
                headers: { "x-human-id": "reviewer-1" },
                body: JSON.stringify({
                    from_column: "human_review",
                    to_column: "integration",
                    decision_summary: {
                        action: "Promote",
                        logic_chain: "Approved review",
                        projected_impact: "Integration branch unblocked",
                        reversible: true,
                    },
                }),
            });
            expect(promoted.status).toBe(200);
            expect(promoted.body.card.column).toBe("integration");
        }
        finally {
            await app.close();
        }
    });
    test("agent can emit signals and spawn attempts for owned cards", async () => {
        const app = await startServer([seedCard()]);
        try {
            const signal = await app.request("/api/v1/cards/T-42/signals", {
                method: "POST",
                headers: { "x-agent-id": "agent-42" },
                body: JSON.stringify({
                    type: "blocked",
                    reason: "Waiting on reviewer",
                    context_snapshot_ref: "snap://session-1/turn-8",
                }),
            });
            expect(signal.status).toBe(201);
            expect(signal.body.signal.type).toBe("blocked");
            const attempt = await app.request("/api/v1/cards/T-42/attempts", {
                method: "POST",
                headers: { "x-agent-id": "agent-42" },
                body: JSON.stringify({
                    attempt_index: 2,
                    strategy: "tdd_first",
                    branch: "vk/T-42-attempt-2",
                    worktree_path: "./agents/T-42-attempt-2",
                }),
            });
            expect(attempt.status).toBe(201);
            expect(attempt.body.card.parent_card_id).toBe("T-42");
            expect(attempt.body.card.strategy).toBe("tdd_first");
        }
        finally {
            await app.close();
        }
    });
    test("board veto is human-only", async () => {
        const app = await startServer([seedCard()]);
        try {
            const denied = await app.request("/api/v1/board/veto", {
                method: "POST",
                headers: { "x-agent-id": "agent-42" },
                body: JSON.stringify({
                    reason: "Stop work",
                    scope: "all",
                }),
            });
            expect(denied.status).toBe(403);
            const allowed = await app.request("/api/v1/board/veto", {
                method: "POST",
                headers: { "x-human-id": "reviewer-1" },
                body: JSON.stringify({
                    reason: "Incident in integration",
                    scope: "column:integration",
                }),
            });
            expect(allowed.status).toBe(200);
            expect(allowed.body.veto.active).toBe(true);
            expect(allowed.body.veto.scope).toBe("column:integration");
        }
        finally {
            await app.close();
        }
    });
});
