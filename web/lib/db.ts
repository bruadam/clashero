/**
 * SQLite database for activity log, comments, clash snapshots, and IFC model registry.
 * Stored at db/clashero.db (repo root) — shared between web, mcp-server, and clash engine.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { ActivityEntry, Comment } from "./types";

// ── IFC Model / Element types ─────────────────────────────────────────────────

export interface IfcModel {
  filename: string;
  displayName: string;
  uploadedAt: string;
  elementCount: number;
  parsedAt: string | null;
}

export interface IfcElement {
  id: number;
  modelFilename: string;
  expressId: number;
  globalId: string;
  ifcType: string;
  name: string | null;
  description: string | null;
  properties: string; // JSON-encoded Record<string, string>
}

// process.cwd() is web/ when running Next.js — resolve up one level to reach repo root db/
const DB_DIR = path.resolve(process.cwd(), "..", "db");
const DB_PATH = path.join(DB_DIR, "clashero.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id          TEXT PRIMARY KEY,
      clashGuid   TEXT NOT NULL,
      type        TEXT NOT NULL,
      actor       TEXT NOT NULL,
      timestamp   TEXT NOT NULL,
      field       TEXT,
      fromValue   TEXT,
      toValue     TEXT,
      body        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_clash ON activity(clashGuid);

    CREATE TABLE IF NOT EXISTS comments (
      id        TEXT PRIMARY KEY,
      clashGuid TEXT NOT NULL,
      actor     TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      body      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_clash ON comments(clashGuid);

    CREATE TABLE IF NOT EXISTS snapshots (
      clashGuid    TEXT PRIMARY KEY,
      snapshotPath TEXT NOT NULL,
      generatedAt  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ifc_models (
      filename    TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      uploadedAt  TEXT NOT NULL,
      elementCount INTEGER NOT NULL DEFAULT 0,
      parsedAt    TEXT
    );

    CREATE TABLE IF NOT EXISTS ifc_elements (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      modelFilename  TEXT NOT NULL,
      expressId      INTEGER NOT NULL,
      globalId       TEXT NOT NULL,
      ifcType        TEXT NOT NULL,
      name           TEXT,
      description    TEXT,
      properties     TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (modelFilename) REFERENCES ifc_models(filename) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_elements_model ON ifc_elements(modelFilename);
    CREATE INDEX IF NOT EXISTS idx_elements_globalId ON ifc_elements(globalId);

    CREATE TABLE IF NOT EXISTS clashes (
      guid          TEXT PRIMARY KEY,
      id            TEXT NOT NULL,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'open',
      priority      TEXT NOT NULL DEFAULT 'none',
      ruleId        TEXT NOT NULL DEFAULT '',
      ifcGuidA      TEXT NOT NULL DEFAULT '',
      ifcGuidB      TEXT NOT NULL DEFAULT '',
      fileA         TEXT NOT NULL DEFAULT '',
      fileB         TEXT NOT NULL DEFAULT '',
      midpoint      TEXT NOT NULL DEFAULT '[0,0,0]',
      viewpoint     TEXT NOT NULL DEFAULT '{}',
      assignee      TEXT,
      labels        TEXT NOT NULL DEFAULT '[]',
      createdAt     TEXT NOT NULL,
      linearIssueId TEXT
    );

    CREATE TABLE IF NOT EXISTS linear_settings (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      accessToken TEXT NOT NULL,
      workspaceId TEXT NOT NULL DEFAULT '',
      teamId      TEXT NOT NULL DEFAULT '',
      projectId   TEXT NOT NULL DEFAULT ''
    );
  `);

  // Add linearIssueId column if it doesn't exist (migration for existing DBs)
  const clashCols = _db.pragma("table_info(clashes)") as Array<{ name: string }>;
  if (!clashCols.some((c) => c.name === "linearIssueId")) {
    _db.exec("ALTER TABLE clashes ADD COLUMN linearIssueId TEXT");
  }

  migrateLegacyJson();

  return _db;
}

/** One-time migration of existing db.json data into SQLite. */
function migrateLegacyJson() {
  const jsonPath = path.join(DB_DIR, "db.json");
  if (!fs.existsSync(jsonPath)) return;

  const db = _db!;
  const alreadyMigrated = db
    .prepare("SELECT COUNT(*) as n FROM activity")
    .get() as { n: number };
  if (alreadyMigrated.n > 0) return;

  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
      activity?: ActivityEntry[];
      comments?: Comment[];
    };

    const insertActivity = db.prepare(`
      INSERT OR IGNORE INTO activity
        (id, clashGuid, type, actor, timestamp, field, fromValue, toValue, body)
      VALUES
        (@id, @clashGuid, @type, @actor, @timestamp, @field, @from, @to, @body)
    `);
    const insertComment = db.prepare(`
      INSERT OR IGNORE INTO comments (id, clashGuid, actor, timestamp, body)
      VALUES (@id, @clashGuid, @actor, @timestamp, @body)
    `);

    const migrate = db.transaction(() => {
      for (const e of raw.activity ?? [])
        insertActivity.run({
          id: e.id,
          clashGuid: e.clashGuid,
          type: e.type,
          actor: e.actor,
          timestamp: e.timestamp,
          field: e.field ?? null,
          from: e.from ?? null,
          to: e.to ?? null,
          body: e.body ?? null,
        });
      for (const c of raw.comments ?? [])
        insertComment.run({
          id: c.id,
          clashGuid: c.clashGuid,
          actor: c.actor,
          timestamp: c.timestamp,
          body: c.body ?? null,
        });
    });
    migrate();

    console.log("[db] Migrated legacy db.json to SQLite");
  } catch (err) {
    console.warn("[db] Legacy migration skipped:", err);
  }
}

