import { NextResponse } from "next/server";
import { downloadLatestDaluxRevision } from "@/lib/dalux";
import { getActiveOrganizationId } from "@/lib/tenant-context";
import { getDaluxIntegration } from "@/lib/tenant-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const orgId = await getActiveOrganizationId();
  const settings = await getDaluxIntegration(orgId);
  if (!settings?.apiKey) {
    return NextResponse.json({ error: "Dalux not configured" }, { status: 400 });
  }

  try {
    const response = await downloadLatestDaluxRevision(
      settings.apiKey,
      settings.projectId,
      settings.fileAreaId,
      fileId,
    );

    const headers = new Headers(response.headers);
    headers.set("Content-Disposition", `attachment; filename="${fileId}.ifc"`);
    return new NextResponse(response.body, { status: response.status, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
