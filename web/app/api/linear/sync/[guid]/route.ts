import { NextRequest, NextResponse } from "next/server";
import { getClash, getLinearSettings, setClashLinearIssueId } from "@/lib/db";
import { createIssue, addAttachment, getIssue } from "@/lib/linear";

function buildDescription(clash: NonNullable<ReturnType<typeof getClash>>, viewerUrl: string): string {
  const lines: string[] = [
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

  if (clash.description) {
    lines.push(clash.description, "");
  }

  lines.push(`[Open in Clashero viewer →](${viewerUrl})`);

  return lines.join("\n");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;
  const clash = getClash(guid);
  if (!clash) {
    return NextResponse.json({ error: "Clash not found" }, { status: 404 });
  }

  const settings = getLinearSettings();
  if (!settings?.accessToken) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 400 });
  }
  if (!settings.teamId) {
    return NextResponse.json({ error: "No Linear team selected — configure in Settings > Linear" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const viewerUrl = `${baseUrl}/clash/${clash.guid}`;

  try {
    // If already linked — return the existing issue (idempotent)
    if (clash.linearIssueId) {
      const existing = await getIssue(settings.accessToken, clash.linearIssueId);
      return NextResponse.json({ issue: existing, alreadyLinked: true });
    }

    const description = buildDescription(clash, viewerUrl);
    const issue = await createIssue(
      settings.accessToken,
      settings.teamId,
      settings.projectId || undefined,
      clash.title,
      description,
      clash.priority
    );

    // Add the viewer URL as an attachment for quick access from Linear
    await addAttachment(
      settings.accessToken,
      issue.id,
      `Clashero — ${clash.id}`,
      viewerUrl,
      `${clash.fileA} × ${clash.fileB}`
    );

    setClashLinearIssueId(guid, issue.id);

    return NextResponse.json({ issue });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
