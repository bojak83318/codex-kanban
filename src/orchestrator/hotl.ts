import type { Card, TransitionRecord } from "../types.js";

export interface HOTLNotification {
  cardId: string;
  title: string;
  ownerAgentId: string;
  column: string;
  priority: "normal" | "priority_review";
  summary: string;
  transitionAt: string;
}

export class HOTLNotifierStub {
  private readonly notifications: HOTLNotification[] = [];

  notifyHumanReview(card: Card, transition: TransitionRecord): HOTLNotification {
    const notification: HOTLNotification = {
      cardId: card.id,
      title: card.title,
      ownerAgentId: card.owner_agent_id,
      column: card.column,
      priority: transition.decision_summary.reversible ? "normal" : "priority_review",
      summary: [
        `card=${card.id}`,
        `action=${transition.decision_summary.action}`,
        `impact=${transition.decision_summary.projected_impact}`,
      ].join(" "),
      transitionAt: transition.at,
    };
    this.notifications.push(notification);
    return notification;
  }

  getNotifications(): HOTLNotification[] {
    return this.notifications.map((entry) => structuredClone(entry));
  }
}
