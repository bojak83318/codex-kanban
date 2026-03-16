import Database from "better-sqlite3";

interface Migration {
  id: number;
  description: string;
  script: string;
}

const SCHEMA_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY NOT NULL
);
`;

const MIGRATIONS: Migration[] = [
    {
      id: 1,
      description: "initial schema",
      script: `
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner_agent_id TEXT NOT NULL,
  column TEXT NOT NULL,
  parent_card_id TEXT,
  attempt_index INTEGER,
  strategy TEXT,
  branch TEXT,
  worktree_path TEXT,
  FOREIGN KEY(parent_card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  from_column TEXT NOT NULL,
  to_column TEXT NOT NULL,
  decision_action TEXT NOT NULL,
  decision_logic_chain TEXT NOT NULL,
  decision_projected_impact TEXT NOT NULL,
  decision_reversible INTEGER NOT NULL,
  artifact_branch TEXT,
  artifact_worktree_path TEXT,
  artifact_pr_url TEXT,
  artifact_test_report_url TEXT,
  artifact_coverage_delta REAL,
  FOREIGN KEY(card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  context_snapshot_ref TEXT,
  FOREIGN KEY(card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS acks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event TEXT NOT NULL,
  card_id TEXT,
  details TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_veto (
  scope TEXT PRIMARY KEY,
  active INTEGER NOT NULL,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL
);
`,
  },
  {
    id: 2,
    description: "track compaction context for signals",
    script: `
ALTER TABLE signals
  ADD COLUMN compaction_context TEXT;
`,
  },
];

export function applyMigrations(db: Database.Database): void {
  db.exec(SCHEMA_VERSION_TABLE);

  const appliedIds = new Set<number>(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row: { id: number }) => row.id),
  );

  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id) VALUES (?)",
  );

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    db.exec("BEGIN");
    try {
      db.exec(migration.script);
      insertMigration.run(migration.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
