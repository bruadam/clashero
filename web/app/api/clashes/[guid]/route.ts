import { NextRequest, NextResponse } from "next/server";
import { getClash, updateClash, upsertClash, deleteClash } from "@/lib/db";
import type { Clash } from "@/lib/types";

/**
 * GET /api/clashes/[guid]
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const { guid } = await params;
  const clash = await getClash(guid);
  if (!clash) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(clash);
}

/**
 * PATCH /api/clashes/[guid]
 * Partial update.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const { guid } = await params;
  const clash = await getClash(guid);
  if (!clash) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json() as Record<string, unknown>;
  await updateClash(guid, body);
  return NextResponse.json(await getClash(guid));
}

/**
 * PUT /api/clashes/[guid]
 * Full upsert — creates or fully replaces.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const { guid } = await params;
  const body = await req.json() as Partial<Clash>;

  const clash: Clash = {
    guid,
    id: body.id ?? guid.slice(0, 8),
    title: body.title ?? "",
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
    createdAt: body.createdAt ?? new Date().toISOString(),
    modifiedDate: body.modifiedDate,
    creationAuthor: body.creationAuthor,
  };

  await upsertClash(clash);
  return NextResponse.json(clash);
}

/**
 * DELETE /api/clashes/[guid]
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const { guid } = await params;
  const deleted = await deleteClash(guid);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
