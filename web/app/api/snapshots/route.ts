import { NextRequest, NextResponse } from "next/server";
import { getSnapshot, setSnapshot, getAllSnapshots } from "@/lib/db";

/** GET /api/snapshots — list all stored snapshots */
export async function GET() {
  return NextResponse.json({ snapshots: getAllSnapshots() });
}

/** POST /api/snapshots — persist a snapshot path for a clash */
export async function POST(req: NextRequest) {
  const body = await req.json() as { guid?: string; path?: string };
  if (!body.guid || !body.path) {
    return NextResponse.json({ error: "guid and path required" }, { status: 400 });
  }
  setSnapshot(body.guid, body.path);
  return NextResponse.json({ ok: true });
}
