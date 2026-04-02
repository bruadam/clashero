import { NextRequest, NextResponse } from "next/server";
import { getOrganization } from "@/lib/linear";
import { getActiveOrganizationId } from "@/lib/tenant-context";
import { clearIntegration, getLinearIntegration, saveLinearIntegration } from "@/lib/tenant-store";

export async function GET() {
  const orgId = await getActiveOrganizationId();
  const settings = await getLinearIntegration(orgId);
  if (!settings) {
    return NextResponse.json({ connected: false });
  }

  try {
    const org = await getOrganization(settings.accessToken);
    return NextResponse.json({
      connected: true,
      workspaceId: settings.workspaceId,
      workspaceName: org.name,
      teamId: settings.teamId,
      projectId: settings.projectId,
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}

export async function PATCH(req: NextRequest) {
  const orgId = await getActiveOrganizationId();
  const body = (await req.json()) as { teamId?: string; projectId?: string };
  const existing = await getLinearIntegration(orgId);
  if (!existing) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 400 });
  }

  await saveLinearIntegration(orgId, {
    ...existing,
    teamId: body.teamId ?? existing.teamId,
    projectId: body.projectId ?? existing.projectId,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const orgId = await getActiveOrganizationId();
  await clearIntegration(orgId, "linear");
  return NextResponse.json({ ok: true });
}
