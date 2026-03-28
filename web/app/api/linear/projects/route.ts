import { NextRequest, NextResponse } from "next/server";
import { getLinearSettings } from "@/lib/db";
import { listProjects } from "@/lib/linear";

export async function GET(req: NextRequest) {
  const settings = await getLinearSettings();
  if (!settings?.accessToken) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 401 });
  }

  const teamId = req.nextUrl.searchParams.get("teamId") ?? settings.teamId;
  if (!teamId) {
    return NextResponse.json({ error: "teamId required" }, { status: 400 });
  }

  const projects = await listProjects(settings.accessToken, teamId);
  return NextResponse.json({ projects });
}
