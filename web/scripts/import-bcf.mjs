/**
 * import-bcf.mjs
 *
 * Parse a .bcfzip archive and insert the resulting clashes into db/clashero.db.
 *
 * Usage (run from repo root or web/):
 *   node web/scripts/import-bcf.mjs [path/to/file.bcfzip]
 *
 * Defaults to tests/hvac.bcfzip (relative to repo root).
 */

import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Resolve paths ─────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DB_DIR = path.join(REPO_ROOT, "db");
const DB_PATH = path.join(DB_DIR, "clashero.db");

const inputArg = process.argv[2];
const BCF_PATH = inputArg
  ? path.resolve(process.cwd(), inputArg)
  : path.join(REPO_ROOT, "tests", "hvac.bcfzip");

// ── Deps ──────────────────────────────────────────────────────────────────────

const JSZip = (await import("jszip")).default;
const { XMLParser } = await import("fast-xml-parser");
const Database = require("better-sqlite3");

// ── XML parser ────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    ["Component", "ViewPoint", "Label", "Comment"].includes(name),
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toVec3(obj) {
  return [obj?.X ?? 0, obj?.Y ?? 0, obj?.Z ?? 0];
}

function parseStatus(raw) {
  if (!raw) return "open";
  const s = raw.toLowerCase().replace(/[\s_-]+/g, "_");
  if (s.includes("progress")) return "in_progress";
  if (s.includes("review")) return "in_review";
  if (s.includes("resolv") || s.includes("closed") || s.includes("done"))
    return "resolved";
  if (s.includes("close")) return "closed";
  return "open";
}

function parsePriority(raw) {
  if (!raw) return "none";
  const p = raw.toLowerCase();
  if (p.includes("critical") || p.includes("urgent")) return "urgent";
  if (p.includes("high") || p.includes("major")) return "high";
  if (p.includes("med")) return "medium";
  if (p.includes("low") || p.includes("minor")) return "low";
  return "none";
}

function extractGuids(vi) {
  const raw = vi?.Components?.Selection?.Component;
  const components = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const guids = components.map((c) => c["@_IfcGuid"] ?? "").filter(Boolean);
  return [guids[0] ?? "", guids[1] ?? ""];
}

function deriveRuleId(fileA, fileB) {
  const stem = (f) => {
    const base = f.replace(/\.ifc$/i, "").split(/[_\-.]/).pop() ?? f;
    return base.toUpperCase();
  };
  const a = stem(fileA);
  const b = stem(fileB);
  if (!a && !b) return "UNKNOWN";
  if (!b) return a;
  if (!a) return b;
  return `${a}x${b}`;
}

// ── BCF parser ────────────────────────────────────────────────────────────────

