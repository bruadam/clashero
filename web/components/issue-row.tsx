"use client";

import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import type { Clash, ClashStatus, ClashPriority } from "@/lib/types";
import { STATUS_META, PRIORITY_META, STATUS_ORDER } from "@/lib/types";
import { StatusIcon } from "@/components/status-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DisplayOptions, DisplayProp } from "@/components/display-options-panel";

interface IssueRowProps {
  clash: Clash;
  selected: boolean;
  onClick: () => void;
  onStatusChange?: (status: ClashStatus) => void;
  onPriorityChange?: (priority: ClashPriority) => void;
  displayOptions?: DisplayOptions;
}

const PRIORITIES: ClashPriority[] = ["urgent", "high", "medium", "low", "none"];

export function IssueRow({ clash, selected, onClick, onStatusChange, onPriorityChange, displayOptions }: IssueRowProps) {
  const priority = PRIORITY_META[clash.priority];
  const show = (prop: DisplayProp) => !displayOptions || displayOptions.showProperties.has(prop);

  return (
    <Link
      href={`/clash/${clash.guid}`}
      className={cn(
        "group w-full min-w-0 flex items-center gap-2 px-4 py-1.5 text-xs transition-colors border-b border-border/40 cursor-pointer",
        selected
          ? "bg-accent text-foreground"
          : "hover:bg-accent/40 text-foreground/80 hover:text-foreground"
      )}
      onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); onClick(); } }}
    >
      {/* Priority dropdown */}
      {show("priority") && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="w-5 shrink-0 font-mono text-[10px] font-semibold hover:opacity-70 transition-opacity"
              style={{ color: priority.color }}
              title={priority.label}
              onClick={(e) => e.stopPropagation()}
            >
              {priority.icon}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            {PRIORITIES.map((p) => {
              const meta = PRIORITY_META[p];
              return (
                <DropdownMenuItem
                  key={p}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPriorityChange?.(p);
                  }}
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
      )}

      {/* ID */}
      {show("id") && (
        <span className="w-14 shrink-0 text-muted-foreground font-mono text-[11px]">{clash.id}</span>
      )}

      {/* Status dropdown */}
      {show("status") && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="shrink-0 hover:opacity-70 transition-opacity"
              title={STATUS_META[clash.status].label}
              onClick={(e) => e.stopPropagation()}
            >
              <StatusIcon status={clash.status} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {STATUS_ORDER.map((s) => {
              const meta = STATUS_META[s];
              return (
                <DropdownMenuItem
                  key={s}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange?.(s);
                  }}
                  className="flex items-center gap-2 text-xs"
                >
                  <StatusIcon status={s} size="sm" />
                  {meta.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Title */}
      <span className="flex-1 min-w-0 truncate font-medium text-[13px]">{clash.title}</span>

      {/* Assignee */}
      {show("assignee") && clash.assignee && (
        <span className="shrink-0 text-muted-foreground text-[11px] hidden sm:block">
          {clash.assignee}
        </span>
      )}

      {/* Rule badge */}
      {show("rule") && (
        <span className="shrink-0 text-muted-foreground text-[11px] hidden sm:block">
          › {clash.ruleId}
        </span>
      )}

      {/* Labels */}
      {show("labels") && clash.labels.length > 0 && (
        <span className="shrink-0 text-muted-foreground text-[11px] hidden sm:block">
          {clash.labels.join(", ")}
        </span>
      )}

      {/* Date */}
      {show("created") && (
        <span className="shrink-0 text-muted-foreground text-[11px] w-14 text-right">
          {formatDate(clash.createdAt)}
        </span>
      )}
    </Link>
  );
}
