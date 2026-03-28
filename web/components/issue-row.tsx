"use client";

import { cn, formatDate } from "@/lib/utils";
import type { Clash } from "@/lib/types";
import { STATUS_META, PRIORITY_META } from "@/lib/types";

interface IssueRowProps {
  clash: Clash;
  selected: boolean;
  onClick: () => void;
}

export function IssueRow({ clash, selected, onClick }: IssueRowProps) {
  const status = STATUS_META[clash.status];
  const priority = PRIORITY_META[clash.priority];

  return (
    <button
      onClick={onClick}
      className={cn(
        "group w-full flex items-center gap-2 px-4 py-1.5 text-left text-xs transition-colors border-b border-border/40",
        selected
          ? "bg-accent text-foreground"
          : "hover:bg-accent/40 text-foreground/80 hover:text-foreground"
      )}
    >
      {/* Priority icon */}
      <span
        className="w-5 shrink-0 font-mono text-[10px] font-semibold"
        style={{ color: priority.color }}
        title={priority.label}
      >
        {priority.icon}
      </span>

      {/* ID */}
      <span className="w-14 shrink-0 text-muted-foreground font-mono text-[11px]">{clash.id}</span>

      {/* Status dot */}
      <span
        className="w-3 h-3 shrink-0 rounded-full border-2"
        style={{
          borderColor: status.color,
          backgroundColor: clash.status === "resolved" || clash.status === "closed" ? status.color : "transparent",
        }}
        title={status.label}
      />

      {/* Title */}
      <span className="flex-1 truncate font-medium text-[13px]">{clash.title}</span>

      {/* Rule badge */}
      <span className="shrink-0 text-muted-foreground text-[11px] hidden sm:block">
        › {clash.ruleId}
      </span>

      {/* Date */}
      <span className="shrink-0 text-muted-foreground text-[11px] w-14 text-right">
        {formatDate(clash.createdAt)}
      </span>
    </button>
  );
}
