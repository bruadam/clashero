/**
 * BCF 2.1 parser — converts a .bcf ZIP archive into Clash objects.
 *
 * BCF archive layout:
 *   <topicGuid>/
 *     markup.bcf          — XML: topic metadata, comments, viewpoint refs
 *     <viewpointGuid>.bcfv — XML: camera position/direction + component selection
 *   bcf.version           — XML: version info (optional)
 *
 * We map each BCF Topic to one Clash. Fields not present in the BCF
 * (e.g. `ruleId`, `midpoint`) are derived from available data or left as
 * sensible defaults so the UI can still render them.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { Clash, ClashStatus, ClashPriority, ClashViewpoint } from "./types";

// ── BCF XML types (loose — only fields we actually use) ──────────────────────

interface BcfComponent {
  "@_IfcGuid"?: string;
  "@_AuthoringToolId"?: string;
  OriginatingSystem?: string;
  "@_Selected"?: string;
  "@_Visible"?: string;
}

interface BcfViewpoint {
  PerspectiveCamera?: {
    CameraViewPoint?: { X?: number; Y?: number; Z?: number };
    CameraDirection?: { X?: number; Y?: number; Z?: number };
    CameraUpVector?: { X?: number; Y?: number; Z?: number };
    FieldOfView?: number;
  };
  OrthogonalCamera?: {
    CameraViewPoint?: { X?: number; Y?: number; Z?: number };
    CameraDirection?: { X?: number; Y?: number; Z?: number };
    CameraUpVector?: { X?: number; Y?: number; Z?: number };
  };
  Components?: {
    Selection?: { Component?: BcfComponent | BcfComponent[] };
    Coloring?: unknown;
    Visibility?: {
      DefaultVisibility?: boolean;
      Exceptions?: { Component?: BcfComponent | BcfComponent[] };
    };
  };
}

interface BcfMarkupViewpoint {
  "@_Guid": string;
  Viewpoint?: string; // filename of .bcfv file
  Snapshot?: string;  // filename of snapshot image
}

interface BcfMarkup {
  Markup?: {
    Topic?: {
      "@_Guid": string;
      "@_TopicType"?: string;
      "@_TopicStatus"?: string;
      Title?: string;
      Description?: string;
      Priority?: string;
      AssignedTo?: string;
      CreationDate?: string;
      ModifiedDate?: string;
      Labels?: { Label?: string | string[] } | string;
      ReferenceLinks?: unknown;
    };
    Viewpoints?: {
      ViewPoint?: BcfMarkupViewpoint | BcfMarkupViewpoint[];
    };
    Comment?: unknown;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    ["Component", "ViewPoint", "Label", "Comment"].includes(name),
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
});

function toVec3(
  obj?: { X?: number; Y?: number; Z?: number }
): [number, number, number] {
  return [obj?.X ?? 0, obj?.Y ?? 0, obj?.Z ?? 0];
}

/** Map BCF TopicStatus / TopicType to our ClashStatus enum. */
function parseStatus(raw?: string): ClashStatus {
  if (!raw) return "open";
  const s = raw.toLowerCase().replace(/[\s_-]+/g, "_");
  if (s.includes("progress")) return "in_progress";
  if (s.includes("review")) return "in_review";
  if (s.includes("resolv") || s.includes("closed") || s.includes("done"))
    return "resolved";
  if (s.includes("close")) return "closed";
  return "open";
}

/** Map BCF Priority to our ClashPriority enum. */
function parsePriority(raw?: string): ClashPriority {
  if (!raw) return "none";
  const p = raw.toLowerCase();
  if (p.includes("critical") || p.includes("urgent")) return "urgent";
  if (p.includes("high") || p.includes("major")) return "high";
  if (p.includes("med")) return "medium";
  if (p.includes("low") || p.includes("minor")) return "low";
  return "none";
}

/**
 * Extract the first two IfcGuids from a viewpoint's component selection.
 * Returns [guidA, guidB] — missing ones are empty strings.
 */
function extractGuids(vp: BcfViewpoint): [string, string] {
  const raw = vp.Components?.Selection?.Component;
  const components: BcfComponent[] = Array.isArray(raw)
    ? raw
    : raw
    ? [raw]
    : [];
  const guids = components
    .map((c) => c["@_IfcGuid"] ?? "")
    .filter(Boolean);
  return [guids[0] ?? "", guids[1] ?? ""];
}

/**
 * Derive a ruleId from two filenames.
 * e.g. "B250_VENT.ifc" + "B250_VVS.ifc" → "VENT×VVS"
 */
