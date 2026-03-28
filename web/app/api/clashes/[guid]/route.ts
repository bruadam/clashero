import { NextRequest, NextResponse } from "next/server";
import { getClash, updateClash } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;
  const clash = getClash(guid);
  if (!clash) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(clash);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;
  const clash = getClash(guid);
  if (!clash) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json() as Record<string, unknown>;
  updateClash(guid, body);

  return NextResponse.json(getClash(guid));
}
