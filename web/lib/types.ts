export type ClashStatus = "open" | "in_progress" | "in_review" | "resolved" | "closed";
export type ClashPriority = "urgent" | "high" | "medium" | "low" | "none";

export interface ClashViewpoint {
  cameraPosition: [number, number, number];
  cameraDirection: [number, number, number];
  cameraUpVector: [number, number, number];
  target: [number, number, number];
  /** Perspective field of view in degrees (undefined for orthogonal cameras) */
  fieldOfView?: number;
  /** Orthogonal camera view-to-world scale (undefined for perspective cameras) */
  orthogonalScale?: number;
  /** "perspective" | "orthogonal" */
  cameraType?: "perspective" | "orthogonal";
}

export interface Clash {
  guid: string;
  id: string; // CLH-001
  title: string;
  description: string;
  status: ClashStatus;
  priority: ClashPriority;
  ruleId: string;
  ifcGuidA: string;
  ifcGuidB: string;
  fileA: string;
  fileB: string;
  midpoint: [number, number, number];
  viewpoint: ClashViewpoint;
  assignee?: string;
  labels: string[];
  createdAt: string;
  modifiedDate?: string;
  creationAuthor?: string;
  linearIssueId?: string;
}

export interface ClashRule {
  id: string;
  a: { file: string; selector: string };
  b: { file: string; selector: string };
}

export const STATUS_META: Record<ClashStatus, { label: string; color: string; icon: string }> = {
  open:        { label: "Open",        color: "#6B7280", icon: "○" },
  in_progress: { label: "In Progress", color: "#F59E0B", icon: "◉" },
  in_review:   { label: "In Review",   color: "#3B82F6", icon: "◉" },
  resolved:    { label: "Resolved",    color: "#22C55E", icon: "✓" },
  closed:      { label: "Closed",      color: "#374151", icon: "●" },
};

export const PRIORITY_META: Record<ClashPriority, { label: string; color: string; icon: string }> = {
  urgent: { label: "Urgent",   color: "#E24B4A", icon: "!!!" },
  high:   { label: "High",     color: "#F09595", icon: "↑↑"  },
  medium: { label: "Medium",   color: "#BA7517", icon: "↑"   },
  low:    { label: "Low",      color: "#639922", icon: "↓"   },
  none:   { label: "No priority", color: "#6B7280", icon: "···" },
};

export interface ActivityEntry {
  id: string;
  clashGuid: string;
  type: "status_change" | "priority_change" | "assignee_change" | "comment" | "created";
  actor: string; // e.g. "bruadam"
  timestamp: string; // ISO 8601
  field?: string;
  from?: string;
  to?: string;
  body?: string; // for comments only
}

export interface Comment {
  id: string;
  clashGuid: string;
  actor: string;
  timestamp: string;
  body: string; // markdown
}

export const STATUS_ORDER: ClashStatus[] = [
  "in_progress",
  "in_review",
  "open",
  "resolved",
  "closed",
];
