import { NextRequest, NextResponse } from "next/server";
import { listClashes, clashCount, insertClash, deleteAllClashes } from "@/lib/db";
import type { Clash } from "@/lib/types";

/**
 * GET /api/clashes
 * Returns all clashes from the database.
 */
export async function GET() {
  try {
    const clashes = await listClashes();
    return NextResponse.json({ clashes, source: "db" });
  } catch (err) {
    console.error("[clashes] GET error:", err);
    return NextResponse.json({ clashes: [], source: "error" });
  }
}

/**
 * POST /api/clashes
 * Create a new clash. Body: Partial<Clash>.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<Clash>;

  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const guid = body.guid ?? crypto.randomUUID();
  const count = await clashCount();
  const id = body.id ?? `CLH-${String(count + 1).padStart(3, "0")}`;

  const clash: Clash = {
    guid,
    id,
    title: body.title,
    description: body.description ?? "",
    status: body.status ?? "open",
    priority: body.priority ?? "none",
    ruleId: body.ruleId ?? "",
    ifcGuidA: body.ifcGuidA ?? "",
    ifcGuidB: body.ifcGuidB ?? "",
    fileA: body.fileA ?? "",
    fileB: body.fileB ?? "",
    midpoint: body.midpoint ?? [0, 0, 0],
    viewpoint: body.viewpoint ?? {
      cameraPosition: [0, 10, 10],
      cameraDirection: [0, -0.7, -0.7],
      cameraUpVector: [0, 1, 0],
      target: [0, 0, 0],
    },
    assignee: body.assignee,
    labels: body.labels ?? [],
    createdAt: body.createdAt ?? now,
    modifiedDate: body.modifiedDate,
    creationAuthor: body.creationAuthor,
  };

  await insertClash(clash);
  return NextResponse.json(clash, { status: 201 });
}

/**
 * DELETE /api/clashes
 * Delete ALL clashes (reset). Use with caution.
 */
export async function DELETE() {
  await deleteAllClashes();
  return NextResponse.json({ ok: true });
}
