import { expect, test } from "vitest";
import {
  buildCompactionEventContext,
  resumeFromParsedProgress,
  resumeFromProgressMd,
} from "../src/lib/progress-resume.js";
import type { ParsedProgressMd } from "../src/lib/progress-parser.js";
import { parseProgressMd } from "../src/lib/progress-parser.js";
import { COMPACTION_EVENT_REASONS } from "../src/types.js";

const PROGRESS_MARKDOWN = `
## Session 3 — 2026-03-16T15:30:00Z
### DONE
- Set up the MVP API scaffolding
### IN_PROGRESS
- Wire the cards/transition routes
### BLOCKED
- Await better SQLite wiring docs
### FILES_MODIFIED
- src/routes/cards.ts
### NEXT_ACTION
- Add JWT middleware to /transition
- Capture compaction event context
`;

test("resumeFromProgressMd builds a resume plan with the NEXT_ACTION queue", () => {
  const resumePlan = resumeFromProgressMd(PROGRESS_MARKDOWN);
  expect(resumePlan.session).toBe(3);
  expect(resumePlan.done).toContain("Set up the MVP API scaffolding");
  expect(resumePlan.nextAction).toBe("Add JWT middleware to /transition");
  expect(resumePlan.nextActionQueue).toHaveLength(2);
});

test("resumeFromParsedProgress requires at least one NEXT_ACTION entry", () => {
  const parsed = parseProgressMd(PROGRESS_MARKDOWN);
  const trimmed = {
    ...parsed,
    next_action_entries: [],
    next_action: "",
  } satisfies ParsedProgressMd;

  expect(() => resumeFromParsedProgress(trimmed)).toThrow(
    "NEXT_ACTION must contain at least one entry",
  );
});

test("buildCompactionEventContext annotates reason and summary", () => {
  const parsed = parseProgressMd(PROGRESS_MARKDOWN);
  const context = buildCompactionEventContext(parsed, "75pct_threshold");
  expect(context.reason).toBe("75pct_threshold");
  expect(context.summary).toContain("DONE 1");
  expect(context.resumeState.nextAction).toBe("Add JWT middleware to /transition");
});

test("compaction reasons stay stable", () => {
  expect(COMPACTION_EVENT_REASONS).toEqual([
    "25pct_threshold",
    "50pct_threshold",
    "75pct_threshold",
    "context_exhausted",
  ]);
});
