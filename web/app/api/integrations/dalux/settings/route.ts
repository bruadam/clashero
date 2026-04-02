import { NextRequest, NextResponse } from "next/server";
import { resolveDaluxFolderPath } from "@/lib/dalux";
import { getActiveOrganizationId } from "@/lib/tenant-context";
import { clearIntegration, getDaluxIntegration, saveDaluxIntegration } from "@/lib/tenant-store";

export async function GET() {
  const orgId = await getActiveOrganizationId();
  const settings = await getDaluxIntegration(orgId);
  if (!settings) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    projectId: settings.projectId,
    fileAreaId: settings.fileAreaId,
    folderPath: settings.folderPath,
    folderId: settings.folderId,
    hasApiKey: Boolean(settings.apiKey),
  });
}

export async function PATCH(req: NextRequest) {
  const orgId = await getActiveOrganizationId();
  const body = (await req.json()) as {
    apiKey?: string;
    projectId?: string;
    fileAreaId?: string;
    folderPath?: string;
  };

  const existing = await getDaluxIntegration(orgId);
  const apiKey = body.apiKey || existing?.apiKey;
  const projectId = body.projectId ?? existing?.projectId ?? "";
  const fileAreaId = body.fileAreaId ?? existing?.fileAreaId ?? "";
  const folderPath = body.folderPath ?? existing?.folderPath ?? "";

  if (!apiKey || !projectId || !fileAreaId || !folderPath) {
    return NextResponse.json({ error: "apiKey, projectId, fileAreaId, and folderPath are required" }, { status: 400 });
  }

  try {
    const folderId = await resolveDaluxFolderPath(apiKey, projectId, fileAreaId, folderPath);

    await saveDaluxIntegration(orgId, {
      apiKey,
      projectId,
      fileAreaId,
      folderPath,
      folderId,
    });

    return NextResponse.json({ ok: true, folderId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  const orgId = await getActiveOrganizationId();
  await clearIntegration(orgId, "dalux");
  return NextResponse.json({ ok: true });
}
