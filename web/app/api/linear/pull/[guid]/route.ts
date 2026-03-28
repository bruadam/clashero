import { NextRequest, NextResponse } from "next/server";
import { getClash, getLinearSettings, updateClash } from "@/lib/db";
import { getIssue } from "@/lib/linear";
import type { ClashStatus } from "@/lib/types";

/** Map Linear state name → Clash status (best-effort) */
function mapLinearState(stateName: string): ClashStatus {
  const lower = stateName.toLowerCase();
  if (lower.includes("progress") || lower.includes("started")) return "in_progress";
  if (lower.includes("review") || lower.includes("testing")) return "in_review";
  if (lower.includes("done") || lower.includes("resolved") || lower.includes("complete")) return "resolved";
  if (lower.includes("cancelled") || lower.includes("canceled") || lower.includes("closed")) return "closed";
  return "open";
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;
  const clash = getClash(guid);
  if (!clash) {
    return NextResponse.json({ error: "Clash not found" }, { status: 404 });
  }
  if (!clash.linearIssueId) {
    return NextResponse.json({ error: "Clash is not linked to a Linear issue" }, { status: 400 });
  }

  const settings = getLinearSettings();
  if (!settings?.accessToken) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 400 });
  }

  try {
    const issue = await getIssue(settings.accessToken, clash.linearIssueId);
    const newStatus = mapLinearState(issue.state.name);

    updateClash(guid, {
      status: newStatus,
      ...(issue.assignee ? { assignee: issue.assignee.name } : {}),
    });

    return NextResponse.json({
      issue,
      applied: {
        status: newStatus,
        assignee: issue.assignee?.name ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
