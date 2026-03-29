import { NextRequest, NextResponse } from "next/server";
import { getElementByGlobalId } from "@/lib/db";

/**
 * GET /api/elements?guid=XXX[&guid=YYY]
 * Resolves one or more IFC global IDs to their full element data.
 */
export async function GET(req: NextRequest) {
  const guids = req.nextUrl.searchParams.getAll("guid");
  if (guids.length === 0) {
    return NextResponse.json({ error: "guid param required" }, { status: 400 });
  }

  const result: Record<string, {
    modelFilename: string;
    ifcType: string;
    name: string | null;
    description: string | null;
    properties: Record<string, string>;
  } | null> = {};

  for (const guid of guids) {
    const el = await getElementByGlobalId(guid);
    if (!el) {
      result[guid] = null;
    } else {
      result[guid] = {
        modelFilename: el.modelFilename,
        ifcType: el.ifcType,
        name: el.name ?? null,
        description: el.description ?? null,
        properties: typeof el.properties === "string"
          ? JSON.parse(el.properties) as Record<string, string>
          : el.properties as unknown as Record<string, string>,
      };
    }
  }

  return NextResponse.json(result);
}
