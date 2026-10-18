import { DatabaseSync } from "node:sqlite";
import { lstatSync, chmodSync } from "node:fs";
import {
  type Finding,
  type TestRecord,
  type FindingLifecycle,
  type RepairRecord,
  id,
} from "../../shared/src/index.js";
import { sanitize } from "../../core/src/security/index.js";
export interface TaskBaseline {
  fileHashes: Record<string, string>;
  extensiveRequest: boolean;
  explicitReview: boolean;
  timestamp: string;
}
export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") {
      try {
        if (lstatSync(file).isSymbolicLink())
          throw new Error("Database symlink denied");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS findings(id TEXT PRIMARY KEY, root TEXT NOT NULL, snapshot TEXT NOT NULL, timestamp TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS findings_root ON findings(root,timestamp); CREATE TABLE IF NOT EXISTS executions(root TEXT, command_id TEXT, data TEXT, PRIMARY KEY(root,command_id)); CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,finding_id TEXT NOT NULL,snapshot TEXT NOT NULL,decision TEXT NOT NULL,actor TEXT NOT NULL,timestamp TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL,timestamp TEXT NOT NULL);",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS finding_lifecycle(finding_id TEXT PRIMARY KEY,root TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repair_runs(id TEXT PRIMARY KEY,root TEXT NOT NULL,lineage TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS repair_lineage ON repair_runs(root,lineage); CREATE TABLE IF NOT EXISTS presentations(finding_id TEXT NOT NULL,host TEXT NOT NULL,channel TEXT NOT NULL,timestamp TEXT NOT NULL,PRIMARY KEY(finding_id,host,channel)); CREATE TABLE IF NOT EXISTS preferences(root TEXT PRIMARY KEY,data TEXT NOT NULL);",
    );
  }
  taskBaseline(root: string, sessionId: string): TaskBaseline | undefined {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS task_baselines(root TEXT NOT NULL,session_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(root,session_id))",
    );
    const row = this.db
      .prepare("SELECT data FROM task_baselines WHERE root=? AND session_id=?")
      .get(root, sessionId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as TaskBaseline) : undefined;
  }
  saveTaskBaseline(
    root: string,
    sessionId: string,
    baseline: TaskBaseline,
  ): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS task_baselines(root TEXT NOT NULL,session_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(root,session_id))",
    );
    this.db
      .prepare("INSERT OR REPLACE INTO task_baselines VALUES(?,?,?)")
      .run(root, sessionId, JSON.stringify(baseline));
    this.db
      .prepare(
        "DELETE FROM task_baselines WHERE root=? AND rowid NOT IN (SELECT rowid FROM task_baselines WHERE root=? ORDER BY rowid DESC LIMIT 64)",
      )
      .run(root, root);
  }
  lifecycle(findingId: string): FindingLifecycle | undefined {
    const row = this.db
      .prepare("SELECT data FROM finding_lifecycle WHERE finding_id=?")
      .get(findingId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as FindingLifecycle) : undefined;
  }
  saveLifecycle(record: FindingLifecycle): void {
    this.db
      .prepare("INSERT OR REPLACE INTO finding_lifecycle VALUES(?,?,?)")
      .run(
        record.findingId,
        record.repositoryRoot,
        JSON.stringify(sanitize(record)),
      );
    this.audit("finding-lifecycle", record);
  }
  presentation(findingId: string, host: string, channel: string): boolean {
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO presentations VALUES(?,?,?,?)")
        .run(findingId, host, channel, new Date().toISOString()).changes === 1
    );
  }
  saveRepair(record: RepairRecord): void {
    this.db
      .prepare("INSERT OR REPLACE INTO repair_runs VALUES(?,?,?,?)")
      .run(
        record.id,
        record.repositoryRoot,
        record.lineage,
        JSON.stringify(sanitize(record)),
      );
    this.audit("repair-lifecycle", record);
  }
  repair(repairId: string): RepairRecord | undefined {
    const row = this.db
      .prepare("SELECT data FROM repair_runs WHERE id=?")
      .get(repairId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as RepairRecord) : undefined;
  }
  repairs(root: string, lineage?: string): RepairRecord[] {
    const rows = (
      lineage
        ? this.db
            .prepare(
              "SELECT data FROM repair_runs WHERE root=? AND lineage=? ORDER BY rowid",
            )
            .all(root, lineage)
        : this.db
            .prepare("SELECT data FROM repair_runs WHERE root=? ORDER BY rowid")
            .all(root)
    ) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as RepairRecord);
  }
  preference(root: string): Record<string, unknown> {
    const row = this.db
      .prepare("SELECT data FROM preferences WHERE root=?")
      .get(root) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : {};
  }
  savePreference(root: string, data: Record<string, unknown>): void {
    this.db
      .prepare("INSERT OR REPLACE INTO preferences VALUES(?,?)")
      .run(root, JSON.stringify(sanitize(data)));
    this.audit("interaction-settings", { root, ...data });
  }
  save(finding: Finding): void {
    const safe = sanitize(finding);
    this.db
      .prepare("INSERT OR REPLACE INTO findings VALUES(?,?,?,?,?)")
      .run(
        safe.id,
        safe.repositoryRoot,
        safe.snapshot,
        safe.timestamp,
        JSON.stringify(safe),
      );
  }
  findings(root: string, limit = 100): Finding[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM findings WHERE root=? ORDER BY timestamp DESC LIMIT ?",
        )
        .all(root, Math.min(limit, 1000)) as { data: string }[]
    ).map((r) => JSON.parse(r.data) as Finding);
  }
  get(findingId: string): Finding | undefined {
    const row = this.db
      .prepare("SELECT data FROM findings WHERE id=?")
      .get(findingId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Finding) : undefined;
  }
  execution(root: string, record: TestRecord): void {
    this.db
      .prepare("INSERT OR REPLACE INTO executions VALUES(?,?,?)")
      .run(root, record.commandId, JSON.stringify(sanitize(record)));
  }
  executions(root: string): TestRecord[] {
    return (
      this.db.prepare("SELECT data FROM executions WHERE root=?").all(root) as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data) as TestRecord);
  }
  review(
    findingId: string,
    snapshot: string,
    decision: "approve" | "reject",
    actor: string,
  ): void {
    const finding = this.get(findingId);
    if (!finding || finding.snapshot !== snapshot)
      throw new Error("Finding state mismatch");
    this.db
      .prepare("INSERT INTO reviews VALUES(?,?,?,?,?,?)")
      .run(
        id(),
        findingId,
        snapshot,
        decision,
        actor,
        new Date().toISOString(),
      );
  }
  reviews(findingId: string): unknown[] {
    return this.db
      .prepare("SELECT * FROM reviews WHERE finding_id=? ORDER BY timestamp")
      .all(findingId);
  }
  audit(kind: string, data: unknown): void {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?)")
      .run(
        id(),
        kind,
        JSON.stringify(sanitize(data)),
        new Date().toISOString(),
      );
  }
  close(): void {
    this.db.close();
  }
}
