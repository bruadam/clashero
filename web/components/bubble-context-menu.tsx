"use client";

import { useEffect, useRef } from "react";
import type { Clash, ClashStatus, ClashPriority } from "@/lib/types";
import { STATUS_META, PRIORITY_META, STATUS_ORDER } from "@/lib/types";

const PRIORITIES: ClashPriority[] = ["urgent", "high", "medium", "low", "none"];
const TEAM_MEMBERS = ["michael.wk", "sarah.j", "tom.b", "anna.k", "unassigned"];

interface BubbleContextMenuProps {
  clash: Clash;
  x: number;
  y: number;
  onClose: () => void;
  onStatusChange: (guid: string, status: ClashStatus) => void;
  onPriorityChange: (guid: string, priority: ClashPriority) => void;
  onAssigneeChange: (guid: string, assignee: string) => void;
}

export function BubbleContextMenu({
  clash,
  x,
  y,
  onClose,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
}: BubbleContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Clamp to viewport so menu doesn't overflow
  const menuWidth = 200;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = y;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] rounded-md border bg-popover text-popover-foreground shadow-md py-1 text-xs"
      style={{ left, top }}
    >
      {/* Clash identifier */}
      <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/60 tracking-wide uppercase select-none">
        {clash.id}
      </div>

      {/* Status submenu */}
      <Submenu label="Status" currentLabel={STATUS_META[clash.status].label}>
        {STATUS_ORDER.map((s) => (
          <MenuItem
            key={s}
            active={clash.status === s}
            onClick={() => { onStatusChange(clash.guid, s); onClose(); }}
          >
            <span style={{ color: STATUS_META[s].color }} className="font-mono w-3 text-center shrink-0">
              {STATUS_META[s].icon}
            </span>
            {STATUS_META[s].label}
          </MenuItem>
        ))}
      </Submenu>

      {/* Priority submenu */}
      <Submenu label="Priority" currentLabel={PRIORITY_META[clash.priority].label}>
        {PRIORITIES.map((p) => (
          <MenuItem
            key={p}
            active={clash.priority === p}
            onClick={() => { onPriorityChange(clash.guid, p); onClose(); }}
          >
            <span style={{ color: PRIORITY_META[p].color }} className="font-mono w-3 text-center shrink-0">
              {PRIORITY_META[p].icon}
            </span>
            {PRIORITY_META[p].label}
          </MenuItem>
        ))}
      </Submenu>

      {/* Assignee submenu */}
      <Submenu label="Assignee" currentLabel={clash.assignee || "Unassigned"}>
        {TEAM_MEMBERS.map((member) => {
          const isUnassigned = member === "unassigned";
          const active = isUnassigned ? !clash.assignee : clash.assignee === member;
          return (
            <MenuItem
              key={member}
              active={active}
              onClick={() => {
                onAssigneeChange(clash.guid, isUnassigned ? "" : member);
                onClose();
              }}
            >
              <span className="w-5 h-5 rounded-full bg-accent border border-border flex items-center justify-center text-[9px] font-semibold shrink-0">
                {isUnassigned ? "–" : member[0].toUpperCase()}
              </span>
              {isUnassigned ? "Unassigned" : member}
            </MenuItem>
          );
        })}
      </Submenu>
    </div>
  );
}

// ── Internal sub-components ───────────────────────────────────────────────────

function Submenu({
  label,
  currentLabel,
  children,
}: {
  label: string;
  currentLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative">
      <button className="w-full flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-accent/60 transition-colors text-left select-none">
        <span className="text-muted-foreground/70">{label}</span>
        <span className="text-foreground/50 truncate max-w-[90px] text-right">{currentLabel}</span>
        <span className="text-muted-foreground/40 shrink-0">›</span>
      </button>
      <div className="hidden group-hover:block absolute left-full top-0 min-w-[160px] rounded-md border bg-popover shadow-md py-1 z-50">
        {children}
      </div>
    </div>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent/60 transition-colors text-left select-none ${active ? "text-foreground" : "text-foreground/70"}`}
    >
      {active && <span className="text-primary shrink-0">✓</span>}
      {!active && <span className="w-3 shrink-0" />}
      {children}
    </button>
  );
}
