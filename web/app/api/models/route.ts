import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { listIfcModels, upsertIfcModel } from "@/lib/db";

const MODELS_DIR = path.resolve(process.cwd(), "..", "models", "Building");

/**
 * GET /api/models
 * Returns all known IFC models (from DB, auto-seeding from disk if DB is empty).
 */
export async function GET() {
  // Auto-seed: if DB has no models, scan the directory and register what's there
  const dbModels = listIfcModels();
  const dbFilenames = new Set(dbModels.map((m) => m.filename));

  if (fs.existsSync(MODELS_DIR)) {
    const diskFiles = fs
      .readdirSync(MODELS_DIR)
      .filter((f) => f.endsWith(".ifc"));

    for (const filename of diskFiles) {
      if (!dbFilenames.has(filename)) {
        const displayName = filename.replace(/\.ifc$/i, "").replace(/[-_]/g, " ");
        const stat = fs.statSync(path.join(MODELS_DIR, filename));
        upsertIfcModel({
          filename,
          displayName,
          uploadedAt: stat.mtime.toISOString(),
        });
      }
    }
  }

  const models = listIfcModels();
  return NextResponse.json({ models });
}

/**
 * DELETE /api/models?filename=xxx
 * Removes an IFC file from disk and the DB.
 */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const filename = searchParams.get("filename");

  if (!filename || filename.includes("..") || filename.includes("/") || !filename.endsWith(".ifc")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(MODELS_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  const { deleteIfcModel } = await import("@/lib/db");
  deleteIfcModel(filename);

  return NextResponse.json({ ok: true });
}
