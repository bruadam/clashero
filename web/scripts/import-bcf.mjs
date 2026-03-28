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
const DB_DIR    = path.join(REPO_ROOT, "db");
const DB_PATH   = path.join(DB_DIR, "clashero.db");

const inputArg = process.argv[2];
const BCF_PATH = inputArg
  ? path.resolve(process.cwd(), inputArg)
  : path.join(REPO_ROOT, "tests", "hvac.bcfzip");

// ── Deps ──────────────────────────────────────────────────────────────────────

const JSZip    = (await import("jszip")).default;
const { XMLParser } = await import("fast-xml-parser");
const Database = require("better-sqlite3");

// ── XML parser ────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes:   false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    ["Component", "ViewPoint", "Label", "Comment"].includes(name),
  parseAttributeValue: true,
  parseTagValue:       true,
  trimValues:          true,
});

// ── Unit conversion ───────────────────────────────────────────────────────────

const UNIT_TO_METRES = {
  millimetre: 0.001,
  centimetre: 0.01,
  metre:      1,
  inch:       0.0254,
  foot:       0.3048,
};

async function parseProjectUnit(zip) {
  const projectFile =
    zip.file("project.bcfp") ||
    zip.file("Project.bcfp") ||
    zip.file("project.bcf");

  if (!projectFile) return 1;

  try {
    const xml    = await projectFile.async("text");
    const parsed = xmlParser.parse(xml);
    const raw    = parsed?.ProjectExtension?.Project?.Unit?.toLowerCase().trim();
    return raw && raw in UNIT_TO_METRES ? UNIT_TO_METRES[raw] : 1;
  } catch {
    return 1;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toVec3(obj, scale) {
  const s = scale ?? 1;
  return [(obj?.X ?? 0) * s, (obj?.Y ?? 0) * s, (obj?.Z ?? 0) * s];
}

function parseStatus(raw) {
  if (!raw) return "open";
  const s = raw.toLowerCase().replace(/[\s_-]+/g, "_");
  if (s.includes("progress"))                         return "in_progress";
  if (s.includes("review"))                           return "in_review";
  if (s.includes("resolv") || s.includes("done"))     return "resolved";
  if (s.includes("close"))                            return "closed";
  return "open";
}

function parsePriority(raw) {
  if (!raw) return "none";
  const p = raw.toLowerCase();
  if (p.includes("critical") || p.includes("urgent")) return "urgent";
  if (p.includes("high") || p.includes("major"))      return "high";
  if (p.includes("med"))                               return "medium";
  if (p.includes("low") || p.includes("minor"))       return "low";
  return "none";
}

function extractGuidsFromVp(vi) {
  const raw = vi?.Components?.Selection?.Component;
  const components = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return components.map((c) => c["@_IfcGuid"] || "").filter(Boolean);
}

function extractGuidsFromBimSnippet(ref) {
  if (!ref) return [];
  return ref.split(/[,;\s]+/).map((g) => g.trim()).filter((g) => g.length > 0);
}

function deriveRuleId(fileA, fileB) {
  const stem = (f) => {
    const base = f.replace(/\.ifc$/i, "").split(/[_\-.]+/).pop() || f;
    return base.toUpperCase();
  };
  const a = stem(fileA);
  const b = stem(fileB);
  if (!a && !b) return "UNKNOWN";
  if (!b)       return a;
  if (!a)       return b;
  return a + "x" + b;
}

// ── BCF parser ────────────────────────────────────────────────────────────────

async function parseBcf(data) {
  const zip       = await JSZip.loadAsync(data);
  const unitScale = await parseProjectUnit(zip);

  console.log(`  Unit scale detected: ${unitScale} (multiply coords to get metres)`);

  // Map topic folder -> [.bcfv filenames] for fallback when Viewpoints is absent
  const bcfvByTopic = new Map();
  zip.forEach((relativePath) => {
    const parts = relativePath.split("/");
    if (parts.length === 2 && parts[1].endsWith(".bcfv")) {
      const folder = parts[0];
      if (!bcfvByTopic.has(folder)) bcfvByTopic.set(folder, []);
      bcfvByTopic.get(folder).push(parts[1]);
    }
  });

  const topicGuids = new Set();
  zip.forEach((relativePath) => {
    const parts = relativePath.split("/");
    if (parts.length >= 2 && parts[0]) topicGuids.add(parts[0]);
  });

  const clashes = [];
  let index = 1;

  for (const topicGuid of topicGuids) {
    const markupFile = zip.file(topicGuid + "/markup.bcf");
    if (!markupFile) continue;

    const markupXml = await markupFile.async("text");
    const parsed    = xmlParser.parse(markupXml);
    const markup    = parsed && parsed.Markup;
    const topic     = markup && markup.Topic;
    if (!topic) continue;

    const guid           = topic["@_Guid"] || topicGuid;
    const title          = topic.Title || ("Clash " + index);
    const description    = topic.Description || "";
    const status         = parseStatus(topic["@_TopicStatus"]);
    const priority       = parsePriority(topic.Priority);
    const assignee       = topic.AssignedTo || null;
    const createdAt      = topic.CreationDate || new Date().toISOString();
    const modifiedDate   = topic.ModifiedDate || null;
    const creationAuthor = topic.CreationAuthor || null;

    let labels = [];
    if (topic.Labels) {
      if (typeof topic.Labels === "string") {
        labels = [topic.Labels];
      } else {
        const raw = topic.Labels.Label;
        if (Array.isArray(raw)) labels = raw.map(String);
        else if (raw != null)   labels = [String(raw)];
      }
    }

    // GUIDs from BIMSnippet
    const snippetGuids = extractGuidsFromBimSnippet(markup.BIMSnippet && markup.BIMSnippet.Reference);

    // Resolve .bcfv filenames: from Viewpoints list, or folder scan
    const vpRefs       = markup.Viewpoints && markup.Viewpoints.ViewPoint;
    const vpRefArray   = Array.isArray(vpRefs) ? vpRefs : vpRefs ? [vpRefs] : [];
    const bcfvFilenames = vpRefArray.length > 0
      ? vpRefArray.map((ref) => ref.Viewpoint || (ref["@_Guid"] + ".bcfv"))
      : (bcfvByTopic.get(topicGuid) || []);

    let viewpoint = {
      cameraPosition: [0, 10, 20],
      cameraDirection: [0, -0.4, -0.9],
      cameraUpVector:  [0, 1, 0],
      target:          [0, 0, 0],
    };
    let vpGuids = [];
    let fileA   = "";
    let fileB   = "";

    for (const vpFilename of bcfvFilenames) {
      const vpFile = zip.file(topicGuid + "/" + vpFilename);
      if (!vpFile) continue;

      const vpXml    = await vpFile.async("text");
      const vpParsed = xmlParser.parse(vpXml);
      const vi       = vpParsed && vpParsed.VisualizationInfo;
      if (!vi) continue;

      const isPerspective = !!vi.PerspectiveCamera;
      const cam = vi.PerspectiveCamera || vi.OrthogonalCamera;

      if (cam) {
        const pos = toVec3(cam.CameraViewPoint, unitScale);
        const dir = toVec3(cam.CameraDirection);
        const up  = toVec3(cam.CameraUpVector);
        const target = [pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2]];

        viewpoint = {
          cameraPosition: pos,
          cameraDirection: dir,
          cameraUpVector:  up,
          target,
          cameraType: isPerspective ? "perspective" : "orthogonal",
        };
        if (isPerspective && cam.FieldOfView != null) {
          viewpoint.fieldOfView = cam.FieldOfView;
        }
        if (!isPerspective && cam.ViewToWorldScale != null) {
          viewpoint.orthogonalScale = cam.ViewToWorldScale * unitScale;
        }
      }

      vpGuids = extractGuidsFromVp(vi);

      const rawComponents = vi.Components && vi.Components.Selection && vi.Components.Selection.Component;
      const components = Array.isArray(rawComponents) ? rawComponents : rawComponents ? [rawComponents] : [];
      fileA = (components[0] && components[0].OriginatingSystem) || "";
      fileB = (components[1] && components[1].OriginatingSystem) || "";

      break;
    }

    // Merge GUIDs: BIMSnippet wins if it has >= 2 entries
    const allGuids = snippetGuids.length >= 2
      ? snippetGuids
      : Array.from(new Set([...snippetGuids, ...vpGuids]));

    const ifcGuidA  = allGuids[0] || "";
    const ifcGuidB  = allGuids[1] || "";
    const midpoint  = viewpoint.target.slice();
    const ruleId    = fileA && fileB ? deriveRuleId(fileA, fileB) : (topic["@_TopicType"] || "UNKNOWN");
    const id        = "CLH-" + String(index).padStart(3, "0");

    clashes.push({
      guid, id, title, description, status, priority, ruleId,
      ifcGuidA, ifcGuidB, fileA, fileB, midpoint, viewpoint,
      assignee, labels, createdAt, modifiedDate, creationAuthor,
    });

    index++;
  }

  clashes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  clashes.forEach((c, i) => {
    c.id = "CLH-" + String(i + 1).padStart(3, "0");
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
      guid            TEXT PRIMARY KEY,
      id              TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'open',
      priority        TEXT NOT NULL DEFAULT 'none',
      ruleId          TEXT NOT NULL DEFAULT '',
      ifcGuidA        TEXT NOT NULL DEFAULT '',
      ifcGuidB        TEXT NOT NULL DEFAULT '',
      fileA           TEXT NOT NULL DEFAULT '',
      fileB           TEXT NOT NULL DEFAULT '',
      midpoint        TEXT NOT NULL DEFAULT '[0,0,0]',
      viewpoint       TEXT NOT NULL DEFAULT '{}',
      assignee        TEXT,
      labels          TEXT NOT NULL DEFAULT '[]',
      createdAt       TEXT NOT NULL,
      modifiedDate    TEXT,
      creationAuthor  TEXT,
      linearIssueId   TEXT
    );
  `);

  const cols = db.pragma("table_info(clashes)").map((c) => c.name);
  if (!cols.includes("linearIssueId"))  db.exec("ALTER TABLE clashes ADD COLUMN linearIssueId TEXT");
  if (!cols.includes("modifiedDate"))   db.exec("ALTER TABLE clashes ADD COLUMN modifiedDate TEXT");
  if (!cols.includes("creationAuthor")) db.exec("ALTER TABLE clashes ADD COLUMN creationAuthor TEXT");

  return db;
}

function insertClash(db, clash) {
  db.prepare(`
    INSERT OR REPLACE INTO clashes
      (guid, id, title, description, status, priority, ruleId,
       ifcGuidA, ifcGuidB, fileA, fileB, midpoint, viewpoint,
       assignee, labels, createdAt, modifiedDate, creationAuthor, linearIssueId)
    VALUES
      (@guid, @id, @title, @description, @status, @priority, @ruleId,
       @ifcGuidA, @ifcGuidB, @fileA, @fileB, @midpoint, @viewpoint,
       @assignee, @labels, @createdAt, @modifiedDate, @creationAuthor, @linearIssueId)
  `).run({
    ...clash,
    midpoint:       JSON.stringify(clash.midpoint),
    viewpoint:      JSON.stringify(clash.viewpoint),
    labels:         JSON.stringify(clash.labels),
    assignee:       clash.assignee       || null,
    modifiedDate:   clash.modifiedDate   || null,
    creationAuthor: clash.creationAuthor || null,
    linearIssueId:  null,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("Reading BCF archive: " + BCF_PATH);

if (!fs.existsSync(BCF_PATH)) {
  console.error("File not found: " + BCF_PATH);
  process.exit(1);
}

const buf     = fs.readFileSync(BCF_PATH);
const clashes = await parseBcf(buf.buffer);

console.log("Parsed " + clashes.length + " clash(es).");

const db = openDb();

const insertAll = db.transaction((list) => {
  for (const c of list) insertClash(db, c);
});

insertAll(clashes);

console.log("Inserted/replaced " + clashes.length + " clash(es) into " + DB_PATH);
console.log("");

for (const c of clashes) {
  const cam = c.viewpoint.cameraPosition;
  let line = "  " + c.id + "  [" + c.status + "]  " + c.title + "\n";
  line += "         GUIDs: " + (c.ifcGuidA || "—") + " / " + (c.ifcGuidB || "—") + "\n";
  line += "         Camera: (" + cam[0].toFixed(3) + ", " + cam[1].toFixed(3) + ", " + cam[2].toFixed(3) + ") m";
  if (c.viewpoint.cameraType) line += "  type=" + c.viewpoint.cameraType;
  if (c.viewpoint.fieldOfView != null) line += "  fov=" + c.viewpoint.fieldOfView + "deg";
  console.log(line + "\n");
}
