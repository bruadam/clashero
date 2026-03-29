import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { replaceElementsForModel, markIfcModelParsed, backfillClashFiles, getElementsForModel } from "@/lib/db";
import type { IfcElement } from "@/lib/db";

const MODELS_DIR = path.resolve(process.cwd(), "..", "models", "Building");

/**
 * POST /api/models/[filename]/parse
 * Parses the IFC file server-side using web-ifc, extracts all elements
 * with their properties, and stores them in the DB.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  if (!filename || filename.includes("..") || filename.includes("/") || !filename.endsWith(".ifc")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(MODELS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const { IfcAPI } = await import("web-ifc");

    const wasmDir = path.resolve(process.cwd(), "node_modules", "web-ifc");
    const ifcApi = new IfcAPI();
    ifcApi.SetWasmPath(wasmDir + "/", true);
    await ifcApi.Init();

    const data = fs.readFileSync(filePath);
    const modelId = ifcApi.OpenModel(new Uint8Array(data));

    const allLines = ifcApi.GetAllLines(modelId);
    const elements: Omit<IfcElement, "id">[] = [];
    const processedIds = new Set<number>();

    for (let i = 0; i < allLines.size(); i++) {
      const expressId = allLines.get(i);
      if (processedIds.has(expressId)) continue;
      processedIds.add(expressId);

      let line: Record<string, unknown>;
      try {
        line = ifcApi.GetLine(modelId, expressId, false) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (!line || typeof line !== "object") continue;

      const typeCode = line.type as number | undefined;
      if (typeCode == null) continue;
      const ifcType = ifcApi.GetNameFromTypeCode(typeCode) ?? "";
      if (!ifcType || ifcType.startsWith("IFCREL") || ifcType === "IFCPROPERTYSINGLEVALUE") continue;

      const globalIdRef = line.GlobalId as { value?: string } | undefined;
      const globalId = globalIdRef?.value ?? "";
      if (!globalId) continue;

      const nameRef = line.Name as { value?: string } | null | undefined;
      const name = nameRef?.value ?? null;

      const descRef = line.Description as { value?: string } | null | undefined;
      const description = descRef?.value ?? null;

      const properties: Record<string, string> = {};

      const typeRef = line.ObjectType as { value?: string } | null | undefined;
      if (typeRef?.value) properties["ObjectType"] = typeRef.value;

      const tagRef = line.Tag as { value?: string } | null | undefined;
      if (tagRef?.value) properties["Tag"] = tagRef.value;

      try {
        const psets = await ifcApi.properties.getPropertySets(modelId, expressId, true);
        for (const pset of psets) {
          if (!pset || typeof pset !== "object") continue;
          const psetName = (pset.Name as { value?: string })?.value ?? "Properties";
          const hasProps = (pset.HasProperties as unknown[]) ?? [];
          for (const prop of hasProps) {
            if (!prop || typeof prop !== "object") continue;
            const propObj = prop as Record<string, unknown>;
            const key = (propObj.Name as { value?: string })?.value;
            const val = (propObj.NominalValue as { value?: unknown })?.value;
            if (key && val !== undefined && val !== null) {
              properties[`${psetName}.${key}`] = String(val);
            }
          }
        }
      } catch {
        // property set lookup failed
      }

      elements.push({
        modelFilename: filename,
        expressId,
        globalId,
        ifcType,
        name,
        description,
        properties: JSON.stringify(properties),
      });
    }

    ifcApi.CloseModel(modelId);

    await replaceElementsForModel(filename, elements);
    await markIfcModelParsed(filename, elements.length);
    await backfillClashFiles();

    return NextResponse.json({
      filename,
      elementCount: elements.length,
      elements: elements.map((e) => ({
        ...e,
        properties: JSON.parse(e.properties as string),
      })),
    });
  } catch (err) {
    console.error("[parse] Error:", err);
    return NextResponse.json(
      { error: "Parse failed", detail: String(err) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/models/[filename]/parse
 * Returns already-parsed elements from the DB without re-parsing.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  if (!filename || filename.includes("..") || filename.includes("/") || !filename.endsWith(".ifc")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const elements = await getElementsForModel(filename);

  return NextResponse.json({
    filename,
    elementCount: elements.length,
    elements: elements.map((e) => ({
      ...e,
      properties: typeof e.properties === "string" ? JSON.parse(e.properties) : e.properties,
    })),
  });
}
