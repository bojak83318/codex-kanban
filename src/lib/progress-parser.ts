export interface ParsedProgressMd {
  session: number;
  timestamp: string;
  done: string[];
  in_progress: string[];
  blocked: string[];
  files_modified: string[];
  next_action_entries: string[];
  next_action: string;
}

const SECTION_HEADERS = [
  "DONE",
  "IN_PROGRESS",
  "BLOCKED",
  "FILES_MODIFIED",
  "NEXT_ACTION",
] as const;

type SectionName = (typeof SECTION_HEADERS)[number];

const SECTION_SET = new Set<string>(SECTION_HEADERS);

function parseSessionHeader(input: string): { session: number; timestamp: string } {
  const match = input.match(/^## Session (\d+) — ([^\n]+)$/m);
  if (!match) {
    throw new Error("Missing session header");
  }

  return {
    session: Number.parseInt(match[1], 10),
    timestamp: match[2].trim(),
  };
}

function parseSections(input: string): Map<SectionName, string[]> {
  const sections = new Map<SectionName, string[]>();
  let current: SectionName | null = null;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    const sectionMatch = line.match(/^### ([A-Z_]+)$/);
    if (sectionMatch) {
      const section = sectionMatch[1];
      if (!SECTION_SET.has(section)) {
        current = null;
        continue;
      }
      current = section as SectionName;
      sections.set(current, []);
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.trim() === "") {
      continue;
    }

    if (!line.startsWith("- ")) {
      throw new Error(`Invalid list entry in ${current}`);
    }

    sections.get(current)!.push(line.slice(2).trim());
  }

  return sections;
}

function requireSection(
  sections: Map<SectionName, string[]>,
  section: SectionName,
): string[] {
  const entries = sections.get(section);
  if (!entries || entries.length === 0) {
    throw new Error(`Missing ${section}`);
  }
  return entries;
}

export function parseProgressMd(input: string): ParsedProgressMd {
  const header = parseSessionHeader(input);
  const sections = parseSections(input);

  const done = requireSection(sections, "DONE");
  const inProgress = requireSection(sections, "IN_PROGRESS");
  const blocked = requireSection(sections, "BLOCKED");
  const filesModified = requireSection(sections, "FILES_MODIFIED");
  const nextActionEntries = requireSection(sections, "NEXT_ACTION");

  const nextAction = nextActionEntries.join("\n");
  return {
    session: header.session,
    timestamp: header.timestamp,
    done,
    in_progress: inProgress,
    blocked,
    files_modified: filesModified,
    next_action_entries: nextActionEntries,
    next_action: nextAction,
  };
}
