"use client";

import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { Clash } from "@/lib/types";
import { STATUS_META, PRIORITY_META } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface ClashDetailProps {
  clash: Clash;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function ClashDetail({ clash, index, total, onClose, onPrev, onNext }: ClashDetailProps) {
  const status = STATUS_META[clash.status];
  const priority = PRIORITY_META[clash.priority];

  return (
    <div className="flex flex-col h-full border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
        <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <span className="text-xs text-muted-foreground">{clash.id}</span>
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
          <p className="text-xs text-muted-foreground">Sub-issue of rule › <span className="text-foreground">{clash.ruleId}</span></p>

          {/* Description */}
          <p className="text-sm text-foreground/80 leading-relaxed">{clash.description}</p>

          <Separator />

          {/* Properties */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Properties</h3>

            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
              <span className="text-muted-foreground">Status</span>
              <span className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full border-2"
                  style={{ borderColor: status.color, backgroundColor: ["resolved","closed"].includes(clash.status) ? status.color : "transparent" }}
                />
                {status.label}
              </span>

              <span className="text-muted-foreground">Priority</span>
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[10px]" style={{ color: priority.color }}>{priority.icon}</span>
                {priority.label}
              </span>

              {clash.assignee && (
                <>
                  <span className="text-muted-foreground">Assignee</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-medium">
                      {clash.assignee[0].toUpperCase()}
                    </span>
                    {clash.assignee}
                  </span>
                </>
              )}

              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(clash.createdAt)}</span>
            </div>
          </div>

          {clash.labels.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Labels</h3>
                <div className="flex flex-wrap gap-1">
                  {clash.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-[10px] py-0 px-1.5">{label}</Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Source files */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source Files</h3>
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
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">IFC GUIDs</h3>
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

          {/* Activity */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Activity</h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                <span>clash/ engine detected · {formatDate(clash.createdAt)}</span>
              </div>
              {clash.status !== "open" && (
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                  <span>moved to {STATUS_META[clash.status].label}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
