/**
 * Per-clash metadata layout — generates OG image tags from the snapshot DB.
 * This is a Server Component so it can call generateMetadata.
 */
import type { Metadata } from "next";
import { listClashes } from "@/lib/db";
import type { Clash } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  let clash: Clash | null = null;
  try {
    const clashes = await listClashes();
    clash = clashes.find((c) => c.id === id) ?? null;
  } catch {
    // DB unavailable
  }

  const title = clash ? `${clash.id}: ${clash.title}` : "Clash — Clashero";
  const description = clash?.description ?? "BIM clash coordination dashboard";

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
