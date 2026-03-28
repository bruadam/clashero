"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Clash, ClashStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { IssueRow } from "./issue-row";

interface IssueGroupProps {
  status: ClashStatus;
  clashes: Clash[];
  selectedGuid: string | null;
  onSelectClash: (guid: string) => void;
}

export function IssueGroup({ status, clashes, selectedGuid, onSelectClash }: IssueGroupProps) {
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
        <span
          className="w-2.5 h-2.5 rounded-full border-2 shrink-0"
          style={{
            borderColor: meta.color,
            backgroundColor:
              status === "resolved" || status === "closed" ? meta.color : "transparent",
          }}
        />
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
