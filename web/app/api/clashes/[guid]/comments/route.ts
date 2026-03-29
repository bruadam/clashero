import { NextRequest, NextResponse } from "next/server";
import { getComments, addComment, deleteComment } from "@/lib/db";
import os from "os";

/**
 * GET /api/clashes/[guid]/comments
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const { guid } = await params;
  return NextResponse.json(await getComments(guid));
}

/**
 * POST /api/clashes/[guid]/comments
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const { guid } = await params;
  const body = await req.json();

  if (!body.body?.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const actor: string = body.actor ?? os.userInfo().username;

  const comment = await addComment({
    clashGuid: guid,
    actor,
    timestamp: new Date().toISOString(),
    body: body.body,
  });

  return NextResponse.json(comment, { status: 201 });
}

/**
 * DELETE /api/clashes/[guid]/comments
 * Delete a specific comment. Body: { id: string }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> },
) {
  const body = await req.json() as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const deleted = await deleteComment(body.id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
