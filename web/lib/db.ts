/**
 * PostgreSQL database layer for Clashero.
 * Replaces the previous SQLite (better-sqlite3) implementation.
 * All functions are async — callers must await them.
 */

import { Pool } from "pg";
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

// ── Connection pool ──────────────────────────────────────────────────────────

const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "clashero",
  user: process.env.PGUSER ?? "clashero",
  password: process.env.PGPASSWORD ?? "clashero",
  max: 10,
});

// ── Helper: snake_case row → camelCase ───────────────────────────────────────

function rowToClash(row: Record<string, unknown>): Clash {
  return {
    guid: row.guid as string,
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? "",
    status: row.status as Clash["status"],
    priority: row.priority as Clash["priority"],
    ruleId: row.rule_id as string,
    ifcGuidA: row.ifc_guid_a as string,
    ifcGuidB: row.ifc_guid_b as string,
    fileA: row.file_a as string,
    fileB: row.file_b as string,
    midpoint: row.midpoint as [number, number, number],
    viewpoint: row.viewpoint as Clash["viewpoint"],
    assignee: (row.assignee as string | null) ?? undefined,
    labels: row.labels as string[],
    createdAt:
      (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
    modifiedDate: row.modified_at
      ? ((row.modified_at as Date)?.toISOString?.() ??
        (row.modified_at as string))
      : undefined,
    creationAuthor: (row.creation_author as string | null) ?? undefined,
    linearIssueId: (row.linear_issue_id as string | null) ?? undefined,
  };
}

// ── Clashes ──────────────────────────────────────────────────────────────────

export async function listClashes(): Promise<Clash[]> {
  const { rows } = await pool.query(
    "SELECT * FROM clashes ORDER BY created_at DESC",
  );
  return rows.map(rowToClash);
}

export async function getClash(guid: string): Promise<Clash | null> {
  const { rows } = await pool.query("SELECT * FROM clashes WHERE guid = $1", [
    guid,
  ]);
  return rows.length > 0 ? rowToClash(rows[0]) : null;
}

export async function clashCount(): Promise<number> {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM clashes");
  return rows[0].n;
}

export async function insertClash(clash: Clash): Promise<void> {
  await pool.query(
    `INSERT INTO clashes
       (guid, id, title, description, status, priority, rule_id,
        ifc_guid_a, ifc_guid_b, file_a, file_b, midpoint, viewpoint,
        assignee, labels, created_at, modified_at, creation_author, linear_issue_id)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19)
     ON CONFLICT (guid) DO NOTHING`,
    [
      clash.guid,
      clash.id,
      clash.title,
      clash.description,
      clash.status,
      clash.priority,
      clash.ruleId,
      clash.ifcGuidA,
      clash.ifcGuidB,
      clash.fileA,
      clash.fileB,
      JSON.stringify(clash.midpoint),
      JSON.stringify(clash.viewpoint),
      clash.assignee ?? null,
      JSON.stringify(clash.labels),
      clash.createdAt,
      clash.modifiedDate ?? null,
      clash.creationAuthor ?? null,
      clash.linearIssueId ?? null,
    ],
  );
}

export async function upsertClash(clash: Clash): Promise<void> {
  await pool.query(
    `INSERT INTO clashes
       (guid, id, title, description, status, priority, rule_id,
        ifc_guid_a, ifc_guid_b, file_a, file_b, midpoint, viewpoint,
        assignee, labels, created_at, modified_at, creation_author, linear_issue_id)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19)
     ON CONFLICT (guid) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       status = EXCLUDED.status,
       priority = EXCLUDED.priority,
       rule_id = EXCLUDED.rule_id,
       ifc_guid_a = EXCLUDED.ifc_guid_a,
       ifc_guid_b = EXCLUDED.ifc_guid_b,
       file_a = EXCLUDED.file_a,
       file_b = EXCLUDED.file_b,
       midpoint = EXCLUDED.midpoint,
       viewpoint = EXCLUDED.viewpoint,
       assignee = EXCLUDED.assignee,
       labels = EXCLUDED.labels,
       modified_at = now(),
       creation_author = EXCLUDED.creation_author,
       linear_issue_id = EXCLUDED.linear_issue_id`,
    [
      clash.guid,
      clash.id,
      clash.title,
      clash.description,
      clash.status,
      clash.priority,
      clash.ruleId,
      clash.ifcGuidA,
      clash.ifcGuidB,
      clash.fileA,
      clash.fileB,
      JSON.stringify(clash.midpoint),
      JSON.stringify(clash.viewpoint),
      clash.assignee ?? null,
      JSON.stringify(clash.labels),
      clash.createdAt,
      clash.modifiedDate ?? null,
      clash.creationAuthor ?? null,
      clash.linearIssueId ?? null,
    ],
  );
}

export async function updateClash(
  guid: string,
  patch: Partial<Clash>,
): Promise<void> {
  const fieldMap: Record<string, string> = {
    title: "title",
    description: "description",
    status: "status",
    priority: "priority",
    assignee: "assignee",
    labels: "labels",
    linearIssueId: "linear_issue_id",
    ruleId: "rule_id",
    ifcGuidA: "ifc_guid_a",
    ifcGuidB: "ifc_guid_b",
    fileA: "file_a",
    fileB: "file_b",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch) {
      sets.push(`${col} = $${idx}`);
      const v = (patch as Record<string, unknown>)[key];
      values.push(key === "labels" ? JSON.stringify(v) : (v ?? null));
      idx++;
    }
  }
  if (sets.length === 0) return;
  sets.push(`modified_at = now()`);
  values.push(guid);
  await pool.query(
    `UPDATE clashes SET ${sets.join(", ")} WHERE guid = $${idx}`,
    values,
  );
}

