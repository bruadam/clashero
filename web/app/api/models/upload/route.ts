import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { upsertIfcModel } from "@/lib/db";

const MODELS_DIR = path.resolve(process.cwd(), "..", "models", "Building");

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (!files || files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  const results: { filename: string; status: "saved" | "error"; error?: string }[] = [];

  for (const file of files) {
    const filename = file.name;

    // Sanitize
    if (
      !filename ||
      filename.includes("..") ||
      filename.includes("/") ||
      !filename.endsWith(".ifc")
    ) {
      results.push({ filename, status: "error", error: "Invalid filename" });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = path.join(MODELS_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const displayName = filename.replace(/\.ifc$/i, "").replace(/[-_]/g, " ");
      upsertIfcModel({
        filename,
        displayName,
        uploadedAt: new Date().toISOString(),
      });

      results.push({ filename, status: "saved" });
    } catch (err) {
      results.push({ filename, status: "error", error: String(err) });
    }
  }

  return NextResponse.json({ results });
}
