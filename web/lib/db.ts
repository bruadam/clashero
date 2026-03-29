/**
 * SQLite database layer for Clashero.
 * Uses better-sqlite3 with an async interface so callers are identical
 * to the PostgreSQL version — no Docker or external services required.
 * Database file: db/clashero.db (repo root)
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { ActivityEntry, Comment, Clash } from "./types";

// ── Types ────────────────────────────────────────────────────────────────────

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
  properties: string; // JSON string for API compat
}

export interface LinearSettings {
  accessToken: string;
  workspaceId: string;
  teamId: string;
  projectId: string;
}

// ── Connection ───────────────────────────────────────────────────────────────

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
    CREATE TABLE IF NOT EXISTS clashes (
      guid            TEXT PRIMARY KEY,
      id              TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'open',
      priority        TEXT NOT NULL DEFAULT 'none',
      rule_id         TEXT NOT NULL DEFAULT '',
      ifc_guid_a      TEXT NOT NULL DEFAULT '',
      ifc_guid_b      TEXT NOT NULL DEFAULT '',
      file_a          TEXT NOT NULL DEFAULT '',
      file_b          TEXT NOT NULL DEFAULT '',
      midpoint        TEXT NOT NULL DEFAULT '[0,0,0]',
      viewpoint       TEXT NOT NULL DEFAULT '{}',
      assignee        TEXT,
      labels          TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL,
      modified_at     TEXT,
      creation_author TEXT,
      linear_issue_id TEXT
    );

    CREATE TABLE IF NOT EXISTS activity (
      id          TEXT PRIMARY KEY,
      clash_guid  TEXT NOT NULL,
      type        TEXT NOT NULL,
      actor       TEXT NOT NULL,
      timestamp   TEXT NOT NULL,
      field       TEXT,
      from_value  TEXT,
      to_value    TEXT,
      body        TEXT,
      FOREIGN KEY (clash_guid) REFERENCES clashes(guid) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_activity_clash ON activity(clash_guid);

    CREATE TABLE IF NOT EXISTS comments (
      id          TEXT PRIMARY KEY,
      clash_guid  TEXT NOT NULL,
      actor       TEXT NOT NULL,
      timestamp   TEXT NOT NULL,
      body        TEXT NOT NULL,
      FOREIGN KEY (clash_guid) REFERENCES clashes(guid) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comments_clash ON comments(clash_guid);

    CREATE TABLE IF NOT EXISTS snapshots (
      clash_guid    TEXT PRIMARY KEY,
      snapshot_path TEXT NOT NULL,
      generated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ifc_models (
      filename      TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      uploaded_at   TEXT NOT NULL,
      element_count INTEGER NOT NULL DEFAULT 0,
      parsed_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS ifc_elements (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      model_filename TEXT NOT NULL,
      express_id     INTEGER NOT NULL,
      global_id      TEXT NOT NULL,
      ifc_type       TEXT NOT NULL,
      name           TEXT,
      description    TEXT,
      properties     TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (model_filename) REFERENCES ifc_models(filename) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_elements_model    ON ifc_elements(model_filename);
    CREATE INDEX IF NOT EXISTS idx_elements_globalId ON ifc_elements(global_id);

    CREATE TABLE IF NOT EXISTS linear_settings (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '',
      team_id      TEXT NOT NULL DEFAULT '',
      project_id   TEXT NOT NULL DEFAULT ''
    );
  `);
  return _db;
}

// ── Row mappers ──────────────────────────────────────────────────────────────

function rowToClash(row: Record<string, unknown>): Clash {
  return {
    guid:           row.guid as string,
    id:             row.id as string,
    title:          row.title as string,
    description:    (row.description as string) ?? "",
    status:         row.status as Clash["status"],
    priority:       row.priority as Clash["priority"],
    ruleId:         row.rule_id as string,
    ifcGuidA:       row.ifc_guid_a as string,
    ifcGuidB:       row.ifc_guid_b as string,
    fileA:          row.file_a as string,
    fileB:          row.file_b as string,
    midpoint:       JSON.parse(row.midpoint as string),
    viewpoint:      JSON.parse(row.viewpoint as string),
    assignee:       (row.assignee as string | null) ?? undefined,
    labels:         JSON.parse(row.labels as string),
    createdAt:      row.created_at as string,
    modifiedDate:   (row.modified_at as string | null) ?? undefined,
    creationAuthor: (row.creation_author as string | null) ?? undefined,
    linearIssueId:  (row.linear_issue_id as string | null) ?? undefined,
  };
}

function rowToElement(r: Record<string, unknown>): IfcElement {
  return {
    id:            r.id as number,
    modelFilename: r.model_filename as string,
    expressId:     r.express_id as number,
    globalId:      r.global_id as string,
    ifcType:       r.ifc_type as string,
    name:          (r.name as string | null) ?? null,
    description:   (r.description as string | null) ?? null,
    properties:    typeof r.properties === "string" ? r.properties : JSON.stringify(r.properties),
  };
}

function rowToModel(r: Record<string, unknown>): IfcModel {
  return {
    filename:     r.filename as string,
    displayName:  r.display_name as string,
    uploadedAt:   r.uploaded_at as string,
    elementCount: r.element_count as number,
    parsedAt:     (r.parsed_at as string | null) ?? null,
  };
}

// ── Clashes ──────────────────────────────────────────────────────────────────

export async function listClashes(): Promise<Clash[]> {
  const rows = getDb()
    .prepare("SELECT * FROM clashes ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToClash);
}

export async function getClash(guid: string): Promise<Clash | null> {
  const row = getDb()
    .prepare("SELECT * FROM clashes WHERE guid = ?")
    .get(guid) as Record<string, unknown> | undefined;
  return row ? rowToClash(row) : null;
}

export async function clashCount(): Promise<number> {
  const row = getDb()
    .prepare("SELECT COUNT(*) as n FROM clashes")
    .get() as { n: number };
  return row.n;
}

export async function insertClash(clash: Clash): Promise<void> {
  getDb().prepare(`
    INSERT INTO clashes
      (guid, id, title, description, status, priority, rule_id,
       ifc_guid_a, ifc_guid_b, file_a, file_b, midpoint, viewpoint,
       assignee, labels, created_at, modified_at, creation_author, linear_issue_id)
    VALUES
      (@guid, @id, @title, @description, @status, @priority, @rule_id,
       @ifc_guid_a, @ifc_guid_b, @file_a, @file_b, @midpoint, @viewpoint,
       @assignee, @labels, @created_at, @modified_at, @creation_author, @linear_issue_id)
    ON CONFLICT(guid) DO NOTHING
  `).run({
    guid:            clash.guid,
    id:              clash.id,
    title:           clash.title,
    description:     clash.description,
    status:          clash.status,
    priority:        clash.priority,
    rule_id:         clash.ruleId,
    ifc_guid_a:      clash.ifcGuidA,
    ifc_guid_b:      clash.ifcGuidB,
    file_a:          clash.fileA,
    file_b:          clash.fileB,
    midpoint:        JSON.stringify(clash.midpoint),
    viewpoint:       JSON.stringify(clash.viewpoint),
    assignee:        clash.assignee ?? null,
    labels:          JSON.stringify(clash.labels),
    created_at:      clash.createdAt,
    modified_at:     clash.modifiedDate ?? null,
    creation_author: clash.creationAuthor ?? null,
    linear_issue_id: clash.linearIssueId ?? null,
  });
}

export async function upsertClash(clash: Clash): Promise<void> {
  getDb().prepare(`
    INSERT INTO clashes
      (guid, id, title, description, status, priority, rule_id,
       ifc_guid_a, ifc_guid_b, file_a, file_b, midpoint, viewpoint,
       assignee, labels, created_at, modified_at, creation_author, linear_issue_id)
    VALUES
      (@guid, @id, @title, @description, @status, @priority, @rule_id,
       @ifc_guid_a, @ifc_guid_b, @file_a, @file_b, @midpoint, @viewpoint,
       @assignee, @labels, @created_at, @modified_at, @creation_author, @linear_issue_id)
    ON CONFLICT(guid) DO UPDATE SET
      title           = excluded.title,
      description     = excluded.description,
      status          = excluded.status,
      priority        = excluded.priority,
      rule_id         = excluded.rule_id,
      ifc_guid_a      = excluded.ifc_guid_a,
      ifc_guid_b      = excluded.ifc_guid_b,
      file_a          = excluded.file_a,
      file_b          = excluded.file_b,
      midpoint        = excluded.midpoint,
      viewpoint       = excluded.viewpoint,
      assignee        = excluded.assignee,
      labels          = excluded.labels,
      modified_at     = @modified_at,
      creation_author = excluded.creation_author,
      linear_issue_id = excluded.linear_issue_id
  `).run({
    guid:            clash.guid,
    id:              clash.id,
    title:           clash.title,
    description:     clash.description,
    status:          clash.status,
    priority:        clash.priority,
    rule_id:         clash.ruleId,
    ifc_guid_a:      clash.ifcGuidA,
    ifc_guid_b:      clash.ifcGuidB,
    file_a:          clash.fileA,
    file_b:          clash.fileB,
    midpoint:        JSON.stringify(clash.midpoint),
    viewpoint:       JSON.stringify(clash.viewpoint),
    assignee:        clash.assignee ?? null,
    labels:          JSON.stringify(clash.labels),
    created_at:      clash.createdAt,
    modified_at:     new Date().toISOString(),
    creation_author: clash.creationAuthor ?? null,
    linear_issue_id: clash.linearIssueId ?? null,
  });
}

export async function updateClash(guid: string, patch: Partial<Clash>): Promise<void> {
  const fieldMap: Record<string, string> = {
    title:          "title",
    description:    "description",
    status:         "status",
    priority:       "priority",
    assignee:       "assignee",
    labels:         "labels",
    linearIssueId:  "linear_issue_id",
    ruleId:         "rule_id",
    ifcGuidA:       "ifc_guid_a",
    ifcGuidB:       "ifc_guid_b",
    fileA:          "file_a",
    fileB:          "file_b",
  };
  const sets: string[] = [];
  const values: Record<string, unknown> = { guid };
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch) {
      sets.push(`${col} = @${col}`);
      const v = (patch as Record<string, unknown>)[key];
      values[col] = key === "labels" ? JSON.stringify(v) : (v ?? null);
    }
  }
  if (sets.length === 0) return;
  sets.push("modified_at = @modified_at");
  values["modified_at"] = new Date().toISOString();
  getDb().prepare(`UPDATE clashes SET ${sets.join(", ")} WHERE guid = @guid`).run(values);
}

export async function deleteClash(guid: string): Promise<boolean> {
  const result = getDb().prepare("DELETE FROM clashes WHERE guid = ?").run(guid);
  return result.changes > 0;
}

export async function deleteAllClashes(): Promise<void> {
  getDb().prepare("DELETE FROM clashes").run();
}

export async function setClashLinearIssueId(guid: string, linearIssueId: string): Promise<void> {
  getDb()
    .prepare("UPDATE clashes SET linear_issue_id = ?, modified_at = ? WHERE guid = ?")
    .run(linearIssueId, new Date().toISOString(), guid);
}

// ── Activity ─────────────────────────────────────────────────────────────────

export async function getActivity(clashGuid: string): Promise<ActivityEntry[]> {
  return getDb()
    .prepare("SELECT id, clash_guid as clashGuid, type, actor, timestamp, field, from_value as [from], to_value as [to], body FROM activity WHERE clash_guid = ? ORDER BY timestamp ASC")
    .all(clashGuid) as ActivityEntry[];
}

export async function addActivity(entry: Omit<ActivityEntry, "id">): Promise<ActivityEntry> {
  const full: ActivityEntry = { id: crypto.randomUUID(), ...entry };
  getDb().prepare(`
    INSERT INTO activity (id, clash_guid, type, actor, timestamp, field, from_value, to_value, body)
    VALUES (@id, @clashGuid, @type, @actor, @timestamp, @field, @from_value, @to_value, @body)
  `).run({
    id:         full.id,
    clashGuid:  full.clashGuid,
    type:       full.type,
    actor:      full.actor,
    timestamp:  full.timestamp,
    field:      full.field ?? null,
    from_value: full.from ?? null,
    to_value:   full.to ?? null,
    body:       full.body ?? null,
  });
  return full;
}

export async function deleteActivity(id: string): Promise<boolean> {
  const result = getDb().prepare("DELETE FROM activity WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Comments ─────────────────────────────────────────────────────────────────

export async function getComments(clashGuid: string): Promise<Comment[]> {
  return getDb()
    .prepare("SELECT id, clash_guid as clashGuid, actor, timestamp, body FROM comments WHERE clash_guid = ? ORDER BY timestamp ASC")
    .all(clashGuid) as Comment[];
}

export async function addComment(comment: Omit<Comment, "id">): Promise<Comment> {
  const full: Comment = { id: crypto.randomUUID(), ...comment };
  getDb().prepare(`
    INSERT INTO comments (id, clash_guid, actor, timestamp, body)
    VALUES (@id, @clashGuid, @actor, @timestamp, @body)
  `).run(full);
  return full;
}

export async function deleteComment(id: string): Promise<boolean> {
  const result = getDb().prepare("DELETE FROM comments WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export async function getSnapshot(clashGuid: string): Promise<string | null> {
  const row = getDb()
    .prepare("SELECT snapshot_path FROM snapshots WHERE clash_guid = ?")
    .get(clashGuid) as { snapshot_path: string } | undefined;
  return row?.snapshot_path ?? null;
}

export async function setSnapshot(clashGuid: string, snapshotPath: string): Promise<void> {
  getDb().prepare(`
    INSERT INTO snapshots (clash_guid, snapshot_path, generated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(clash_guid) DO UPDATE SET snapshot_path = excluded.snapshot_path, generated_at = excluded.generated_at
  `).run(clashGuid, snapshotPath, new Date().toISOString());
}

export async function getAllSnapshots(): Promise<Array<{ clashGuid: string; snapshotPath: string }>> {
  return (getDb()
    .prepare("SELECT clash_guid as clashGuid, snapshot_path as snapshotPath FROM snapshots")
    .all()) as Array<{ clashGuid: string; snapshotPath: string }>;
}

// ── IFC Models ───────────────────────────────────────────────────────────────

export async function listIfcModels(): Promise<IfcModel[]> {
  return (getDb()
    .prepare("SELECT * FROM ifc_models ORDER BY uploaded_at ASC")
    .all() as Record<string, unknown>[]).map(rowToModel);
}

export async function getIfcModel(filename: string): Promise<IfcModel | null> {
  const row = getDb()
    .prepare("SELECT * FROM ifc_models WHERE filename = ?")
    .get(filename) as Record<string, unknown> | undefined;
  return row ? rowToModel(row) : null;
}

export async function upsertIfcModel(model: Omit<IfcModel, "elementCount" | "parsedAt">): Promise<void> {
  getDb().prepare(`
    INSERT INTO ifc_models (filename, display_name, uploaded_at, element_count, parsed_at)
    VALUES (@filename, @displayName, @uploadedAt, 0, NULL)
    ON CONFLICT(filename) DO UPDATE SET display_name = excluded.display_name
  `).run(model);
}

export async function markIfcModelParsed(filename: string, elementCount: number): Promise<void> {
  getDb()
    .prepare("UPDATE ifc_models SET parsed_at = ?, element_count = ? WHERE filename = ?")
    .run(new Date().toISOString(), elementCount, filename);
}

export async function deleteIfcModel(filename: string): Promise<void> {
  getDb().prepare("DELETE FROM ifc_models WHERE filename = ?").run(filename);
}

// ── IFC Elements ─────────────────────────────────────────────────────────────

export async function getElementsForModel(modelFilename: string): Promise<IfcElement[]> {
  return (getDb()
    .prepare("SELECT * FROM ifc_elements WHERE model_filename = ? ORDER BY express_id ASC")
    .all(modelFilename) as Record<string, unknown>[]).map(rowToElement);
}

export async function getElementByGlobalId(globalId: string): Promise<IfcElement | null> {
  const row = getDb()
    .prepare("SELECT * FROM ifc_elements WHERE global_id = ? LIMIT 1")
    .get(globalId) as Record<string, unknown> | undefined;
  return row ? rowToElement(row) : null;
}

export async function getAllElements(): Promise<IfcElement[]> {
  return (getDb()
    .prepare("SELECT * FROM ifc_elements ORDER BY model_filename, express_id ASC")
    .all() as Record<string, unknown>[]).map(rowToElement);
}

export async function replaceElementsForModel(
  modelFilename: string,
  elements: Omit<IfcElement, "id">[],
): Promise<void> {
  const db = getDb();
  const del = db.prepare("DELETE FROM ifc_elements WHERE model_filename = ?");
  const ins = db.prepare(`
    INSERT INTO ifc_elements (model_filename, express_id, global_id, ifc_type, name, description, properties)
    VALUES (@model_filename, @express_id, @global_id, @ifc_type, @name, @description, @properties)
  `);
  db.transaction(() => {
    del.run(modelFilename);
    for (const el of elements) {
      ins.run({
        model_filename: el.modelFilename,
        express_id:     el.expressId,
        global_id:      el.globalId,
        ifc_type:       el.ifcType,
        name:           el.name,
        description:    el.description,
        properties:     el.properties,
      });
    }
  })();
}

export async function backfillClashFiles(): Promise<void> {
  // No-op in SQLite version — file references are populated at import time
}

// ── Linear Settings ──────────────────────────────────────────────────────────

export async function getLinearSettings(): Promise<LinearSettings | null> {
  const row = getDb()
    .prepare("SELECT access_token, workspace_id, team_id, project_id FROM linear_settings WHERE id = 1")
    .get() as Record<string, string> | undefined;
  if (!row) return null;
  return {
    accessToken: row.access_token,
    workspaceId: row.workspace_id,
    teamId:      row.team_id,
    projectId:   row.project_id,
  };
}

export async function saveLinearSettings(settings: LinearSettings): Promise<void> {
  getDb().prepare(`
    INSERT INTO linear_settings (id, access_token, workspace_id, team_id, project_id)
    VALUES (1, @accessToken, @workspaceId, @teamId, @projectId)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      workspace_id = excluded.workspace_id,
      team_id      = excluded.team_id,
      project_id   = excluded.project_id
  `).run(settings);
}
