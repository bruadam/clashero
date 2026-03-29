/**
 * BCF 2.1 / 3.0 parser — converts a .bcfzip archive into Clash objects.
 *
 * BCF archive layout:
 *   project.bcfp            — XML: project metadata, unit (mm/cm/m/inch/ft)
 *   bcf.version             — XML: version info
 *   <topicGuid>/
 *     markup.bcf            — XML: topic metadata, comments, viewpoint refs
 *     <viewpointGuid>.bcfv  — XML: camera position/direction + component selection
 *
 * Key behaviours:
 *  - Reads project.bcfp to detect the coordinate unit and converts everything to metres.
 *  - IFC GUIDs are extracted from both the BIMSnippet <Reference> in markup.bcf
 *    AND the <Component IfcGuid="..."> elements in the .bcfv file (union, deduped).
 *  - If markup.bcf contains no <Viewpoints> element, the parser scans the topic
 *    folder for any .bcfv files directly so they are never missed.
 *  - Full camera data (position, direction, up-vector, FoV / ortho-scale, type)
 *    is returned on every ClashViewpoint.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { Clash, ClashStatus, ClashPriority, ClashViewpoint } from "./types";

// ── BCF XML types ─────────────────────────────────────────────────────────────

interface BcfComponent {
  "@_IfcGuid"?: string;
  "@_AuthoringToolId"?: string;
  OriginatingSystem?: string;
  "@_Selected"?: string;
  "@_Visible"?: string;
}

interface BcfCamera {
  CameraViewPoint?: { X?: number; Y?: number; Z?: number };
  CameraDirection?:  { X?: number; Y?: number; Z?: number };
  CameraUpVector?:   { X?: number; Y?: number; Z?: number };
  FieldOfView?: number;
  ViewToWorldScale?: number; // orthogonal cameras only
}

interface BcfVisualizationInfo {
  PerspectiveCamera?: BcfCamera;
  OrthogonalCamera?:  BcfCamera;
  Components?: {
    Selection?:  { Component?: BcfComponent | BcfComponent[] };
    Coloring?:   unknown;
    Visibility?: {
      DefaultVisibility?: boolean;
      Exceptions?: { Component?: BcfComponent | BcfComponent[] };
    };
  };
}

interface BcfMarkupViewpoint {
  "@_Guid": string;
  Viewpoint?: string; // .bcfv filename
  Snapshot?:  string; // snapshot image filename
}

interface BcfMarkup {
  Markup?: {
    Topic?: {
      "@_Guid":         string;
      "@_TopicType"?:   string;
      "@_TopicStatus"?: string;
      Title?:           string;
      Description?:     string;
      Priority?:        string;
      AssignedTo?:      string;
      CreationDate?:    string;
      ModifiedDate?:    string;
      CreationAuthor?:  string;
      Labels?:          { Label?: string | string[] } | string;
      ReferenceLinks?:  unknown;
    };
    Viewpoints?: {
      ViewPoint?: BcfMarkupViewpoint | BcfMarkupViewpoint[];
    };
    BIMSnippet?: {
      SnippetType?: string;
      Reference?:   string;
    };
    Comment?: unknown;
  };
}

// ── XML parser ────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    ["Component", "ViewPoint", "Label", "Comment"].includes(name),
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
});

// ── Unit conversion ───────────────────────────────────────────────────────────

type BcfUnit = "millimetre" | "centimetre" | "metre" | "inch" | "foot";

const UNIT_TO_METRES: Record<BcfUnit, number> = {
  millimetre: 0.001,
  centimetre: 0.01,
  metre:      1,
  inch:       0.0254,
  foot:       0.3048,
};

async function parseProjectUnit(zip: JSZip): Promise<number> {
  const projectFile =
    zip.file("project.bcfp") ??
    zip.file("Project.bcfp") ??
    zip.file("project.bcf");

  if (!projectFile) return 1;

  try {
    const xml = await projectFile.async("text");
    const parsed = xmlParser.parse(xml) as {
      ProjectExtension?: { Project?: { Unit?: string } };
    };
    const raw = parsed?.ProjectExtension?.Project?.Unit?.toLowerCase().trim() as BcfUnit | undefined;
    if (raw && raw in UNIT_TO_METRES) {
      return UNIT_TO_METRES[raw];
    }
    return 1;
  } catch {
    return 1;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toVec3(
  obj?: { X?: number; Y?: number; Z?: number },
  scale = 1,
): [number, number, number] {
  return [
    (obj?.X ?? 0) * scale,
    (obj?.Y ?? 0) * scale,
    (obj?.Z ?? 0) * scale,
  ];
}

function parseStatus(raw?: string): ClashStatus {
  if (!raw) return "open";
  const s = raw.toLowerCase().replace(/[\s_-]+/g, "_");
  if (s.includes("progress"))                                   return "in_progress";
  if (s.includes("review"))                                     return "in_review";
  if (s.includes("resolv") || s.includes("done"))               return "resolved";
  if (s.includes("close"))                                      return "closed";
  return "open";
}

function parsePriority(raw?: string): ClashPriority {
  if (!raw) return "none";
  const p = raw.toLowerCase();
  if (p.includes("critical") || p.includes("urgent")) return "urgent";
  if (p.includes("high") || p.includes("major"))      return "high";
  if (p.includes("med"))                               return "medium";
  if (p.includes("low") || p.includes("minor"))       return "low";
  return "none";
}

/**
 * Extract all IfcGuids from the Selection block of a VisualizationInfo.
 * Returns the full array — caller decides how many to use.
 */
