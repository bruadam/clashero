import { NextResponse } from "next/server";
import { listTeams } from "@/lib/linear";
import { getActiveOrganizationId } from "@/lib/tenant-context";
import { getLinearIntegration } from "@/lib/tenant-store";

export async function GET() {
  const orgId = await getActiveOrganizationId();
  const settings = await getLinearIntegration(orgId);
  if (!settings?.accessToken) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 400 });
  }

  const teams = await listTeams(settings.accessToken);
  return NextResponse.json({ teams });
}
