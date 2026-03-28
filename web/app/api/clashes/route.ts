import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { parseBcf } from "@/lib/bcf-parser";
import { DUMMY_CLASHES } from "@/lib/dummy-clashes";

const BCF_PATH = path.join(process.cwd(), "..", "web", "data", "report.bcf");
// Also check relative to cwd directly (works when running from web/)
const BCF_PATH_ALT = path.join(process.cwd(), "data", "report.bcf");

export async function GET() {
  for (const bcfPath of [BCF_PATH, BCF_PATH_ALT]) {
    try {
      const buf = await readFile(bcfPath);
      const clashes = await parseBcf(buf.buffer as ArrayBuffer);
      return NextResponse.json({ clashes, source: "bcf" });
    } catch {
      // file not found or parse error — try next path
    }
  }

  // Fall back to dummy data when no BCF file is present
  return NextResponse.json({ clashes: DUMMY_CLASHES, source: "dummy" });
}
