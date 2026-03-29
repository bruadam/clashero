import { NextRequest, NextResponse } from "next/server";
import { parseBcf } from "@/lib/bcf-parser";
import { insertClash, clashCount, listClashes } from "@/lib/db";
import type { Clash } from "@/lib/types";

/**
 * POST /api/bcf/import
 * Accepts a BCF file upload (multipart/form-data with field "file"),
 * parses it, and inserts all new clashes into the database.
 * Returns { imported: number, skipped: number, clashes: Clash[] }
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided. Use field name 'file'." }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();

  let parsed: Clash[];
  try {
    parsed = await parseBcf(buffer);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to parse BCF file", detail: String(err) },
      { status: 400 },
    );
  }

  if (parsed.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, clashes: [] });
  }

  // Get existing GUIDs to skip duplicates
  const existing = await listClashes();
  const existingGuids = new Set(existing.map((c) => c.guid));
  let currentCount = await clashCount();

  const imported: Clash[] = [];
  let skipped = 0;

  for (const clash of parsed) {
    if (existingGuids.has(clash.guid)) {
      skipped++;
      continue;
    }

    // Re-assign sequential IDs based on current DB count
    currentCount++;
    const clashWithId: Clash = {
      ...clash,
      id: `CLH-${String(currentCount).padStart(3, "0")}`,
    };

    await insertClash(clashWithId);
    imported.push(clashWithId);
  }

  return NextResponse.json({
    imported: imported.length,
    skipped,
    clashes: imported,
  }, { status: 201 });
}
