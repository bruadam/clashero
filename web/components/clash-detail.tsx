"use client";

import Link from "next/link";
import { X, ChevronLeft, ChevronRight, Send, Link as LinkIcon } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { Clash, ClashStatus, ClashPriority, ActivityEntry, Comment } from "@/lib/types";
import { STATUS_META, PRIORITY_META, STATUS_ORDER } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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

  // Merge activity + comments into a single timeline sorted by timestamp
  const timeline: ActivityOrComment[] = [
    ...activity.map((a) => ({ ...a, _kind: "activity" as const })),
    ...comments.map((c) => ({ ...c, _kind: "comment" as const })),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return (
    <div className="flex flex-col h-full border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
        <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <Link
          href={`/clash/${clash.id}`}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
          title={`/clash/${clash.id}`}
        >
          {clash.id}
        </Link>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{index + 1} / {total}</span>
        <button onClick={onPrev} className="p-1 rounded hover:bg-accent transition-colors">
          <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <button onClick={onNext} className="p-1 rounded hover:bg-accent transition-colors">
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Title */}
          <h2 className="text-base font-semibold leading-tight">{clash.title}</h2>

          {/* Rule */}
          <p className="text-xs text-muted-foreground">
            Sub-issue of rule › <span className="text-foreground">{clash.ruleId}</span>
          </p>

          {/* Description */}
          <p className="text-sm text-foreground/80 leading-relaxed">{clash.description}</p>

          <Separator />

          {/* Properties */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Properties
            </h3>

            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
              {/* Status */}
              <span className="text-muted-foreground self-center">Status</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 hover:bg-accent rounded px-1 py-0.5 -mx-1 transition-colors text-left">
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

              {/* Priority */}
              <span className="text-muted-foreground self-center">Priority</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 hover:bg-accent rounded px-1 py-0.5 -mx-1 transition-colors text-left">
                    <span className="font-mono text-[10px]" style={{ color: priority.color }}>
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

              {/* Assignee */}
              <span className="text-muted-foreground self-center">Assignee</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 hover:bg-accent rounded px-1 py-0.5 -mx-1 transition-colors text-left">
                    {clash.assignee ? (
                      <>
                        <span className="w-5 h-5 rounded-full bg-accent border border-border flex items-center justify-center text-[10px] font-medium">
                          {clash.assignee[0].toUpperCase()}
                        </span>
                        <span>{clash.assignee}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">+ Add assignee</span>
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
                      <span className="w-5 h-5 rounded-full bg-accent border border-border flex items-center justify-center text-[10px] font-medium">
                        {member[0].toUpperCase()}
                      </span>
                      {member}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(clash.createdAt)}</span>
            </div>
          </div>

          {clash.labels.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Labels
                </h3>
                <div className="flex flex-wrap gap-1">
                  {clash.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-[10px] py-0 px-1.5">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Source files */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Source Files
            </h3>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#ff3b30]" />
                <span className="font-mono text-[11px]">{clash.fileA}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#007aff]" />
                <span className="font-mono text-[11px]">{clash.fileB}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* IFC GUIDs */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              IFC GUIDs
            </h3>
            <div className="space-y-1 text-xs font-mono text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="text-[#ff3b30]">A:</span>
                <span className="truncate text-[10px]">{clash.ifcGuidA}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#007aff]">B:</span>
                <span className="truncate text-[10px]">{clash.ifcGuidB}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Activity + Comments timeline */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Activity
            </h3>

            {timeline.length === 0 && (
              <p className="text-xs text-muted-foreground">No activity yet.</p>
            )}

            <div className="space-y-3">
              {timeline.map((item) => {
                if (item._kind === "activity") {
                  return (
                    <div key={item.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                      <span>
                        <span className="font-medium text-foreground/70">{item.actor}</span>
                        {" "}{activityLabel(item)}
                        <span className="ml-1.5 text-[10px] opacity-60">
                          · {formatDate(item.timestamp)}
                        </span>
                      </span>
                    </div>
                  );
                }

                // comment
                return (
                  <div key={item.id} className="rounded-md border border-border p-2.5 text-xs space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-accent border border-border flex items-center justify-center text-[10px] font-medium shrink-0">
                        {item.actor[0].toUpperCase()}
                      </span>
                      <span className="font-medium text-foreground/80">{item.actor}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {formatDate(item.timestamp)}
                      </span>
                    </div>
                    <div className="prose prose-xs dark:prose-invert max-w-none text-foreground/80 pl-7
                      [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_code]:text-[10px] [&_pre]:text-[10px]">
                      <ReactMarkdown>{item.body}</ReactMarkdown>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Comment box */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Leave a comment
              </h3>
              <button
                onClick={() => setPreview((v) => !v)}
                className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {preview ? "Edit" : "Preview"}
              </button>
            </div>

            {preview ? (
              <div className="min-h-[72px] rounded-md border border-border bg-muted/30 p-2.5 text-xs
                prose prose-xs dark:prose-invert max-w-none
                [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_code]:text-[10px] [&_pre]:text-[10px]">
                {commentDraft.trim() ? (
                  <ReactMarkdown>{commentDraft}</ReactMarkdown>
                ) : (
                  <span className="text-muted-foreground">Nothing to preview.</span>
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
                placeholder="Leave a comment… (markdown supported, ⌘↵ to submit)"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs
                  placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1
                  focus:ring-ring transition-colors"
              />
            )}

            <div className="flex justify-end">
              <button
                onClick={submitComment}
                disabled={!commentDraft.trim() || submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground
                  hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-3 h-3" />
                {submitting ? "Saving…" : "Comment"}
              </button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