async function parseBcf(data) {
  const zip = await JSZip.loadAsync(data);
  const clashes = [];

  const topicGuids = new Set();
  zip.forEach((relativePath) => {
    const parts = relativePath.split("/");
    if (parts.length >= 2 && parts[0]) topicGuids.add(parts[0]);
  });

  let index = 1;

  for (const topicGuid of topicGuids) {
    const markupFile = zip.file(`${topicGuid}/markup.bcf`);
    if (!markupFile) continue;

    const markupXml = await markupFile.async("text");
    const parsed = xmlParser.parse(markupXml);
    const topic = parsed?.Markup?.Topic;
    if (!topic) continue;

    const guid = topic["@_Guid"] ?? topicGuid;
    const title = topic.Title ?? `Clash ${index}`;
    const description = topic.Description ?? "";
    const status = parseStatus(topic["@_TopicStatus"]);
    const priority = parsePriority(topic.Priority);
    const assignee = topic.AssignedTo ?? null;
    const createdAt = topic.CreationDate ?? new Date().toISOString();

    let labels = [];
    if (topic.Labels) {
      if (typeof topic.Labels === "string") {
        labels = [topic.Labels];
      } else if (typeof topic.Labels === "object") {
        const raw = topic.Labels.Label;
        if (Array.isArray(raw)) labels = raw;
        else if (raw) labels = [raw];
      }
    }

    const vpRefs = parsed?.Markup?.Viewpoints?.ViewPoint;
    const vpRefArray = Array.isArray(vpRefs) ? vpRefs : vpRefs ? [vpRefs] : [];

    let viewpoint = {
      cameraPosition: [0, 10, 20],
      cameraDirection: [0, -0.4, -0.9],
      cameraUpVector: [0, 1, 0],
      target: [0, 0, 0],
    };
    let ifcGuidA = "";
    let ifcGuidB = "";
    let fileA = "";
    let fileB = "";

    if (vpRefArray.length > 0) {
      const vpFilename =
        vpRefArray[0].Viewpoint ?? `${vpRefArray[0]["@_Guid"]}.bcfv`;
      const vpFile = zip.file(`${topicGuid}/${vpFilename}`);
      if (vpFile) {
        const vpXml = await vpFile.async("text");
        const vpParsed = xmlParser.parse(vpXml);
        const vi = vpParsed?.VisualizationInfo;
        if (vi) {
          const cam = vi.PerspectiveCamera ?? vi.OrthogonalCamera;
          if (cam) {
            const pos = toVec3(cam.CameraViewPoint);
            const dir = toVec3(cam.CameraDirection);
            const up = toVec3(cam.CameraUpVector);
            const target = [
              pos[0] + dir[0] * 10,
              pos[1] + dir[1] * 10,
              pos[2] + dir[2] * 10,
            ];
            viewpoint = { cameraPosition: pos, cameraDirection: dir, cameraUpVector: up, target };
          }
          [ifcGuidA, ifcGuidB] = extractGuids(vi);
          const raw = vi.Components?.Selection?.Component;
          const components = Array.isArray(raw) ? raw : raw ? [raw] : [];
          fileA = components[0]?.OriginatingSystem ?? "";
          fileB = components[1]?.OriginatingSystem ?? "";
        }
      }
    }

    const midpoint = [...viewpoint.target];
    const ruleId =
      fileA && fileB ? deriveRuleId(fileA, fileB) : topic["@_TopicType"] ?? "UNKNOWN";
    const id = `CLH-${String(index).padStart(3, "0")}`;

    clashes.push({
      guid,
      id,
      title,
      description,
      status,
      priority,
      ruleId,
      ifcGuidA,
      ifcGuidB,
      fileA,
      fileB,
      midpoint,
      viewpoint,
      assignee,
      labels,
      createdAt,
    });

    index++;
  }

  clashes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Re-assign stable CLH-NNN ids after sort
  clashes.forEach((c, i) => {
    c.id = `CLH-${String(i + 1).padStart(3, "0")}`;
  });

  return clashes;
}

// ── DB ────────────────────────────────────────────────────────────────────────

function openDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
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
  `);

  const cols = db.pragma("table_info(clashes)");
  if (!cols.some((c) => c.name === "linearIssueId")) {
    db.exec("ALTER TABLE clashes ADD COLUMN linearIssueId TEXT");
  }

  return db;
}

function insertClash(db, clash) {
  db.prepare(`
    INSERT OR REPLACE INTO clashes
      (guid, id, title, description, status, priority, ruleId,
       ifcGuidA, ifcGuidB, fileA, fileB, midpoint, viewpoint,
       assignee, labels, createdAt, linearIssueId)
    VALUES
      (@guid, @id, @title, @description, @status, @priority, @ruleId,
       @ifcGuidA, @ifcGuidB, @fileA, @fileB, @midpoint, @viewpoint,
       @assignee, @labels, @createdAt, @linearIssueId)
  `).run({
    ...clash,
    midpoint: JSON.stringify(clash.midpoint),
    viewpoint: JSON.stringify(clash.viewpoint),
    labels: JSON.stringify(clash.labels),
    assignee: clash.assignee ?? null,
    linearIssueId: null,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`Reading BCF archive: ${BCF_PATH}`);

if (!fs.existsSync(BCF_PATH)) {
  console.error(`File not found: ${BCF_PATH}`);
  process.exit(1);
}

const buf = fs.readFileSync(BCF_PATH);
const clashes = await parseBcf(buf.buffer);

console.log(`Parsed ${clashes.length} clash(es).`);

const db = openDb();

const insertAll = db.transaction((list) => {
  for (const c of list) insertClash(db, c);
});

insertAll(clashes);

console.log(`Inserted/replaced ${clashes.length} clash(es) into ${DB_PATH}`);

for (const c of clashes) {
  console.log(`  ${c.id}  [${c.status}]  ${c.title}`);
}
