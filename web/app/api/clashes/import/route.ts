import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { parseBcf } from "@/lib/bcf-parser";
import { deleteAllClashes, insertClash } from "@/lib/db";

const BCF_PATHS = [
  path.join(/* turbopackIgnore: true */ process.cwd(), "..", "web", "data", "report.bcf"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "data", "report.bcf"),
];

export async function POST() {
  let buf: Buffer | null = null;

  for (const bcfPath of BCF_PATHS) {
    try {
      buf = await readFile(bcfPath);
      break;
    } catch {
      // try next path
    }
  }

  if (!buf) {
    return NextResponse.json(
      { error: "No BCF report found. Run clash detection first." },
      { status: 404 }
    );
  }

  const clashes = await parseBcf(buf.buffer as ArrayBuffer);

  await deleteAllClashes();
  for (const clash of clashes) {
    await insertClash(clash);
  }

  return NextResponse.json({ imported: clashes.length });
}
