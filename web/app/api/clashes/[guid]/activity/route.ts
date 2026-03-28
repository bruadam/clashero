import { NextRequest, NextResponse } from "next/server";
import { getActivity, addActivity } from "@/lib/db";
import os from "os";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;
  return NextResponse.json(getActivity(guid));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;
  const body = await req.json();

  const actor: string = body.actor ?? os.userInfo().username;

  const entry = addActivity({
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
