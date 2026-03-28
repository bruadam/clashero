import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

// Serve IFC files from REPO_ROOT/models/test-cde/
const MODELS_DIR = path.resolve(process.cwd(), "..", "models", "test-cde");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Sanitize — only allow simple filenames, no path traversal
  if (!filename || filename.includes("..") || filename.includes("/") || !filename.endsWith(".ifc")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(MODELS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const data = fs.readFileSync(filePath);

  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
