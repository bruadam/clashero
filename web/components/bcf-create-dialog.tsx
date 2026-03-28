"use client";

import { useState } from "react";
import { X, FileCheck } from "lucide-react";
import type { Clash, ClashPriority, ClashViewpoint } from "@/lib/types";
import { PRIORITY_META } from "@/lib/types";

export interface BcfSelectedElement {
  globalId: string;
  modelFilename: string;
  ifcType?: string;
  name?: string | null;
}

interface BcfCreateDialogProps {
  selectedElements: BcfSelectedElement[];
  viewpoint: ClashViewpoint;
  onClose: () => void;
  onCreated: (clash: Clash) => void;
}

const PRIORITIES: ClashPriority[] = ["urgent", "high", "medium", "low", "none"];

function randomGuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function BcfCreateDialog({
  selectedElements,
  viewpoint,
  onClose,
  onCreated,
}: BcfCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<ClashPriority>("medium");

  const elementA = selectedElements[0];
  const elementB = selectedElements[1];

  const handleCreate = () => {
    if (!title.trim()) return;

    const guid = randomGuid();
    const now = new Date().toISOString();

    // Derive a rule id from the two model files
    const stem = (f?: string) => {
      if (!f) return "";
      return f.replace(/\.ifc$/i, "").split(/[_\-.]/).pop()?.toUpperCase() ?? f.toUpperCase();
    };
    const stemA = stem(elementA?.modelFilename);
    const stemB = stem(elementB?.modelFilename);
    const ruleId = stemA && stemB && stemA !== stemB
      ? `${stemA}×${stemB}`
      : stemA || stemB || "MANUAL";

    // Midpoint: use target from current viewpoint
    const midpoint: [number, number, number] = [...viewpoint.target];

    const clash: Clash = {
      guid,
      id: `CLH-${Date.now().toString(36).toUpperCase()}`,
      title: title.trim(),
      description: description.trim(),
      status: "open",
      priority,
      ruleId,
      ifcGuidA: elementA?.globalId ?? "",
      ifcGuidB: elementB?.globalId ?? "",
      fileA: elementA?.modelFilename ?? "",
      fileB: elementB?.modelFilename ?? "",
      midpoint,
      viewpoint,
      labels: [],
      createdAt: now,
    };

    onCreated(clash);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <FileCheck className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground flex-1">Create BCF Issue</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4">
          {/* Selected elements */}
          {selectedElements.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-border/50">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Selected Elements ({selectedElements.length})
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {selectedElements.map((el, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: i === 0 ? "#ff3b30" : "#007aff" }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-foreground/80 truncate font-mono">
                        {el.globalId || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 truncate">
                        {el.modelFilename}{el.name ? ` · ${el.name}` : ""}
                        {el.ifcType ? ` (${el.ifcType})` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              placeholder="Describe the issue…"
              className="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm
                placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context…"
              rows={3}
              className="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm
                placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Priority */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Priority
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {PRIORITIES.map((p) => {
                const meta = PRIORITY_META[p];
                return (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${
                      priority === p
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-muted/10 text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <span className="font-mono text-[10px]" style={{ color: meta.color }}>
                      {meta.icon}
                    </span>
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Viewpoint info */}
          <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
            <p className="text-[10px] text-muted-foreground/60">
              <span className="font-semibold">Viewpoint captured</span> · camera at{" "}
              {viewpoint.cameraPosition.map((v) => v.toFixed(1)).join(", ")}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim()}
            className="px-4 py-1.5 rounded text-xs bg-primary text-primary-foreground
              hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create Issue
          </button>
        </div>
      </div>
    </div>
  );
}