function extractGuidsFromVp(vi: BcfVisualizationInfo): string[] {
  const raw = vi.Components?.Selection?.Component;
  const components: BcfComponent[] = Array.isArray(raw)
    ? raw
    : raw
    ? [raw]
    : [];
  return components.map((c) => c["@_IfcGuid"] ?? "").filter(Boolean);
}

/**
 * Derive a ruleId from two originating-system / filename strings.
 * e.g. "B250_VENT.ifc" + "B250_VVS.ifc" → "VENT×VVS"
 */
function deriveRuleId(fileA: string, fileB: string): string {
  const stem = (f: string) => {
    const base = f.replace(/\.ifc$/i, "").split(/[_\-.]+/).pop() ?? f;
    return base.toUpperCase();
  };
  const a = stem(fileA);
  const b = stem(fileB);
  if (!a && !b) return "UNKNOWN";
  if (!b)       return a;
  if (!a)       return b;
  return `${a}×${b}`;
}

/**
 * Extract IFC type names from a clash description like:
 * "Clash between IFCAIRTERMINAL (guid) and IFCCHIMNEY (guid)"
 * Returns [typeA, typeB] or empty strings if not found.
 */
function extractIfcTypesFromDescription(desc: string): [string, string] {
  // Match IFC type names (IFC followed by uppercase letters/digits)
  const matches = desc.match(/\bIFC[A-Z][A-Z0-9]*\b/g);
  if (!matches || matches.length === 0) return ["", ""];
  return [matches[0] ?? "", matches[1] ?? ""];
}

/**
 * Derive a ruleId from two IFC type names.
 * e.g. "IFCAIRTERMINAL" + "IFCCHIMNEY" → "AIRTERMINAL×CHIMNEY"
 */
