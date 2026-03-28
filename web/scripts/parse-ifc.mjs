/**
 * parse-ifc.mjs
 *
 * Trigger server-side IFC parsing via the API.
 *
 * Reads IFC files from models/Building/, uploads any unregistered ones,
 * then triggers the /api/models/[filename]/parse endpoint for each.
 *
 * Usage:
 *   node web/scripts/parse-ifc.mjs                     # parse all .ifc files
 *   node web/scripts/parse-ifc.mjs Building-Hvac.ifc   # parse a single file
 *
 * Run from repo root or web/.
 * Requires the Next.js dev server to be running on http://localhost:3000.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MODELS_DIR = path.join(REPO_ROOT, "models", "Building");
const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

async function parseFile(filename) {
  console.log(`\nParsing ${filename} ...`);

  const res = await fetch(`${API_BASE}/api/models/${encodeURIComponent(filename)}/parse`, {
    method: "POST",
  });

  if (!res.ok) {
    console.error(`  x Failed: ${res.status} ${await res.text()}`);
    return;
  }

  const data = await res.json();
  console.log(`  -> ${data.elementCount} elements parsed and stored`);
}

// -- Entry point ---------------------------------------------------------------

const targets = process.argv.slice(2).filter((a) => a.endsWith(".ifc"));

if (targets.length === 0) {
  if (!fs.existsSync(MODELS_DIR)) {
    console.error(`No models directory found at ${MODELS_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith(".ifc"));

  if (files.length === 0) {
    console.error(`No .ifc files found in ${MODELS_DIR}`);
    process.exit(1);
  }

  // Ensure all files are registered via the models endpoint
  await fetch(`${API_BASE}/api/models`);

  for (const f of files) {
    await parseFile(f);
  }
} else {
  for (const f of targets) {
    await parseFile(f);
  }
}

console.log(`\nDone.`);
