import { expect, test } from "vitest";
import { parseProgressMd } from "../src/lib/progress-parser.js";

const VALID = `
## Session 1 — 2026-03-16T14:00:00Z
### DONE
- Scaffold API — commit: abc1234
### IN_PROGRESS
- Implement /transition route
### BLOCKED
- None
### FILES_MODIFIED
- src/routes/cards.ts
### NEXT_ACTION
- Add JWT middleware to /transition
`;

test("parses valid progress.md", () => {
  const parsed = parseProgressMd(VALID);
  expect(parsed.session).toBe(1);
  expect(parsed.done).toHaveLength(1);
  expect(parsed.next_action).toBeTruthy();
  expect(parsed.next_action_entries).toEqual([
    "Add JWT middleware to /transition",
  ]);
});

test("rejects progress.md missing NEXT_ACTION", () => {
  const invalid = VALID.replace(
    "### NEXT_ACTION\n- Add JWT middleware to /transition",
    "",
  );
  expect(() => parseProgressMd(invalid)).toThrow("Missing NEXT_ACTION");
});
