import { NextRequest, NextResponse } from "next/server";
import { getActivity, addActivity, deleteActivity } from "@/lib/db";
import os from "os";

/**
 * GET /api/clashes/[guid]/activity
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const { guid } = await params;
  return NextResponse.json(await getActivity(guid));
}

/**
 * POST /api/clashes/[guid]/activity
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const { guid } = await params;
  const body = await req.json();
  const actor: string = body.actor ?? os.userInfo().username;

  const entry = await addActivity({
    clashGuid: guid,
    type: body.type,
    actor,
    timestamp: new Date().toISOString(),
    field: body.field,
    from: body.from,
    to: body.to,
  });

  return NextResponse.json(entry, { status: 201 });
}

/**
 * DELETE /api/clashes/[guid]/activity
 * Delete a specific activity entry. Body: { id: string }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const body = await req.json() as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const deleted = await deleteActivity(body.id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
