"use client";

import Link from "next/link";
import { X, ChevronLeft, ChevronRight, Send, Link2, Check, ChevronDown, ChevronRight as ChevronRightSmall, MessageSquare, Activity, Download, ArrowUpToLine, ArrowDownToLine, ExternalLink } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { exportBcf, downloadBcf } from "@/lib/bcf-exporter";
import ReactMarkdown from "react-markdown";
import type { Clash, ClashStatus, ClashPriority, ActivityEntry, Comment } from "@/lib/types";
import { STATUS_META, PRIORITY_META, STATUS_ORDER } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { StatusIcon } from "@/components/status-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ClashDetailProps {
  clash: Clash;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onStatusChange?: (status: ClashStatus) => void;
  onPriorityChange?: (priority: ClashPriority) => void;
  onAssigneeChange?: (assignee: string) => void;
}

interface ElementInfo {
  modelFilename: string;
  ifcType: string;
  name: string | null;
  description: string | null;
  properties: Record<string, string>;
}

const PRIORITIES: ClashPriority[] = ["urgent", "high", "medium", "low", "none"];
const TEAM_MEMBERS = ["michael.wk", "sarah.j", "tom.b", "anna.k", "unassigned"];

type ActivityOrComment =
  | (ActivityEntry & { _kind: "activity" })
  | (Comment & { _kind: "comment" });

function activityLabel(entry: ActivityEntry): string {
  switch (entry.type) {
    case "status_change":
      return `changed status from ${entry.from} to ${entry.to}`;
    case "priority_change":
      return `changed priority from ${entry.from} to ${entry.to}`;
    case "assignee_change":
      return entry.to
        ? `assigned to ${entry.to}`
        : `removed assignee`;
    case "created":
      return "clash detected by engine";
    default:
      return entry.type;
  }
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  className,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 py-2 text-left group"
      >
        {open
          ? <ChevronDown className="w-3 h-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
          : <ChevronRightSmall className="w-3 h-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        }
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
      </button>
      {open && children}
    </div>
  );
}

