import { NextRequest, NextResponse } from "next/server";
import { listClashes, setClashLinearIssueId } from "@/lib/db";
import { createIssue, addAttachment } from "@/lib/linear";
import { getActiveOrganizationId } from "@/lib/tenant-context";
import { getLinearIntegration } from "@/lib/tenant-store";

export async function POST(req: NextRequest) {
  const orgId = await getActiveOrganizationId();
  const settings = await getLinearIntegration(orgId);
  if (!settings?.accessToken) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 400 });
  }
  if (!settings.teamId) {
    return NextResponse.json({ error: "No Linear team selected — configure Linear settings" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const clashes = await listClashes();
  const unsynced = clashes.filter((c) => !c.linearIssueId);

  const results: Array<{ guid: string; id: string; linearIssueIdentifier: string; ok: boolean; error?: string }> = [];

  for (const clash of unsynced) {
    try {
      const viewerUrl = `${baseUrl}/clash/${clash.guid}`;
      const descLines = [
        `**Clash detected by Clashero**`,
        ``,
        `| Field | Value |`,
        `|---|---|`,
        `| ID | ${clash.id} |`,
        `| Rule | ${clash.ruleId || "—"} |`,
        `| File A | ${clash.fileA || "—"} |`,
        `| File B | ${clash.fileB || "—"} |`,
        `| IFC GUID A | \`${clash.ifcGuidA || "—"}\` |`,
        `| IFC GUID B | \`${clash.ifcGuidB || "—"}\` |`,
        `| Midpoint | (${clash.midpoint.map((v) => v.toFixed(2)).join(", ")}) |`,
        ``,
      ];
      if (clash.description) descLines.push(clash.description, "");
      descLines.push(`[Open in Clashero viewer →](${viewerUrl})`);

      const issue = await createIssue(
        settings.accessToken,
        settings.teamId,
        settings.projectId || undefined,
        clash.title,
        descLines.join("\n"),
        clash.priority,
      );

      await addAttachment(
        settings.accessToken,
        issue.id,
        `Clashero — ${clash.id}`,
        viewerUrl,
        `${clash.fileA} × ${clash.fileB}`,
      );

      await setClashLinearIssueId(clash.guid, issue.id);
      results.push({ guid: clash.guid, id: clash.id, linearIssueIdentifier: issue.identifier, ok: true });
    } catch (err) {
      results.push({
        guid: clash.guid,
        id: clash.id,
        linearIssueIdentifier: "",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({ total: unsynced.length, succeeded, failed, results });
}
