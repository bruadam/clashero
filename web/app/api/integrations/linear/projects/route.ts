import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/linear";
import { getActiveOrganizationId } from "@/lib/tenant-context";
import { getLinearIntegration } from "@/lib/tenant-store";

export async function GET(req: NextRequest) {
  const orgId = await getActiveOrganizationId();
  const settings = await getLinearIntegration(orgId);
  if (!settings?.accessToken) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 400 });
  }

  const teamId = req.nextUrl.searchParams.get("teamId") ?? settings.teamId;
  if (!teamId) {
    return NextResponse.json({ error: "teamId required" }, { status: 400 });
  }

  const projects = await listProjects(settings.accessToken, teamId);
  return NextResponse.json({ projects });
}