// Activity

export function getActivity(clashGuid: string): ActivityEntry[] {
  const rows = getDb()
    .prepare(
      "SELECT id, clashGuid, type, actor, timestamp, field, fromValue as [from], toValue as [to], body FROM activity WHERE clashGuid = ? ORDER BY timestamp ASC"
    )
    .all(clashGuid) as ActivityEntry[];
  return rows;
}

export function addActivity(entry: Omit<ActivityEntry, "id">): ActivityEntry {
  const full: ActivityEntry = { id: crypto.randomUUID(), ...entry };
  getDb()
    .prepare(
      `INSERT INTO activity (id, clashGuid, type, actor, timestamp, field, fromValue, toValue, body)
       VALUES (@id, @clashGuid, @type, @actor, @timestamp, @field, @fromValue, @toValue, @body)`
    )
    .run({
      id: full.id,
      clashGuid: full.clashGuid,
      type: full.type,
      actor: full.actor,
      timestamp: full.timestamp,
      field: full.field ?? null,
      fromValue: full.from ?? null,
      toValue: full.to ?? null,
      body: full.body ?? null,
    });
  return full;
}

// Comments

export function getComments(clashGuid: string): Comment[] {
  return getDb()
    .prepare(
      "SELECT * FROM comments WHERE clashGuid = ? ORDER BY timestamp ASC"
    )
    .all(clashGuid) as Comment[];
}

export function addComment(comment: Omit<Comment, "id">): Comment {
  const full: Comment = { id: crypto.randomUUID(), ...comment };
  getDb()
    .prepare(
      `INSERT INTO comments (id, clashGuid, actor, timestamp, body)
       VALUES (@id, @clashGuid, @actor, @timestamp, @body)`
    )
    .run(full);
  return full;
}

// Snapshots

export function getSnapshot(clashGuid: string): string | null {
  const row = getDb()
    .prepare("SELECT snapshotPath FROM snapshots WHERE clashGuid = ?")
    .get(clashGuid) as { snapshotPath: string } | undefined;
  return row?.snapshotPath ?? null;
}

export function setSnapshot(clashGuid: string, snapshotPath: string): void {
  getDb()
    .prepare(
      `INSERT INTO snapshots (clashGuid, snapshotPath, generatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(clashGuid) DO UPDATE SET snapshotPath = excluded.snapshotPath, generatedAt = excluded.generatedAt`
    )
    .run(clashGuid, snapshotPath, new Date().toISOString());
}

export function getAllSnapshots(): Array<{ clashGuid: string; snapshotPath: string }> {
  return getDb()
    .prepare("SELECT clashGuid, snapshotPath FROM snapshots")
    .all() as Array<{ clashGuid: string; snapshotPath: string }>;
}

// ── IFC Models ────────────────────────────────────────────────────────────────

export function listIfcModels(): IfcModel[] {
  return getDb()
    .prepare("SELECT * FROM ifc_models ORDER BY uploadedAt ASC")
    .all() as IfcModel[];
}

export function getIfcModel(filename: string): IfcModel | null {
  const row = getDb()
    .prepare("SELECT * FROM ifc_models WHERE filename = ?")
    .get(filename) as IfcModel | undefined;
  return row ?? null;
}

export function upsertIfcModel(model: Omit<IfcModel, "elementCount" | "parsedAt">): void {
  getDb()
    .prepare(
      `INSERT INTO ifc_models (filename, displayName, uploadedAt, elementCount, parsedAt)
       VALUES (@filename, @displayName, @uploadedAt, 0, NULL)
       ON CONFLICT(filename) DO UPDATE SET displayName = excluded.displayName`
    )
    .run(model);
}

export function markIfcModelParsed(filename: string, elementCount: number): void {
  getDb()
    .prepare(
      `UPDATE ifc_models SET parsedAt = ?, elementCount = ? WHERE filename = ?`
    )
    .run(new Date().toISOString(), elementCount, filename);
}

export function deleteIfcModel(filename: string): void {
  // Elements are cascade-deleted by FK
  getDb().prepare("DELETE FROM ifc_models WHERE filename = ?").run(filename);
}

// ── IFC Elements ──────────────────────────────────────────────────────────────

export function getElementsForModel(modelFilename: string): IfcElement[] {
  return getDb()
    .prepare("SELECT * FROM ifc_elements WHERE modelFilename = ? ORDER BY expressId ASC")
    .all(modelFilename) as IfcElement[];
}

