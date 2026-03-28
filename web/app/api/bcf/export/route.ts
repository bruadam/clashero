import { NextResponse } from "next/server";
import { listClashes } from "@/lib/db";
import { exportBcf } from "@/lib/bcf-exporter";

/**
 * GET /api/bcf/export
 * Exports all clashes as a BCF 2.1 archive.
 */
export async function GET() {
  const clashes = await listClashes();

  if (clashes.length === 0) {
    return NextResponse.json({ error: "No clashes to export" }, { status: 404 });
  }

  const blob = await exportBcf(clashes, "Clashero Export");
  const buffer = await blob.arrayBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="clashero-export.bcf"',
    },
  });
}
