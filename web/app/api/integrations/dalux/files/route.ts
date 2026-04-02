import { NextResponse } from "next/server";
import { listDaluxIfcFiles } from "@/lib/dalux";
import { getActiveOrganizationId } from "@/lib/tenant-context";
import { getDaluxIntegration } from "@/lib/tenant-store";

export async function GET() {
  const orgId = await getActiveOrganizationId();
  const settings = await getDaluxIntegration(orgId);
  if (!settings?.apiKey) {
    return NextResponse.json({ error: "Dalux not configured" }, { status: 400 });
  }

  try {
    const files = await listDaluxIfcFiles(
      settings.apiKey,
      settings.projectId,
      settings.fileAreaId,
      settings.folderId,
    );

    return NextResponse.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
