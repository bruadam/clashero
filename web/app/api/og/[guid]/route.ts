/**
 * GET /api/og/[guid]
 *
 * Serves the pre-generated OG PNG for a clash.
 * Falls back to a simple SVG placeholder if the snapshot hasn't been generated yet.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getSnapshot } from "@/lib/db";

const PUBLIC_DIR = path.join(process.cwd(), "public");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guid: string }> }
) {
  const { guid } = await params;

  // Validate guid to prevent path traversal
  if (!/^[\w-]+$/.test(guid)) {
    return NextResponse.json({ error: "Invalid guid" }, { status: 400 });
  }

  // Look up snapshot path from DB
  const snapshotPath = getSnapshot(guid);
  if (snapshotPath) {
    const abs = path.join(PUBLIC_DIR, snapshotPath);
    try {
      const buf = await readFile(abs);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch {
      // File missing — fall through to placeholder
    }
  }

  // Placeholder SVG when no snapshot exists yet
  const svg = placeholderSvg(guid);
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-cache",
    },
  });
}

function placeholderSvg(guid: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0d0d10"/>
  <text x="600" y="290" font-family="monospace" font-size="28" fill="#ffffff44" text-anchor="middle">Clashero</text>
  <text x="600" y="340" font-family="monospace" font-size="16" fill="#ffffff22" text-anchor="middle">${guid}</text>
  <text x="600" y="380" font-family="monospace" font-size="13" fill="#ffffff18" text-anchor="middle">Run npm run snapshots to generate preview</text>
</svg>`;
}
