import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { listIfcModels, upsertIfcModel, deleteIfcModel } from "@/lib/db";

const MODELS_DIR = path.resolve(process.cwd(), "..", "models", "Building");

/**
 * GET /api/models
 * Returns all known IFC models (from DB, auto-seeding from disk if DB is empty).
 */
export async function GET() {
  try {
    const dbModels = await listIfcModels();
    const dbFilenames = new Set(dbModels.map((m) => m.filename));

    if (fs.existsSync(MODELS_DIR)) {
      const diskFiles = fs
        .readdirSync(MODELS_DIR)
        .filter((f) => f.endsWith(".ifc"));

      for (const filename of diskFiles) {
        if (!dbFilenames.has(filename)) {
          const displayName = filename.replace(/\.ifc$/i, "").replace(/[-_]/g, " ");
          const stat = fs.statSync(path.join(MODELS_DIR, filename));
          await upsertIfcModel({
            filename,
            displayName,
            uploadedAt: stat.mtime.toISOString(),
          });
        }
      }
    }

    const models = await listIfcModels();
    return NextResponse.json({ models });
  } catch (err) {
    console.error("[models] GET error:", err);
    if (!fs.existsSync(MODELS_DIR)) {
      return NextResponse.json({ models: [] });
    }
    const models = fs
      .readdirSync(MODELS_DIR)
      .filter((f) => f.endsWith(".ifc"))
      .map((filename) => ({
        filename,
        displayName: filename.replace(/\.ifc$/i, "").replace(/[-_]/g, " "),
        uploadedAt: fs.statSync(path.join(MODELS_DIR, filename)).mtime.toISOString(),
        elementCount: 0,
        parsedAt: null,
      }));
    return NextResponse.json({ models });
  }
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

  await deleteIfcModel(filename);
  return NextResponse.json({ ok: true });
}
