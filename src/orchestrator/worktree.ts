import { createHash } from "node:crypto";
const DEFAULT_WORKTREE_ROOT = "./agents";
const DEFAULT_BASE_BRANCH = "main";
const MAX_SEGMENT_LENGTH = 40;
const MAX_BRANCH_LENGTH = 64;

export interface WorktreeSpecParams {
  ticketId: string;
  attemptIndex?: number;
  baseBranch?: string;
  worktreeRoot?: string;
}

export interface SingleAgentWorktreeSpec {
  ticketId: string;
  attemptIndex?: number;
  branchName: string;
  worktreePath: string;
  baseBranch: string;
  worktreeRoot: string;
}

export interface PromptBindingOptions {
  agentId: string;
  kanbanApiBaseUrl: string;
  securityRules: string[];
  additionalNotes?: string;
}

function sanitizeSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    return fallback;
  }

  const hash = createHash("sha1").update(value).digest("hex").slice(0, 8);
  return `${normalized.slice(0, MAX_SEGMENT_LENGTH - 9)}-${hash}`;
}

function enforceBranchLength(value: string): string {
  if (value.length <= MAX_BRANCH_LENGTH) {
    return value;
  }
  return value.slice(0, MAX_BRANCH_LENGTH);
}

function ensureWorktreeRoot(root?: string): string {
  const candidate = (root ?? "").trim();
  if (candidate === "") {
    return DEFAULT_WORKTREE_ROOT;
  }
  return candidate;
}

export function buildSingleAgentWorktreeSpec(params: WorktreeSpecParams): SingleAgentWorktreeSpec {
  if (!params.ticketId || !params.ticketId.trim()) {
    throw new Error("ticketId is required");
  }

  const ticketSegment = sanitizeSegment(params.ticketId, "ticket");
  const attemptNumber = Number.isInteger(params.attemptIndex) && params.attemptIndex! > 0
    ? params.attemptIndex
    : undefined;

  const candidateSegments = [ticketSegment];
  if (attemptNumber) {
    candidateSegments.push(`attempt-${attemptNumber}`);
  }

  const candidateBranch = enforceBranchLength(candidateSegments.join("-"));
  const branchName = candidateBranch;
  const worktreeRoot = ensureWorktreeRoot(params.worktreeRoot);
  const trimmedRoot =
    worktreeRoot.length > 1 && worktreeRoot.endsWith("/") ? worktreeRoot.slice(0, -1) : worktreeRoot;
  const worktreePath =
    trimmedRoot === "."
      ? `./${branchName}`
      : trimmedRoot === "/"
        ? `/${branchName}`
        : `${trimmedRoot}/${branchName}`;

  return {
    ticketId: params.ticketId,
    attemptIndex: attemptNumber,
    branchName,
    worktreePath,
    baseBranch: params.baseBranch?.trim() || DEFAULT_BASE_BRANCH,
    worktreeRoot,
  };
}

export function worktreeCreationCommands(spec: SingleAgentWorktreeSpec): string[] {
  return [
    `git fetch origin ${spec.baseBranch}`,
    `git checkout ${spec.baseBranch}`,
    `git checkout -b ${spec.branchName}`,
    `git worktree add ${spec.worktreePath} ${spec.branchName}`,
  ];
}

export function worktreeCleanupCommands(spec: SingleAgentWorktreeSpec): string[] {
  return [
    `git worktree remove --force ${spec.worktreePath}`,
    `git branch -D ${spec.branchName}`,
  ];
}

export function bindSingleAgentPrompt(
  spec: SingleAgentWorktreeSpec,
  options: PromptBindingOptions,
): string {
  const rules = options.securityRules.length > 0
    ? options.securityRules
    : ["Always obey the human review process before progressing to integration."];

  const rulesBlock = rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n");
  const notes = options.additionalNotes?.trim();

  const lines = [
    `Ticket ID: ${spec.ticketId}`,
    `Agent ID: ${options.agentId}`,
    `Branch: ${spec.branchName}`,
    `Worktree: ${spec.worktreePath}`,
    `Base branch: ${spec.baseBranch}`,
    `Kanban API: ${options.kanbanApiBaseUrl}`,
    "Non-negotiable security rules:",
    rulesBlock,
  ];

  if (notes) {
    lines.push("Additional context:", notes);
  }

  return lines.join("\n");
}