export function getElementByGlobalId(globalId: string): IfcElement | null {
  const row = getDb()
    .prepare("SELECT * FROM ifc_elements WHERE globalId = ? LIMIT 1")
    .get(globalId) as IfcElement | undefined;
  return row ?? null;
}

export function getAllElements(): IfcElement[] {
  return getDb()
    .prepare("SELECT * FROM ifc_elements ORDER BY modelFilename, expressId ASC")
    .all() as IfcElement[];
}

export function replaceElementsForModel(
  modelFilename: string,
  elements: Omit<IfcElement, "id">[]
): void {
  const db = getDb();
  const deleteStmt = db.prepare("DELETE FROM ifc_elements WHERE modelFilename = ?");
  const insertStmt = db.prepare(
    `INSERT INTO ifc_elements (modelFilename, expressId, globalId, ifcType, name, description, properties)
     VALUES (@modelFilename, @expressId, @globalId, @ifcType, @name, @description, @properties)`
  );
  const run = db.transaction(() => {
    deleteStmt.run(modelFilename);
    for (const el of elements) insertStmt.run(el);
  });
  run();
}

// ── Clashes ───────────────────────────────────────────────────────────────────

import type { Clash } from "./types";

function rowToClash(row: Record<string, unknown>): Clash {
  return {
    guid: row.guid as string,
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as Clash["status"],
    priority: row.priority as Clash["priority"],
    ruleId: row.ruleId as string,
    ifcGuidA: row.ifcGuidA as string,
    ifcGuidB: row.ifcGuidB as string,
    fileA: row.fileA as string,
    fileB: row.fileB as string,
    midpoint: JSON.parse(row.midpoint as string),
    viewpoint: JSON.parse(row.viewpoint as string),
    assignee: (row.assignee as string | null) ?? undefined,
    labels: JSON.parse(row.labels as string),
    createdAt: row.createdAt as string,
    linearIssueId: (row.linearIssueId as string | null) ?? undefined,
  };
}

export function listClashes(): Clash[] {
  return (getDb()
    .prepare("SELECT * FROM clashes ORDER BY createdAt DESC")
    .all() as Record<string, unknown>[]).map(rowToClash);
}

export function getClash(guid: string): Clash | null {
  const row = getDb()
    .prepare("SELECT * FROM clashes WHERE guid = ?")
    .get(guid) as Record<string, unknown> | undefined;
  return row ? rowToClash(row) : null;
}

export function clashCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as n FROM clashes")
    .get() as { n: number };
  return row.n;
}

export function insertClash(clash: Clash): void {
  getDb()
    .prepare(
      `INSERT INTO clashes
         (guid, id, title, description, status, priority, ruleId,
          ifcGuidA, ifcGuidB, fileA, fileB, midpoint, viewpoint,
          assignee, labels, createdAt, linearIssueId)
       VALUES
         (@guid, @id, @title, @description, @status, @priority, @ruleId,
          @ifcGuidA, @ifcGuidB, @fileA, @fileB, @midpoint, @viewpoint,
          @assignee, @labels, @createdAt, @linearIssueId)`
    )
    .run({
      ...clash,
      midpoint: JSON.stringify(clash.midpoint),
      viewpoint: JSON.stringify(clash.viewpoint),
      labels: JSON.stringify(clash.labels),
      assignee: clash.assignee ?? null,
      linearIssueId: clash.linearIssueId ?? null,
    });
}

export function setClashLinearIssueId(guid: string, linearIssueId: string): void {
  getDb()
    .prepare("UPDATE clashes SET linearIssueId = ? WHERE guid = ?")
    .run(linearIssueId, guid);
}

export function updateClash(guid: string, patch: Partial<Clash>): void {
  const allowed = ["title", "description", "status", "priority", "assignee", "labels", "linearIssueId"] as const;
  const sets: string[] = [];
  const values: Record<string, unknown> = { guid };
  for (const key of allowed) {
    if (key in patch) {
      sets.push(`${key} = @${key}`);
      const v = patch[key];
      values[key] = key === "labels" ? JSON.stringify(v) : (v ?? null);
    }
  }
  if (sets.length === 0) return;
  getDb()
    .prepare(`UPDATE clashes SET ${sets.join(", ")} WHERE guid = @guid`)
    .run(values);
}

// ── Linear Settings ───────────────────────────────────────────────────────────

export interface LinearSettings {
  accessToken: string;
  workspaceId: string;
  teamId: string;
  projectId: string;
}

export function getLinearSettings(): LinearSettings | null {
  const row = getDb()
    .prepare("SELECT accessToken, workspaceId, teamId, projectId FROM linear_settings WHERE id = 1")
    .get() as LinearSettings | undefined;
  return row ?? null;
}

export function saveLinearSettings(settings: LinearSettings): void {
  getDb()
    .prepare(
      `INSERT INTO linear_settings (id, accessToken, workspaceId, teamId, projectId)
       VALUES (1, @accessToken, @workspaceId, @teamId, @projectId)
       ON CONFLICT(id) DO UPDATE SET
         accessToken = excluded.accessToken,
         workspaceId = excluded.workspaceId,
         teamId      = excluded.teamId,
         projectId   = excluded.projectId`
    )
    .run(settings);
}