export async function deleteClash(guid: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM clashes WHERE guid = $1", [
    guid,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAllClashes(): Promise<void> {
  await pool.query("DELETE FROM clashes");
}

export async function setClashLinearIssueId(
  guid: string,
  linearIssueId: string,
): Promise<void> {
  await pool.query(
    "UPDATE clashes SET linear_issue_id = $1, modified_at = now() WHERE guid = $2",
    [linearIssueId, guid],
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────

export async function getActivity(clashGuid: string): Promise<ActivityEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, clash_guid AS "clashGuid", type, actor, timestamp,
            field, from_value AS "from", to_value AS "to", body
     FROM activity WHERE clash_guid = $1 ORDER BY timestamp ASC`,
    [clashGuid],
  );
  return rows.map((r) => ({
    ...r,
    timestamp:
      r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
  }));
}

export async function addActivity(
  entry: Omit<ActivityEntry, "id">,
): Promise<ActivityEntry> {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO activity (id, clash_guid, type, actor, timestamp, field, from_value, to_value, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      entry.clashGuid,
      entry.type,
      entry.actor,
      entry.timestamp,
      entry.field ?? null,
      entry.from ?? null,
      entry.to ?? null,
      entry.body ?? null,
    ],
  );
  return { id, ...entry };
}

export async function deleteActivity(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM activity WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// ── Comments ─────────────────────────────────────────────────────────────────

export async function getComments(clashGuid: string): Promise<Comment[]> {
  const { rows } = await pool.query(
    `SELECT id, clash_guid AS "clashGuid", actor, timestamp, body
     FROM comments WHERE clash_guid = $1 ORDER BY timestamp ASC`,
    [clashGuid],
  );
  return rows.map((r) => ({
    ...r,
    timestamp:
      r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
  }));
}

export async function addComment(
  comment: Omit<Comment, "id">,
): Promise<Comment> {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO comments (id, clash_guid, actor, timestamp, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, comment.clashGuid, comment.actor, comment.timestamp, comment.body],
  );
  return { id, ...comment };
}

export async function deleteComment(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM comments WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export async function getSnapshot(clashGuid: string): Promise<string | null> {
  const { rows } = await pool.query(
    "SELECT snapshot_path FROM snapshots WHERE clash_guid = $1",
    [clashGuid],
  );
  return rows[0]?.snapshot_path ?? null;
}

export async function setSnapshot(
  clashGuid: string,
  snapshotPath: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO snapshots (clash_guid, snapshot_path, generated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (clash_guid) DO UPDATE SET snapshot_path = EXCLUDED.snapshot_path, generated_at = now()`,
    [clashGuid, snapshotPath],
  );
}

export async function getAllSnapshots(): Promise<
  Array<{ clashGuid: string; snapshotPath: string }>
> {
  const { rows } = await pool.query(
    "SELECT clash_guid, snapshot_path FROM snapshots",
  );
  return rows.map((r) => ({
    clashGuid: r.clash_guid,
    snapshotPath: r.snapshot_path,
  }));
}

// ── IFC Models ───────────────────────────────────────────────────────────────

export async function listIfcModels(): Promise<IfcModel[]> {
  const { rows } = await pool.query(
    "SELECT * FROM ifc_models ORDER BY uploaded_at ASC",
  );
  return rows.map((r) => ({
    filename: r.filename,
    displayName: r.display_name,
    uploadedAt:
      r.uploaded_at instanceof Date
        ? r.uploaded_at.toISOString()
        : r.uploaded_at,
    elementCount: r.element_count,
    parsedAt: r.parsed_at
      ? r.parsed_at instanceof Date
        ? r.parsed_at.toISOString()
        : r.parsed_at
      : null,
  }));
}

export async function getIfcModel(filename: string): Promise<IfcModel | null> {
  const { rows } = await pool.query(
    "SELECT * FROM ifc_models WHERE filename = $1",
    [filename],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    filename: r.filename,
    displayName: r.display_name,
    uploadedAt:
      r.uploaded_at instanceof Date
        ? r.uploaded_at.toISOString()
        : r.uploaded_at,
    elementCount: r.element_count,
    parsedAt: r.parsed_at
      ? r.parsed_at instanceof Date
        ? r.parsed_at.toISOString()
        : r.parsed_at
      : null,
  };
}

export async function upsertIfcModel(
  model: Omit<IfcModel, "elementCount" | "parsedAt">,
): Promise<void> {
  await pool.query(
    `INSERT INTO ifc_models (filename, display_name, uploaded_at, element_count, parsed_at)
     VALUES ($1, $2, $3, 0, NULL)
     ON CONFLICT (filename) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [model.filename, model.displayName, model.uploadedAt],
  );
}

export async function markIfcModelParsed(
  filename: string,
  elementCount: number,
): Promise<void> {
  await pool.query(
    "UPDATE ifc_models SET parsed_at = now(), element_count = $1 WHERE filename = $2",
    [elementCount, filename],
  );
}

export async function deleteIfcModel(filename: string): Promise<void> {
  await pool.query("DELETE FROM ifc_models WHERE filename = $1", [filename]);
}

// ── IFC Elements ─────────────────────────────────────────────────────────────

function rowToElement(r: Record<string, unknown>): IfcElement {
  return {
    id: r.id as number,
    modelFilename: r.model_filename as string,
    expressId: r.express_id as number,
    globalId: r.global_id as string,
    ifcType: r.ifc_type as string,
    name: (r.name as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    properties:
      typeof r.properties === "string"
        ? r.properties
        : JSON.stringify(r.properties),
  };
}

export async function getElementsForModel(
  modelFilename: string,
): Promise<IfcElement[]> {
  const { rows } = await pool.query(
    "SELECT * FROM ifc_elements WHERE model_filename = $1 ORDER BY express_id ASC",
    [modelFilename],
  );
  return rows.map(rowToElement);
}

export async function getElementByGlobalId(
  globalId: string,
): Promise<IfcElement | null> {
  const { rows } = await pool.query(
    "SELECT * FROM ifc_elements WHERE global_id = $1 LIMIT 1",
    [globalId],
  );
  return rows.length > 0 ? rowToElement(rows[0]) : null;
}

export async function getAllElements(): Promise<IfcElement[]> {
  const { rows } = await pool.query(
    "SELECT * FROM ifc_elements ORDER BY model_filename, express_id ASC",
  );
  return rows.map(rowToElement);
}

export async function replaceElementsForModel(
  modelFilename: string,
  elements: Omit<IfcElement, "id">[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM ifc_elements WHERE model_filename = $1", [
      modelFilename,
    ]);
    for (const el of elements) {
      await client.query(
        `INSERT INTO ifc_elements (model_filename, express_id, global_id, ifc_type, name, description, properties)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          el.modelFilename,
          el.expressId,
          el.globalId,
          el.ifcType,
          el.name,
          el.description,
          el.properties,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Backfill clash files from ifc_elements ───────────────────────────────────

function deriveRuleIdFromFiles(fileA: string, fileB: string): string {
  const stem = (f: string) => {
    const base =
      f
        .replace(/\.ifc$/i, "")
        .split(/[_\-.]+/)
        .pop() ?? f;
    return base.toUpperCase();
  };
  const a = stem(fileA);
  const b = stem(fileB);
  if (!a && !b) return "";
  if (!b) return a;
  if (!a) return b;
  return `${a}×${b}`;
}

export async function backfillClashFiles(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT guid, ifc_guid_a, ifc_guid_b, rule_id
     FROM clashes
     WHERE (file_a = '' OR file_a IS NULL)
       AND (ifc_guid_a != '' AND ifc_guid_a IS NOT NULL)`,
  );
  for (const row of rows) {
    const aRes = await pool.query(
      "SELECT model_filename FROM ifc_elements WHERE global_id = $1 LIMIT 1",
      [row.ifc_guid_a],
    );
    const bRes = await pool.query(
      "SELECT model_filename FROM ifc_elements WHERE global_id = $1 LIMIT 1",
      [row.ifc_guid_b],
    );
    const fileA = aRes.rows[0]?.model_filename ?? "";
    const fileB = bRes.rows[0]?.model_filename ?? "";
    if (fileA || fileB) {
      const ruleId =
        row.rule_id && row.rule_id !== "UNKNOWN" && row.rule_id !== "Clash"
          ? row.rule_id
          : deriveRuleIdFromFiles(fileA, fileB) || row.rule_id;
      await pool.query(
        "UPDATE clashes SET file_a = $1, file_b = $2, rule_id = $3 WHERE guid = $4",
        [fileA, fileB, ruleId, row.guid],
      );
    }
  }
}

// ── Linear Settings ──────────────────────────────────────────────────────────

export async function getLinearSettings(): Promise<LinearSettings | null> {
  const { rows } = await pool.query(
    "SELECT access_token, workspace_id, team_id, project_id FROM linear_settings WHERE id = 1",
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    accessToken: r.access_token,
    workspaceId: r.workspace_id,
    teamId: r.team_id,
    projectId: r.project_id,
  };
}

export async function saveLinearSettings(
  settings: LinearSettings,
): Promise<void> {
  await pool.query(
    `INSERT INTO linear_settings (id, access_token, workspace_id, team_id, project_id)
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       workspace_id = EXCLUDED.workspace_id,
       team_id      = EXCLUDED.team_id,
       project_id   = EXCLUDED.project_id`,
    [
      settings.accessToken,
      settings.workspaceId,
      settings.teamId,
      settings.projectId,
    ],
  );
}