function deriveRuleId(fileA: string, fileB: string): string {
  const stem = (f: string) => {
    const base = f.replace(/\.ifc$/i, "").split(/[_\-.]/).pop() ?? f;
    return base.toUpperCase();
  };
  const a = stem(fileA);
  const b = stem(fileB);
  if (!a && !b) return "UNKNOWN";
  if (!b) return a;
  if (!a) return b;
  return `${a}×${b}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse a BCF 2.1 archive (as ArrayBuffer or Uint8Array) into Clash[].
 * Throws if the buffer cannot be opened as a ZIP.
 */
export async function parseBcf(data: ArrayBuffer | Uint8Array): Promise<Clash[]> {
  const zip = await JSZip.loadAsync(data);
  const clashes: Clash[] = [];

  // Collect all top-level folder names (each = one topic GUID)
  const topicGuids = new Set<string>();
  zip.forEach((relativePath) => {
    const parts = relativePath.split("/");
    if (parts.length >= 2 && parts[0]) {
      topicGuids.add(parts[0]);
    }
  });

  let index = 1;

  for (const topicGuid of topicGuids) {
    // ── Read markup.bcf ──────────────────────────────────────────────────────
    const markupFile = zip.file(`${topicGuid}/markup.bcf`);
    if (!markupFile) continue;

    const markupXml = await markupFile.async("text");
    const parsed = xmlParser.parse(markupXml) as BcfMarkup;
    const topic = parsed?.Markup?.Topic;
    if (!topic) continue;

    const guid = topic["@_Guid"] ?? topicGuid;
    const title = topic.Title ?? `Clash ${index}`;
    const description = topic.Description ?? "";
    const status = parseStatus(topic["@_TopicStatus"]);
    const priority = parsePriority(topic.Priority);
    const assignee = topic.AssignedTo ?? undefined;
    const createdAt = topic.CreationDate ?? new Date().toISOString();

    // Labels
    let labels: string[] = [];
    if (topic.Labels) {
      if (typeof topic.Labels === "string") {
        labels = [topic.Labels];
      } else if (typeof topic.Labels === "object") {
        const raw = (topic.Labels as { Label?: string | string[] }).Label;
        if (Array.isArray(raw)) labels = raw;
        else if (raw) labels = [raw];
      }
    }

    // ── Read viewpoint file ──────────────────────────────────────────────────
    const vpRefs = parsed?.Markup?.Viewpoints?.ViewPoint;
    const vpRefArray: BcfMarkupViewpoint[] = Array.isArray(vpRefs)
      ? vpRefs
      : vpRefs
      ? [vpRefs]
      : [];

    let viewpoint: ClashViewpoint = {
      cameraPosition: [0, 10, 20],
      cameraDirection: [0, -0.4, -0.9],
      cameraUpVector: [0, 1, 0],
      target: [0, 0, 0],
    };

    let ifcGuidA = "";
    let ifcGuidB = "";
    let fileA = "";
    let fileB = "";

    if (vpRefArray.length > 0) {
      const vpFilename = vpRefArray[0].Viewpoint ?? `${vpRefArray[0]["@_Guid"]}.bcfv`;
      const vpFile = zip.file(`${topicGuid}/${vpFilename}`);
      if (vpFile) {
        const vpXml = await vpFile.async("text");
        const vpParsed = xmlParser.parse(vpXml) as { VisualizationInfo?: BcfViewpoint };
        const vi = vpParsed?.VisualizationInfo;
        if (vi) {
          const cam = vi.PerspectiveCamera ?? vi.OrthogonalCamera;
          if (cam) {
            const pos = toVec3(cam.CameraViewPoint);
            const dir = toVec3(cam.CameraDirection);
            const up = toVec3(cam.CameraUpVector);
            // Compute a target point along the direction vector
            const target: [number, number, number] = [
              pos[0] + dir[0] * 10,
              pos[1] + dir[1] * 10,
              pos[2] + dir[2] * 10,
            ];
            viewpoint = { cameraPosition: pos, cameraDirection: dir, cameraUpVector: up, target };
          }

          // Extract selected component GUIDs
          [ifcGuidA, ifcGuidB] = extractGuids(vi);

          // Try to read filenames from component OriginatingSystem or similar
          // (BCF doesn't mandate file references per component, so we do our best)
          const raw = vi.Components?.Selection?.Component;
          const components: BcfComponent[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
          fileA = components[0]?.OriginatingSystem ?? "";
          fileB = components[1]?.OriginatingSystem ?? "";
        }
      }
    }

    // Midpoint = target from viewpoint (best approximation without mesh data)
    const midpoint: [number, number, number] = [...viewpoint.target];

    // Derive a ruleId from the file pair (or fall back to topic type)
    const ruleId = fileA && fileB
      ? deriveRuleId(fileA, fileB)
      : topic["@_TopicType"] ?? "UNKNOWN";

    const id = `CLH-${String(index).padStart(3, "0")}`;

    clashes.push({
      guid,
      id,
      title,
      description,
      status,
      priority,
      ruleId,
      ifcGuidA,
      ifcGuidB,
      fileA,
      fileB,
      midpoint,
      viewpoint,
      assignee,
      labels,
      createdAt,
    });

    index++;
  }

  // Sort by createdAt ascending so IDs are stable
  clashes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return clashes;
}