function deriveRuleIdFromTypes(typeA: string, typeB: string): string {
  const strip = (t: string) => t.replace(/^IFC/i, "").toUpperCase();
  const a = strip(typeA);
  const b = strip(typeB);
  if (!a && !b) return "";
  if (!b)       return a;
  if (!a)       return b;
  if (a === b)  return a;
  return `${a}×${b}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse a BCF 2.1 / 3.0 archive (as ArrayBuffer or Uint8Array) into Clash[].
 * Throws if the buffer cannot be opened as a ZIP.
 */
export async function parseBcf(data: ArrayBuffer | Uint8Array): Promise<Clash[]> {
  const zip = await JSZip.loadAsync(data);

  // Read project unit (mm → m conversion factor)
  const unitScale = await parseProjectUnit(zip);

  // Build a map of topic-folder → [list of .bcfv filenames] for fallback discovery
  const bcfvByTopic = new Map<string, string[]>();
  zip.forEach((relativePath) => {
    const parts = relativePath.split("/");
    if (parts.length === 2 && parts[1].endsWith(".bcfv")) {
      const folder = parts[0];
      if (!bcfvByTopic.has(folder)) bcfvByTopic.set(folder, []);
      bcfvByTopic.get(folder)!.push(parts[1]);
    }
  });

  // Collect all top-level topic folders
  const topicGuids = new Set<string>();
  zip.forEach((relativePath) => {
    const parts = relativePath.split("/");
    if (parts.length >= 2 && parts[0]) topicGuids.add(parts[0]);
  });

  const clashes: Clash[] = [];
  let index = 1;

  for (const topicGuid of topicGuids) {
    // ── Read markup.bcf ──────────────────────────────────────────────────────
    const markupFile = zip.file(`${topicGuid}/markup.bcf`);
    if (!markupFile) continue;

    const markupXml  = await markupFile.async("text");
    const parsed     = xmlParser.parse(markupXml) as BcfMarkup;
    const markup     = parsed?.Markup;
    const topic      = markup?.Topic;
    if (!topic) continue;

    const guid           = topic["@_Guid"] ?? topicGuid;
    const title          = topic.Title ?? `Clash ${index}`;
    const description    = topic.Description ?? "";
    const status         = parseStatus(topic["@_TopicStatus"]);
    const priority       = parsePriority(topic.Priority);
    const assignee       = topic.AssignedTo ?? undefined;
    const createdAt      = topic.CreationDate ?? new Date().toISOString();
    const modifiedDate   = topic.ModifiedDate ?? undefined;
    const creationAuthor = topic.CreationAuthor ?? undefined;

    // Labels
    let labels: string[] = [];
    if (topic.Labels) {
      if (typeof topic.Labels === "string") {
        labels = [topic.Labels];
      } else {
        const raw = (topic.Labels as { Label?: string | string[] }).Label;
        if (Array.isArray(raw)) labels = raw.map(String);
        else if (raw != null)   labels = [String(raw)];
      }
    }

    // IFC GUIDs from BIMSnippet (unused — we always prefer viewpoint component selection)

    // ── Resolve .bcfv filenames ──────────────────────────────────────────────
    // Prefer the Viewpoints list from markup; fall back to folder scan.
    const vpRefs      = markup?.Viewpoints?.ViewPoint;
    const vpRefArray: BcfMarkupViewpoint[] = Array.isArray(vpRefs)
      ? vpRefs
      : vpRefs
      ? [vpRefs]
      : [];

    // Build list of .bcfv filenames to try
    const bcfvFilenames: string[] = vpRefArray.length > 0
      ? vpRefArray.map((ref) => ref.Viewpoint ?? `${ref["@_Guid"]}.bcfv`)
      : (bcfvByTopic.get(topicGuid) ?? []);

    // ── Parse first available .bcfv ──────────────────────────────────────────
    let viewpoint: ClashViewpoint = {
      cameraPosition: [0, 10, 20],
      cameraDirection: [0, -0.4, -0.9],
      cameraUpVector:  [0, 1, 0],
      target:          [0, 0, 0],
    };

    let vpGuids: string[] = [];
    let fileA = "";
    let fileB = "";

    for (const vpFilename of bcfvFilenames) {
      const vpFile = zip.file(`${topicGuid}/${vpFilename}`);
      if (!vpFile) continue;

      const vpXml    = await vpFile.async("text");
      const vpParsed = xmlParser.parse(vpXml) as { VisualizationInfo?: BcfVisualizationInfo };
      const vi       = vpParsed?.VisualizationInfo;
      if (!vi) continue;

      const isPerspective = !!vi.PerspectiveCamera;
      const cam: BcfCamera | undefined = vi.PerspectiveCamera ?? vi.OrthogonalCamera;

      if (cam) {
        const pos = toVec3(cam.CameraViewPoint, unitScale);
        const dir = toVec3(cam.CameraDirection);           // direction is unit-less
        const up  = toVec3(cam.CameraUpVector);

        // Normalise direction (BCF spec says it should already be unit length, but guard against it)
        const dirLen = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2) || 1;
        const dirN: [number, number, number] = [dir[0] / dirLen, dir[1] / dirLen, dir[2] / dirLen];

        // Target is stored as [0,0,0] here — the real midpoint is computed later
        // by refineMidpoints() using actual element bounding boxes after model load.
        const target: [number, number, number] = [0, 0, 0];

        viewpoint = {
          cameraPosition: pos,
          cameraDirection: dirN,
          cameraUpVector:  up,
          target,
          cameraType:     isPerspective ? "perspective" : "orthogonal",
          ...(isPerspective && cam.FieldOfView != null
            ? { fieldOfView: cam.FieldOfView }
            : {}),
          ...((!isPerspective) && cam.ViewToWorldScale != null
            ? { orthogonalScale: cam.ViewToWorldScale * unitScale }
            : {}),
        };
      }

      // GUIDs from component selection in the viewpoint
      vpGuids = extractGuidsFromVp(vi);

      // File references from OriginatingSystem
      const rawComponents = vi.Components?.Selection?.Component;
      const components: BcfComponent[] = Array.isArray(rawComponents)
        ? rawComponents
        : rawComponents
        ? [rawComponents]
        : [];
      fileA = components[0]?.OriginatingSystem ?? "";
      fileB = components[1]?.OriginatingSystem ?? "";

      break; // use first valid viewpoint
    }

    // Use viewpoint component selection GUIDs only
    const ifcGuidA = vpGuids[0] ?? "";
    const ifcGuidB = vpGuids[1] ?? "";

    // Midpoint defaults to origin — refined later by refineMidpoints() from element bounding boxes
    const midpoint: [number, number, number] = [0, 0, 0];

    let ruleId = "";
    if (fileA && fileB) {
      ruleId = deriveRuleId(fileA, fileB);
    } else {
      // Try to extract IFC types from the description (e.g. "Clash between IFCAIRTERMINAL ... and IFCCHIMNEY ...")
      const [typeA, typeB] = extractIfcTypesFromDescription(description);
      if (typeA || typeB) {
        ruleId = deriveRuleIdFromTypes(typeA, typeB);
      }
    }
    if (!ruleId) ruleId = topic["@_TopicType"] ?? "UNKNOWN";

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
      modifiedDate,
      creationAuthor,
    });

    index++;
  }

  // Sort by createdAt ascending so IDs are stable
  clashes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  clashes.forEach((c, i) => {
    c.id = `CLH-${String(i + 1).padStart(3, "0")}`;
  });

  return clashes;
}
