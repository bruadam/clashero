/**
 * parse-ifc.mjs
 *
 * Standalone IFC -> SQLite parser. No server required.
 *
 * Reads IFC files from models/Building/, parses every element with web-ifc,
 * and writes elements + model metadata into db/clashero.db.
 *
 * Usage:
 *   node web/scripts/parse-ifc.mjs                     # parse all .ifc files
 *   node web/scripts/parse-ifc.mjs Building-Hvac.ifc   # parse a single file
 *
 * Run from repo root or web/.
 */

import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// web/scripts/ -> web/ -> repo root
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WEB_DIR = path.resolve(__dirname, "..");
const MODELS_DIR = path.join(REPO_ROOT, "models", "Building");
const DB_DIR = path.join(REPO_ROOT, "db");
const DB_PATH = path.join(DB_DIR, "clashero.db");

const require = createRequire(import.meta.url);

// -- DB setup ------------------------------------------------------------------

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const Database = require(path.join(WEB_DIR, "node_modules", "better-sqlite3"));
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
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
  CREATE INDEX IF NOT EXISTS idx_elements_model    ON ifc_elements(modelFilename);
  CREATE INDEX IF NOT EXISTS idx_elements_globalId ON ifc_elements(globalId);
`);

const upsertModel = db.prepare(`
  INSERT INTO ifc_models (filename, displayName, uploadedAt, elementCount, parsedAt)
  VALUES (@filename, @displayName, @uploadedAt, 0, NULL)
  ON CONFLICT(filename) DO UPDATE SET displayName = excluded.displayName
`);

const deleteElements = db.prepare(`DELETE FROM ifc_elements WHERE modelFilename = ?`);

const insertElement = db.prepare(`
  INSERT INTO ifc_elements (modelFilename, expressId, globalId, ifcType, name, description, properties)
  VALUES (@modelFilename, @expressId, @globalId, @ifcType, @name, @description, @properties)
`);

const markParsed = db.prepare(`
  UPDATE ifc_models SET parsedAt = ?, elementCount = ? WHERE filename = ?
`);

// -- IFC parsing ---------------------------------------------------------------

const { IfcAPI } = await import(
  path.join(WEB_DIR, "node_modules", "web-ifc", "web-ifc-api-node.js")
);

async function parseFile(filename) {
  const filePath = path.join(MODELS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`  x File not found: ${filePath}`);
    return;
  }

  console.log(`\nParsing ${filename} ...`);

  const wasmDir = path.join(WEB_DIR, "node_modules", "web-ifc") + "/";
  const ifcApi = new IfcAPI();
  ifcApi.SetWasmPath(wasmDir, true);
  await ifcApi.Init();

  const data = fs.readFileSync(filePath);
  const modelId = ifcApi.OpenModel(new Uint8Array(data));

  const allLines = ifcApi.GetAllLines(modelId);
  const elements = [];
  const seen = new Set();

  for (let i = 0; i < allLines.size(); i++) {
    const expressId = allLines.get(i);
    if (seen.has(expressId)) continue;
    seen.add(expressId);

    let line;
    try {
      line = ifcApi.GetLine(modelId, expressId, false);
    } catch {
      continue;
    }

    if (!line || typeof line !== "object") continue;

    const globalId = line.GlobalId?.value ?? "";
    if (!globalId) continue;

    const ifcType = ifcApi.GetNameFromTypeCode(line.type) ?? String(line.type);
    // Skip pure relationship / property entities — keep only physical/spatial elements
    if (ifcType.startsWith("IfcRel") || ifcType === "IfcPropertySingleValue") continue;

    const name = line.Name?.value ?? null;
    const description = line.Description?.value ?? null;
    const properties = {};

    if (line.ObjectType?.value) properties["ObjectType"] = line.ObjectType.value;
    if (line.Tag?.value) properties["Tag"] = line.Tag.value;

    try {
      const psets = await ifcApi.properties.getPropertySets(modelId, expressId, true);
      for (const pset of psets) {
        if (!pset || typeof pset !== "object") continue;
        const psetName = pset.Name?.value ?? "Properties";
        for (const prop of (pset.HasProperties ?? [])) {
          if (!prop || typeof prop !== "object") continue;
          const key = prop.Name?.value;
          const val = prop.NominalValue?.value;
          if (key && val !== undefined && val !== null) {
            properties[`${psetName}.${key}`] = String(val);
          }
        }
      }
    } catch {
      // property sets unavailable - continue with basic attrs
    }

    elements.push({
      modelFilename: filename,
      expressId,
      globalId,
      ifcType,
      name,
      description,
      properties: JSON.stringify(properties),
    });
  }

  ifcApi.CloseModel(modelId);

  // Write to DB in a single transaction
  const persist = db.transaction(() => {
    deleteElements.run(filename);
    for (const el of elements) insertElement.run(el);
  });
  persist();
  markParsed.run(new Date().toISOString(), elements.length, filename);

  console.log(`  -> ${elements.length} elements written to db`);
}

// -- Entry point ---------------------------------------------------------------

const targets = process.argv.slice(2).filter((a) => a.endsWith(".ifc"));

if (targets.length === 0) {
  // Parse all .ifc files in models/Building/
  const files = fs
    .readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith(".ifc"));

  if (files.length === 0) {
    console.error(`No .ifc files found in ${MODELS_DIR}`);
    process.exit(1);
  }

  for (const f of files) {
    upsertModel.run({
      filename: f,
      displayName: f.replace(/\.ifc$/i, "").replace(/[-_]/g, " "),
      uploadedAt: new Date().toISOString(),
    });
    await parseFile(f);
  }
} else {
  for (const f of targets) {
    upsertModel.run({
      filename: f,
      displayName: f.replace(/\.ifc$/i, "").replace(/[-_]/g, " "),
      uploadedAt: new Date().toISOString(),
    });
    await parseFile(f);
  }
}

console.log(`\nDone. Database: ${DB_PATH}`);
db.close();
