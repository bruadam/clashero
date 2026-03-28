"use client";

import { useEffect, useRef } from "react";
import { X, ArrowDownUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type GroupBy = "status" | "priority" | "rule" | "assignee" | "model" | "none";
export type OrderBy = "priority" | "status" | "created" | "id";
export type DisplayProp =
  | "id"
  | "status"
  | "priority"
  | "assignee"
  | "rule"
  | "created"
  | "labels"
  | "fileA"
  | "fileB";

export interface DisplayOptions {
  groupBy: GroupBy;
  orderBy: OrderBy;
  orderDesc: boolean;
  showProperties: Set<DisplayProp>;
}

export const DEFAULT_DISPLAY_OPTIONS: DisplayOptions = {
  groupBy: "status",
  orderBy: "priority",
  orderDesc: false,
  showProperties: new Set(["id", "status", "priority", "rule", "created"]),
};

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "rule", label: "Rule" },
  { value: "assignee", label: "Assignee" },
  { value: "model", label: "Model" },
  { value: "none", label: "No grouping" },
];

const ORDER_OPTIONS: { value: OrderBy; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "created", label: "Created date" },
  { value: "id", label: "ID" },
];

const DISPLAY_PROPS: { value: DisplayProp; label: string }[] = [
  { value: "id", label: "ID" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "rule", label: "Rule" },
  { value: "created", label: "Created" },
  { value: "labels", label: "Labels" },
  { value: "fileA", label: "File A" },
  { value: "fileB", label: "File B" },
];

interface DisplayOptionsPanelProps {
  open: boolean;
  options: DisplayOptions;
  onChange: (options: DisplayOptions) => void;
  onClose: () => void;
}

export function DisplayOptionsPanel({ open, options, onChange, onClose }: DisplayOptionsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately on the trigger click
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  function setGroupBy(groupBy: GroupBy) {
    onChange({ ...options, groupBy });
  }

  function setOrderBy(orderBy: OrderBy) {
    onChange({ ...options, orderBy });
  }

  function toggleOrderDir() {
    onChange({ ...options, orderDesc: !options.orderDesc });
  }

  function toggleProp(prop: DisplayProp) {
    const next = new Set(options.showProperties);
    if (next.has(prop)) {
      next.delete(prop);
    } else {
      next.add(prop);
    }
    onChange({ ...options, showProperties: next });
  }

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute top-0 right-0 bottom-0 z-30 w-72 bg-background border-l border-border shadow-xl flex flex-col overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-foreground">Display options</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-0 text-xs">
        {/* Grouping */}
        <Row label="Grouping">
          <Select
            value={options.groupBy}
            options={GROUP_OPTIONS}
            onChange={(v) => setGroupBy(v as GroupBy)}
          />
        </Row>

        {/* Ordering */}
        <Row label="Ordering">
          <div className="flex items-center gap-1">
            <button
              onClick={toggleOrderDir}
              className={cn(
                "p-1 rounded transition-colors",
                options.orderDesc
                  ? "text-foreground bg-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              title={options.orderDesc ? "Descending" : "Ascending"}
            >
              <ArrowDownUp className="w-3 h-3" />
            </button>
            <Select
              value={options.orderBy}
              options={ORDER_OPTIONS}
              onChange={(v) => setOrderBy(v as OrderBy)}
            />
          </div>
        </Row>

        <div className="border-t border-border/60 mx-4 my-1" />

        {/* Display properties */}
        <div className="px-4 pt-2 pb-1">
          <span className="text-[11px] text-muted-foreground font-medium">Display properties</span>
        </div>
        <div className="px-4 pb-4 flex flex-wrap gap-1.5">
          {DISPLAY_PROPS.map((prop) => {
            const active = options.showProperties.has(prop.value);
            return (
              <button
                key={prop.value}
                onClick={() => toggleProp(prop.value)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                  active
                    ? "bg-foreground/10 border-foreground/20 text-foreground"
                    : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {prop.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none bg-accent/60 border border-border/60 rounded px-2.5 py-1 pr-6 text-xs text-foreground cursor-pointer hover:bg-accent transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">
        ▾
      </span>
    </div>
  );
}
