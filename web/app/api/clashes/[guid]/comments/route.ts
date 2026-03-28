import { NextRequest, NextResponse } from "next/server";
import { getComments, addComment } from "@/lib/db";
import os from "os";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;
  return NextResponse.json(getComments(guid));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;
  const body = await req.json();

  if (!body.body?.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const actor: string = body.actor ?? os.userInfo().username;

  const comment = addComment({
    clashGuid: guid,
    actor,
    timestamp: new Date().toISOString(),
    body: body.body,
  });

  return NextResponse.json(comment, { status: 201 });
}
