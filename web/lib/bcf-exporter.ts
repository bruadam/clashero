/**
 * BCF 2.1 exporter — converts Clash[] into a .bcf ZIP archive.
 *
 * BCF-XML 2.1 spec: https://github.com/buildingSMART/BCF-XML/tree/release_2_1
 *
 * Archive layout produced:
 *   bcf.version               — version declaration
 *   project.bcfp              — optional project info
 *   <topicGuid>/
 *     markup.bcf              — topic metadata, comments, viewpoint refs
 *     <viewpointGuid>.bcfv    — camera viewpoint + component selection
 */

import JSZip from "jszip";
import type { Clash } from "./types";

// ── XML helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function vec3Xml(tag: string, v: [number, number, number]): string {
  return `<${tag}><X>${v[0]}</X><Y>${v[1]}</Y><Z>${v[2]}</Z></${tag}>`;
}

// ── BCF status / priority mapping ─────────────────────────────────────────────

const STATUS_TO_BCF: Record<string, string> = {
  open:        "Open",
  in_progress: "InProgress",
  in_review:   "InReview",
  resolved:    "Resolved",
  closed:      "Closed",
};

const PRIORITY_TO_BCF: Record<string, string> = {
  urgent: "Critical",
  high:   "High",
  medium: "Medium",
  low:    "Low",
  none:   "",
};

// ── Per-clash XML builders ────────────────────────────────────────────────────

function buildVersionXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Version xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="version.xsd"
         VersionId="2.1">
  <DetailedVersion>2.1</DetailedVersion>
</Version>`;
}

function buildProjectXml(projectName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  xsi:noNamespaceSchemaLocation="project.xsd">
  <Project ProjectId="">
    <Name>${esc(projectName)}</Name>
  </Project>
</ProjectExtension>`;
}

function buildMarkupXml(clash: Clash, viewpointGuid: string): string {
  const bcfStatus = STATUS_TO_BCF[clash.status] ?? "Open";
  const bcfPriority = PRIORITY_TO_BCF[clash.priority] ?? "";
  const labelsXml = clash.labels.length > 0
    ? `    <Labels>\n${clash.labels.map((l) => `      <Label>${esc(l)}</Label>`).join("\n")}\n    </Labels>`
    : "";
  const priorityXml = bcfPriority ? `    <Priority>${esc(bcfPriority)}</Priority>` : "";
  const assigneeXml = clash.assignee ? `    <AssignedTo>${esc(clash.assignee)}</AssignedTo>` : "";
  const descriptionXml = clash.description
    ? `    <Description>${esc(clash.description)}</Description>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:noNamespaceSchemaLocation="markup.xsd">
  <Topic Guid="${esc(clash.guid)}" TopicType="Clash" TopicStatus="${esc(bcfStatus)}">
    <Title>${esc(clash.title)}</Title>
${descriptionXml}
${priorityXml}
${labelsXml}
${assigneeXml}
    <CreationDate>${esc(clash.createdAt)}</CreationDate>
    <CreationAuthor>clashero</CreationAuthor>
    <ReferenceLink>${esc(clash.id)}</ReferenceLink>
  </Topic>
  <Viewpoints>
    <ViewPoint Guid="${esc(viewpointGuid)}">
      <Viewpoint>${esc(viewpointGuid)}.bcfv</Viewpoint>
    </ViewPoint>
  </Viewpoints>
</Markup>`;
}

function buildViewpointXml(clash: Clash): string {
  const vp = clash.viewpoint;

  const componentA = clash.ifcGuidA
    ? `      <Component IfcGuid="${esc(clash.ifcGuidA)}"${clash.fileA ? ` OriginatingSystem="${esc(clash.fileA)}"` : ""}></Component>`
    : "";
  const componentB = clash.ifcGuidB
    ? `      <Component IfcGuid="${esc(clash.ifcGuidB)}"${clash.fileB ? ` OriginatingSystem="${esc(clash.fileB)}"` : ""}></Component>`
    : "";
  const hasComponents = componentA || componentB;
  const componentsXml = hasComponents
    ? `  <Components>
    <Selection>
${[componentA, componentB].filter(Boolean).join("\n")}
    </Selection>
  </Components>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xsi:noNamespaceSchemaLocation="visinfo.xsd"
                   Guid="${esc(clash.guid)}">
  <PerspectiveCamera>
    ${vec3Xml("CameraViewPoint", vp.cameraPosition)}
    ${vec3Xml("CameraDirection", vp.cameraDirection)}
    ${vec3Xml("CameraUpVector", vp.cameraUpVector)}
    <FieldOfView>60</FieldOfView>
  </PerspectiveCamera>
${componentsXml}
</VisualizationInfo>`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Serialize one or more clashes to a BCF 2.1 ZIP archive.
 * Returns a Blob suitable for download.
 */
export async function exportBcf(
  clashes: Clash[],
  projectName = "Clashero Export"
): Promise<Blob> {
  const zip = new JSZip();

  zip.file("bcf.version", buildVersionXml());
  zip.file("project.bcfp", buildProjectXml(projectName));

  for (const clash of clashes) {
    const viewpointGuid = clash.guid;
    const folder = zip.folder(clash.guid)!;
    folder.file("markup.bcf", buildMarkupXml(clash, viewpointGuid));
    folder.file(`${viewpointGuid}.bcfv`, buildViewpointXml(clash));
  }

  return zip.generateAsync({ type: "blob" });
}

/**
 * Trigger a browser download of a BCF archive.
 */
export function downloadBcf(blob: Blob, filename = "export.bcf"): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
