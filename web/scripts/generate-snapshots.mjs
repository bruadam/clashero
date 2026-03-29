/**
 * generate-snapshots.mjs
 *
 * Headless screenshot generator for Clashero clash issues.
 *
 * Steps:
 *  1. Fetch all clashes from the running Next.js server (/api/clashes)
 *  2. For each clash open /snapshot/<guid> in headless Chromium
 *  3. Wait for window.__snapshotReady (models loaded + camera set)
 *  4. Screenshot the page at 1200×630 (standard OG image size)
 *  5. Save to public/og/<guid>.png
 *  6. POST to /api/snapshots to persist path in the DB
 *
 * Usage:
 *   node scripts/generate-snapshots.mjs [--base http://localhost:3000] [--guid <guid>]
 *
 * The Next.js dev server must be running before calling this script.
 */

import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let BASE_URL = "http://localhost:3000";
let filterGuid = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base" && args[i + 1]) BASE_URL = args[++i];
  if (args[i] === "--guid" && args[i + 1]) filterGuid = args[++i];
}

const OG_DIR = path.join(ROOT, "public", "og");
const W = 1200;
const H = 630;
const TIMEOUT_MS = 120_000; // 2 min per clash (IFC loading is slow)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchClashes() {
  const res = await fetch(`${BASE_URL}/api/clashes`);
  if (!res.ok) throw new Error(`GET /api/clashes → ${res.status}`);
  const { clashes } = await res.json();
  return clashes;
}

async function persistSnapshot(guid, relativePath) {
  try {
    await fetch(`${BASE_URL}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guid, path: relativePath }),
    });
  } catch (e) {
    console.warn(`  [warn] Could not persist snapshot to DB: ${e.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OG_DIR, { recursive: true });

  console.log(`[snapshots] Base URL : ${BASE_URL}`);
  console.log(`[snapshots] Output   : ${OG_DIR}`);
  console.log(`[snapshots] Size     : ${W}×${H}`);

  // Verify server is up
  try {
    await fetch(`${BASE_URL}/api/clashes`);
  } catch {
    console.error(`[snapshots] ERROR: Next.js server not reachable at ${BASE_URL}`);
    console.error("  Run 'npm run dev' first, then re-run this script.");
    process.exit(1);
  }

  const clashes = await fetchClashes();
  const targets = filterGuid
    ? clashes.filter((c) => c.guid === filterGuid)
    : clashes;

  if (targets.length === 0) {
    console.error(filterGuid
      ? `[snapshots] No clash found with guid=${filterGuid}`
      : "[snapshots] No clashes returned from API");
    process.exit(1);
  }

  console.log(`[snapshots] Processing ${targets.length} clash(es)…\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--enable-webgl",
      "--ignore-gpu-blacklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",   // software WebGL via ANGLE+SwiftShader
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });

  let succeeded = 0;
  let failed = 0;

  for (const clash of targets) {
    const outFile = path.join(OG_DIR, `${clash.guid}.png`);
    const relPath = `/og/${clash.guid}.png`;

    console.log(`  → ${clash.id}  ${clash.title}`);
    console.log(`     guid: ${clash.guid}`);

    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

    // Suppress console noise from Three.js / web-ifc
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`     [page error] ${msg.text().slice(0, 120)}`);
      }
    });

    try {
      await page.goto(`${BASE_URL}/snapshot/${clash.guid}`, {
        waitUntil: "networkidle2",
        timeout: TIMEOUT_MS,
      });

      // Wait until window.__snapshotReady or window.__snapshotError is set
      await page.waitForFunction(
        () => window.__snapshotReady === true || typeof window.__snapshotError === "string",
        { timeout: TIMEOUT_MS }
      );

      const errMsg = await page.evaluate(() => window.__snapshotError);
      if (errMsg) {
        throw new Error(`Snapshot page reported error: ${errMsg}`);
      }

      // Extra frame to let the GPU flush
      await new Promise((r) => setTimeout(r, 800));

      await page.screenshot({ path: outFile, type: "png" });
      console.log(`     ✓ saved ${relPath}`);

      await persistSnapshot(clash.guid, relPath);
      succeeded++;
    } catch (err) {
      console.error(`     ✗ FAILED: ${err.message}`);
      failed++;
    } finally {
      await page.close();
    }
  }

  await browser.close();

  console.log(`\n[snapshots] Done — ${succeeded} succeeded, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[snapshots] Fatal:", err);
  process.exit(1);
});
