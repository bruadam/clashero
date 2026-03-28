"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { Clash, ClashStatus, ClashPriority } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { IssueRow } from "./issue-row";
import { StatusIcon } from "./status-icon";
import type { DisplayOptions } from "@/components/display-options-panel";

interface IssueGroupProps {
  status: ClashStatus;
  clashes: Clash[];
  selectedGuid: string | null;
  onSelectClash: (guid: string) => void;
  onStatusChange?: (guid: string, status: ClashStatus) => void;
  onPriorityChange?: (guid: string, priority: ClashPriority) => void;
  displayOptions?: DisplayOptions;
}

export function IssueGroup({
  status,
  clashes,
  selectedGuid,
  onSelectClash,
  onStatusChange,
  onPriorityChange,
  displayOptions,
}: IssueGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = STATUS_META[status];

  if (clashes.length === 0) return null;

  return (
    <div className="mb-0.5">
      {/* Group header */}
      <div
        className="flex items-center gap-2 px-4 py-1.5 cursor-pointer hover:bg-accent/30 transition-colors sticky top-0 bg-background z-10 border-b border-border/40"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-muted-foreground w-3">
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
        <StatusIcon status={status} size="sm" />
        <span className="text-xs font-medium text-foreground/80">{meta.label}</span>
        <span className="text-xs text-muted-foreground">{clashes.length}</span>
        <div className="flex-1" />
        <button
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <Plus className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>

      {/* Rows */}
      {!collapsed && (
        <div>
          {clashes.map((clash) => (
            <IssueRow
              key={clash.guid}
              clash={clash}
              selected={selectedGuid === clash.guid}
              onClick={() => onSelectClash(clash.guid)}
              onStatusChange={(s) => onStatusChange?.(clash.guid, s)}
              onPriorityChange={(p) => onPriorityChange?.(clash.guid, p)}
              displayOptions={displayOptions}
            />
          ))}
        </div>
      )}
    </div>
  );
}
