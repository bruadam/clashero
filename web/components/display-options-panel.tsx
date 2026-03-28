"use client";

import { useEffect, useRef } from "react";
import { ArrowDownUp } from "lucide-react";
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
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function DisplayOptionsPanel({ open, options, onChange, onClose, anchorRef }: DisplayOptionsPanelProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !(anchorRef?.current?.contains(e.target as Node))
      ) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose, anchorRef]);

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
      ref={menuRef}
      className="absolute top-8 right-0 z-50 w-64 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
    >
      <div className="flex flex-col gap-0 text-xs py-1">
        {/* Grouping */}
        <Row label="Group by">
          <Select
            value={options.groupBy}
            options={GROUP_OPTIONS}
            onChange={(v) => setGroupBy(v as GroupBy)}
          />
        </Row>

        {/* Ordering */}
        <Row label="Order by">
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

        <div className="border-t border-border/60 mx-2 my-1" />

        {/* Display properties */}
        <div className="px-3 pt-1 pb-0.5">
          <span className="text-[11px] text-muted-foreground font-medium">Properties</span>
        </div>
        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
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
    <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 last:border-0">
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
