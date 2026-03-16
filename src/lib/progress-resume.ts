import type {
  CompactionEventContext,
  CompactionEventReason,
  ProgressResumeState,
} from "../types.js";
import { ParsedProgressMd, parseProgressMd } from "./progress-parser.js";

export function resumeFromProgressMd(input: string): ProgressResumeState {
  return resumeFromParsedProgress(parseProgressMd(input));
}

export function resumeFromParsedProgress(parsed: ParsedProgressMd): ProgressResumeState {
  const nextAction = ensureNextAction(parsed.next_action_entries);
  return {
    session: parsed.session,
    timestamp: parsed.timestamp,
    done: parsed.done,
    inProgress: parsed.in_progress,
    blocked: parsed.blocked,
    filesModified: parsed.files_modified,
    nextActionQueue: [...parsed.next_action_entries],
    nextAction,
  };
}

export function buildCompactionEventContext(
  parsed: ParsedProgressMd,
  reason: CompactionEventReason,
): CompactionEventContext {
  return {
    reason,
    summary: buildProgressSummary(parsed),
    resumeState: resumeFromParsedProgress(parsed),
  };
}

export function buildCompactionEventContextFromProgressMd(
  progressMd: string,
  reason: CompactionEventReason,
): CompactionEventContext {
  return buildCompactionEventContext(parseProgressMd(progressMd), reason);
}

function ensureNextAction(entries: string[]): string {
  if (entries.length === 0) {
    throw new Error("NEXT_ACTION must contain at least one entry to resume work");
  }
  return entries[0];
}

function buildProgressSummary(parsed: ParsedProgressMd): string {
  const sections: [string, string[]][] = [
    ["DONE", parsed.done],
    ["IN_PROGRESS", parsed.in_progress],
    ["BLOCKED", parsed.blocked],
    ["FILES_MODIFIED", parsed.files_modified],
  ];

  const nonEmpty = sections.filter(([, entries]) => entries.length > 0);
  if (nonEmpty.length === 0) {
    return "no recorded progress";
  }

  return nonEmpty
    .map(([label, entries]) => `${label} ${entries.length}`)
    .join(", ");
}
