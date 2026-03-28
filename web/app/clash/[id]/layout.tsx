/**
 * Per-clash metadata layout — generates OG image tags from the snapshot DB.
 * This is a Server Component so it can call generateMetadata.
 */
import type { Metadata } from "next";
import { getSnapshot } from "@/lib/db";
import { readFile } from "fs/promises";
import path from "path";
import { parseBcf } from "@/lib/bcf-parser";
import { DUMMY_CLASHES } from "@/lib/dummy-clashes";
import type { Clash } from "@/lib/types";

const BCF_PATHS = [
  path.join(process.cwd(), "..", "web", "data", "report.bcf"),
  path.join(process.cwd(), "data", "report.bcf"),
];

async function loadClashes(): Promise<Clash[]> {
  for (const p of BCF_PATHS) {
    try {
      const buf = await readFile(p);
      return await parseBcf(buf.buffer as ArrayBuffer);
    } catch { /* try next */ }
  }
  return DUMMY_CLASHES;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const clashes = await loadClashes();
  const clash = clashes.find((c) => c.id === id) ?? null;

  const title = clash ? `${clash.id}: ${clash.title}` : "Clash — Clashero";
  const description = clash?.description ?? "BIM clash coordination dashboard";

  // Look up pre-generated OG screenshot
  const snapshotPath = clash ? getSnapshot(clash.guid) : null;
  // snapshotPath is like "/og/clash-001.png" — for metadata we use the API route
  const ogImageUrl = clash
    ? `/api/og/${clash.guid}`
    : "/og/default.png";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function ClashLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