function PropertySetGroup({
  name,
  properties,
  defaultOpen = true,
}: {
  name: string;
  properties: [string, string][];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/10 text-left hover:bg-muted/20 transition-colors"
      >
        {open
          ? <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/50" />
          : <ChevronRightSmall className="w-2.5 h-2.5 text-muted-foreground/50" />
        }
        <span className="text-[10px] font-medium text-muted-foreground/70">{name}</span>
        <span className="text-[9px] text-muted-foreground/40 ml-auto">{properties.length}</span>
      </button>
      {open && (
        <div className="divide-y divide-border/30">
          {properties.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 px-2.5 py-1.5 bg-muted/5">
              <span className="text-[10px] text-muted-foreground/60 shrink-0 w-28 truncate" title={k}>{k}</span>
              <span className="text-[10px] text-foreground/70 break-all">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClashDetail({
  clash,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
}: ClashDetailProps) {
  const status = STATUS_META[clash.status];
  const priority = PRIORITY_META[clash.priority];

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elements, setElements] = useState<[ElementInfo | null, ElementInfo | null]>([null, null]);
  const [linearIssueId, setLinearIssueId] = useState(clash.linearIssueId);
  const [linearIssueUrl, setLinearIssueUrl] = useState<string | null>(null);
  const [linearIssueIdentifier, setLinearIssueIdentifier] = useState<string | null>(null);
  const [linearPushing, setLinearPushing] = useState(false);
  const [linearPulling, setLinearPulling] = useState(false);
  const [linearError, setLinearError] = useState<string | null>(null);

  const pushToLinear = useCallback(async () => {
    setLinearPushing(true);
    setLinearError(null);
    try {
      const res = await fetch(`/api/linear/sync/${clash.guid}`, { method: "POST" });
      const data = await res.json() as { issue?: { id: string; url: string; identifier: string }; error?: string };
      if (!res.ok || data.error) { setLinearError(data.error ?? "Push failed"); return; }
      if (data.issue) {
        setLinearIssueId(data.issue.id);
        setLinearIssueUrl(data.issue.url);
        setLinearIssueIdentifier(data.issue.identifier);
      }
    } finally {
      setLinearPushing(false);
    }
  }, [clash.guid]);

  const pullFromLinear = useCallback(async () => {
    setLinearPulling(true);
    setLinearError(null);
    try {
      const res = await fetch(`/api/linear/pull/${clash.guid}`, { method: "POST" });
      const data = await res.json() as { applied?: { status: string }; error?: string };
      if (!res.ok || data.error) { setLinearError(data.error ?? "Pull failed"); return; }
      if (data.applied?.status) onStatusChange?.(data.applied.status as import("@/lib/types").ClashStatus);
    } finally {
      setLinearPulling(false);
    }
  }, [clash.guid, onStatusChange]);

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/clash/${clash.guid}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [clash.guid]);

  const exportThisClash = useCallback(async () => {
    const blob = await exportBcf([clash], clash.title);
    downloadBcf(blob, `${clash.id}.bcf`);
  }, [clash]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadFeed = useCallback(async () => {
    const [actRes, cmtRes] = await Promise.all([
      fetch(`/api/clashes/${clash.guid}/activity`),
      fetch(`/api/clashes/${clash.guid}/comments`),
    ]);
    if (actRes.ok) setActivity(await actRes.json());
    if (cmtRes.ok) setComments(await cmtRes.json());
  }, [clash.guid]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // Resolve full element info for both clash components
  useEffect(() => {
    const guids = [clash.ifcGuidA, clash.ifcGuidB].filter(Boolean);
    if (guids.length === 0) return;
    const params = guids.map((g) => `guid=${encodeURIComponent(g)}`).join("&");
    fetch(`/api/elements?${params}`)
      .then((r) => r.json())
      .then((data: Record<string, ElementInfo | null>) => {
        setElements([
          clash.ifcGuidA ? (data[clash.ifcGuidA] ?? null) : null,
          clash.ifcGuidB ? (data[clash.ifcGuidB] ?? null) : null,
        ]);
      })
      .catch(() => {/* leave as-is on error */});
  }, [clash.guid, clash.ifcGuidA, clash.ifcGuidB]);

  const submitComment = async () => {
    const body = commentDraft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/clashes/${clash.guid}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const newComment: Comment = await res.json();
        setComments((prev) => [...prev, newComment]);
        setCommentDraft("");
        setPreview(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const timeline: ActivityOrComment[] = [
    ...activity.map((a) => ({ ...a, _kind: "activity" as const })),
    ...comments.map((c) => ({ ...c, _kind: "comment" as const })),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const commentCount = comments.length;
  const activityCount = activity.length;

  return (
    <div className="flex flex-col h-full border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 h-11 border-b border-border shrink-0">
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>

        <Link
          href={`/clash/${clash.guid}`}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors font-mono"
          title={`/clash/${clash.guid}`}
        >
          {clash.id}
        </Link>

        <div className="flex-1" />

        <span className="text-[10px] text-muted-foreground/50 tabular-nums">{index + 1} / {total}</span>

        <button
          onClick={copyLink}
          title="Copy link"
          className="p-1 rounded hover:bg-accent transition-colors"
        >
          {copied
            ? <Check className="w-3.5 h-3.5 text-green-500" />
            : <Link2 className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>

        <button
          onClick={exportThisClash}
          title="Export as BCF"
          className="p-1 rounded hover:bg-accent transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-muted-foreground" />
        </button>

        <div className="w-px h-4 bg-border" />

        <button
          onClick={onPrev}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Previous issue"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={onNext}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Next issue"
        >
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Scrollable body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 pt-4 pb-2 space-y-1">
          {/* Title + rule breadcrumb */}
          <p className="text-[10px] text-muted-foreground/60 font-mono">
            {clash.ruleId}
          </p>
          <h2 className="text-sm font-semibold leading-snug text-foreground">{clash.title}</h2>

          {/* Description */}
          {clash.description && (
            <p className="text-xs text-foreground/60 leading-relaxed pt-1">{clash.description}</p>
          )}
        </div>

        {/* Labels */}
        {clash.labels.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1">
            {clash.labels.map((label) => (
              <Badge key={label} variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                {label}
              </Badge>
            ))}
          </div>
        )}

        {/* Properties card */}
        <div className="mx-3 mb-3 rounded-lg border border-border bg-muted/20">
          <div className="px-3 py-2.5 space-y-0">
            {/* Status */}
            <div className="flex items-center min-h-[32px] border-b border-border/50 last:border-0">
              <span className="w-24 text-[11px] text-muted-foreground shrink-0">Status</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 hover:bg-accent rounded px-1.5 py-1 -mx-1.5 transition-colors text-left text-xs">
                    <StatusIcon status={clash.status} size="sm" />
                    <span>{status.label}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {STATUS_ORDER.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onClick={() => onStatusChange?.(s)}
                      className="flex items-center gap-2 text-xs"
                    >
                      <StatusIcon status={s} size="sm" />
                      {STATUS_META[s].label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Priority */}
            <div className="flex items-center min-h-[32px] border-b border-border/50 last:border-0">
              <span className="w-24 text-[11px] text-muted-foreground shrink-0">Priority</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 hover:bg-accent rounded px-1.5 py-1 -mx-1.5 transition-colors text-left text-xs">
                    <span className="font-mono text-[10px] w-5 shrink-0" style={{ color: priority.color }}>
                      {priority.icon}
                    </span>
                    <span>{priority.label}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  {PRIORITIES.map((p) => {
                    const meta = PRIORITY_META[p];
                    return (
                      <DropdownMenuItem
                        key={p}
                        onClick={() => onPriorityChange?.(p)}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="font-mono text-[10px] w-5" style={{ color: meta.color }}>
                          {meta.icon}
                        </span>
                        {meta.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Assignee */}
            <div className="flex items-center min-h-[32px] border-b border-border/50 last:border-0">
              <span className="w-24 text-[11px] text-muted-foreground shrink-0">Assignee</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 hover:bg-accent rounded px-1.5 py-1 -mx-1.5 transition-colors text-left text-xs">
                    {clash.assignee ? (
                      <>
                        <span className="w-5 h-5 rounded-full bg-accent border border-border flex items-center justify-center text-[9px] font-semibold shrink-0">
                          {clash.assignee[0].toUpperCase()}
                        </span>
                        <span>{clash.assignee}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground/60">Unassigned</span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {TEAM_MEMBERS.map((member) => (
                    <DropdownMenuItem
                      key={member}
                      onClick={() => onAssigneeChange?.(member === "unassigned" ? "" : member)}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="w-5 h-5 rounded-full bg-accent border border-border flex items-center justify-center text-[9px] font-semibold">
                        {member[0].toUpperCase()}
                      </span>
                      {member}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Created */}
            <div className="flex items-center min-h-[32px] border-b border-border/50">
              <span className="w-24 text-[11px] text-muted-foreground shrink-0">Created</span>
              <span className="text-xs text-foreground/70">{formatDate(clash.createdAt)}</span>
            </div>

            {/* Linear */}
            <div className="flex items-center min-h-[32px]">
              <span className="w-24 text-[11px] text-muted-foreground shrink-0">Linear</span>
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {linearIssueId ? (
                  <>
                    {linearIssueUrl ? (
                      <a
                        href={linearIssueUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline min-w-0"
                      >
                        <span className="truncate">{linearIssueIdentifier ?? linearIssueId}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-xs text-foreground/70 font-mono truncate">{linearIssueIdentifier ?? linearIssueId}</span>
                    )}
                    <button
                      onClick={pullFromLinear}
                      disabled={linearPulling}
                      title="Pull status from Linear"
                      className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-border hover:bg-accent transition-colors disabled:opacity-40"
                    >
                      <ArrowDownToLine className="w-3 h-3" />
                      {linearPulling ? "Pulling…" : "Pull"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={pushToLinear}
                    disabled={linearPushing}
                    title="Push to Linear as new issue"
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-border hover:bg-accent transition-colors disabled:opacity-40"
                  >
                    <ArrowUpToLine className="w-3 h-3" />
                    {linearPushing ? "Pushing…" : "Push to Linear"}
                  </button>
                )}
              </div>
            </div>

            {linearError && (
              <p className="text-[10px] text-red-500 px-0.5 pb-1">{linearError}</p>
            )}
          </div>
        </div>

        {/* Components */}
        <div className="px-4 pb-3">
          {([
            { guid: clash.ifcGuidA, el: elements[0], accent: "#ff3b30", label: "A" },
            { guid: clash.ifcGuidB, el: elements[1], accent: "#007aff", label: "B" },
          ] as const).map(({ guid, el, accent, label }) => {
            if (!guid) return null;
            const title = el?.name ?? el?.ifcType ?? guid;

            // Group properties by property set name
            const propGroups: Record<string, [string, string][]> = {};
            if (el) {
              for (const [k, v] of Object.entries(el.properties)) {
                const dotIdx = k.indexOf(".");
                const group = dotIdx > 0 ? k.slice(0, dotIdx) : "General";
                const propName = dotIdx > 0 ? k.slice(dotIdx + 1) : k;
                (propGroups[group] ??= []).push([propName, v]);
              }
            }
            const groupEntries = Object.entries(propGroups);

            return (
              <CollapsibleSection
                key={label}
                title={el?.ifcType ?? `Component ${label}`}
                defaultOpen={true}
                className="mt-1"
              >
                <div className="mt-1.5 rounded-md border border-border overflow-hidden">
                  {/* Header row: name + model */}
                  <div className="flex items-start gap-2 px-2.5 py-2 bg-muted/10 border-b border-border/50">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: accent }} />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[11px] font-medium text-foreground/80 truncate">{title}</span>
                      {el?.description && (
                        <span className="text-[10px] text-muted-foreground/70 truncate">{el.description}</span>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground/60 truncate">
                        {(el?.modelFilename ?? (label === "A" ? clash.fileA : clash.fileB)) || <span className="italic">unknown model</span>}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/40 break-all">{guid}</span>
                    </div>
                  </div>
                  {/* Properties grouped by property set */}
                  {groupEntries.length > 0 && (
                    <div className="divide-y divide-border/40">
                      {groupEntries.map(([group, props]) => (
                        <PropertySetGroup key={group} name={group} properties={props} defaultOpen={groupEntries.length <= 3} />
                      ))}
                    </div>
                  )}
                  {groupEntries.length === 0 && el && (
                    <p className="px-2.5 py-2 text-[10px] text-muted-foreground/40 italic">No properties.</p>
                  )}
                  {!el && (
                    <p className="px-2.5 py-2 text-[10px] text-muted-foreground/40 italic">Not found in model registry.</p>
                  )}
                </div>
              </CollapsibleSection>
            );
          })}
        </div>

        {/* Activity + Comments */}
        <div className="px-4 pb-4">
          {/* Section header with counts */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Activity
            </span>
            {activityCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <Activity className="w-3 h-3" />
                {activityCount}
              </span>
            )}
            {commentCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <MessageSquare className="w-3 h-3" />
                {commentCount}
              </span>
            )}
          </div>

          {timeline.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 py-2">No activity yet.</p>
          ) : (
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/60" />

              <div className="space-y-1">
                {timeline.map((item) => {
                  if (item._kind === "activity") {
                    return (
                      <div key={item.id} className="flex items-start gap-2.5 py-0.5">
                        <span className="w-3.5 h-3.5 rounded-full border border-border bg-background flex items-center justify-center shrink-0 mt-0.5 z-10">
                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                        </span>
                        <span className="text-[11px] text-muted-foreground leading-relaxed">
                          <span className="font-medium text-foreground/70">{item.actor}</span>
                          {" "}{activityLabel(item)}
                          <span className="ml-1.5 text-[10px] opacity-50">
                            · {formatDate(item.timestamp)}
                          </span>
                        </span>
                      </div>
                    );
                  }

                  // comment
                  return (
                    <div key={item.id} className="flex items-start gap-2.5 py-1">
                      <span className="w-5 h-5 rounded-full bg-accent border border-border flex items-center justify-center text-[9px] font-semibold shrink-0 mt-0.5 z-10">
                        {item.actor[0].toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0 rounded-lg border border-border bg-muted/20 overflow-hidden">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/50 bg-muted/20">
                          <span className="text-[11px] font-medium text-foreground/80">{item.actor}</span>
                          <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">
                            {formatDate(item.timestamp)}
                          </span>
                        </div>
                        <div className="px-2.5 py-2 prose prose-xs dark:prose-invert max-w-none text-foreground/70
                          [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_code]:text-[10px] [&_pre]:text-[10px]">
                          <ReactMarkdown>{item.body}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Comment box — sticky at bottom */}
      <div className="shrink-0 border-t border-border bg-background px-3 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Comment
          </span>
          <button
            onClick={() => setPreview((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {preview ? "Edit" : "Preview"}
          </button>
        </div>

        {preview ? (
          <div className="min-h-[60px] rounded-md border border-border bg-muted/20 px-2.5 py-2 text-xs
            prose prose-xs dark:prose-invert max-w-none
            [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_code]:text-[10px] [&_pre]:text-[10px]">
            {commentDraft.trim() ? (
              <ReactMarkdown>{commentDraft}</ReactMarkdown>
            ) : (
              <span className="text-muted-foreground/50">Nothing to preview.</span>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment();
            }}
            placeholder="Add a comment… (⌘↵ to submit)"
            rows={2}
            className="w-full rounded-md border border-border bg-muted/20 px-2.5 py-2 text-xs
              placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1
              focus:ring-ring transition-colors"
          />
        )}

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/40">Markdown supported</span>
          <button
            onClick={submitComment}
            disabled={!commentDraft.trim() || submitting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-primary text-primary-foreground
              hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-3 h-3" />
            {submitting ? "Saving…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
