/**
 * import-bcf.mjs
 *
 * Parse a .bcfzip archive and insert the resulting clashes into PostgreSQL
 * via the API endpoint.
 *
 * Usage (run from repo root or web/):
 *   node web/scripts/import-bcf.mjs [path/to/file.bcfzip]
 *
 * Defaults to tests/hvac.bcfzip (relative to repo root).
 * Requires the Next.js dev server to be running on http://localhost:3000.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const inputArg = process.argv[2];
const BCF_PATH = inputArg
  ? path.resolve(process.cwd(), inputArg)
  : path.join(REPO_ROOT, "tests", "hvac.bcfzip");

const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

console.log("Reading BCF archive: " + BCF_PATH);

if (!fs.existsSync(BCF_PATH)) {
  console.error("File not found: " + BCF_PATH);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(BCF_PATH);
const blob = new Blob([fileBuffer], { type: "application/octet-stream" });
const formData = new FormData();
formData.append("file", blob, path.basename(BCF_PATH));

const res = await fetch(`${API_BASE}/api/bcf/import`, {
  method: "POST",
  body: formData,
});

if (!res.ok) {
  console.error("Import failed:", res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
console.log(`Imported ${data.imported} clash(es), skipped ${data.skipped} duplicates.`);

for (const c of data.clashes) {
  const cam = c.viewpoint?.cameraPosition ?? [0, 0, 0];
  let line = `  ${c.id}  [${c.status}]  ${c.title}\n`;
  line += `         GUIDs: ${c.ifcGuidA || "—"} / ${c.ifcGuidB || "—"}\n`;
  line += `         Camera: (${cam[0]?.toFixed(3)}, ${cam[1]?.toFixed(3)}, ${cam[2]?.toFixed(3)}) m`;
  console.log(line + "\n");
}
