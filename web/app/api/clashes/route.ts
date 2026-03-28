import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { parseBcf } from "@/lib/bcf-parser";
import { DUMMY_CLASHES } from "@/lib/dummy-clashes";
import { listClashes, clashCount, insertClash } from "@/lib/db";
import type { Clash } from "@/lib/types";

const BCF_PATH = path.join(process.cwd(), "..", "web", "data", "report.bcf");
const BCF_PATH_ALT = path.join(process.cwd(), "data", "report.bcf");

export async function GET() {
  // If there are clashes in the DB, use those
  if (clashCount() > 0) {
    return NextResponse.json({ clashes: listClashes(), source: "db" });
  }

  // Fall back to BCF file
  for (const bcfPath of [BCF_PATH, BCF_PATH_ALT]) {
    try {
      const buf = await readFile(bcfPath);
      const clashes = await parseBcf(buf.buffer as ArrayBuffer);
      return NextResponse.json({ clashes, source: "bcf" });
    } catch {
      // file not found or parse error — try next path
    }
  }

  // Fall back to dummy data
  return NextResponse.json({ clashes: DUMMY_CLASHES, source: "dummy" });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<Clash>;

  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Auto-generate guid and id if not provided
  const now = new Date().toISOString();
  const guid = body.guid ?? crypto.randomUUID();

  // Auto-increment CLH-NNN id
  const count = clashCount();
  const id = body.id ?? `CLH-${String(count + 1).padStart(3, "0")}`;

  const clash: Clash = {
    guid,
    id,
    title: body.title,
    description: body.description ?? "",
    status: body.status ?? "open",
    priority: body.priority ?? "none",
    ruleId: body.ruleId ?? "",
    ifcGuidA: body.ifcGuidA ?? "",
    ifcGuidB: body.ifcGuidB ?? "",
    fileA: body.fileA ?? "",
    fileB: body.fileB ?? "",
    midpoint: body.midpoint ?? [0, 0, 0],
    viewpoint: body.viewpoint ?? {
      cameraPosition: [0, 10, 10],
      cameraDirection: [0, -0.7, -0.7],
      cameraUpVector: [0, 1, 0],
      target: [0, 0, 0],
    },
    assignee: body.assignee,
    labels: body.labels ?? [],
    createdAt: body.createdAt ?? now,
  };

  insertClash(clash);

  return NextResponse.json(clash, { status: 201 });
}
