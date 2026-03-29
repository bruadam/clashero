import { NextRequest, NextResponse } from "next/server";
import { getLinearSettings, saveLinearSettings } from "@/lib/db";
import { getOrganization } from "@/lib/linear";

export async function GET() {
  const settings = await getLinearSettings();
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
  const body = await req.json() as { teamId?: string; projectId?: string };
  const existing = await getLinearSettings();
  if (!existing) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 400 });
  }

  await saveLinearSettings({
    ...existing,
    teamId: body.teamId ?? existing.teamId,
    projectId: body.projectId ?? existing.projectId,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const existing = await getLinearSettings();
  if (existing) {
    await saveLinearSettings({ accessToken: "", workspaceId: "", teamId: "", projectId: "" });
  }
  return NextResponse.json({ ok: true });
}
