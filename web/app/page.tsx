"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { DUMMY_CLASHES, STATUS_ORDER } from "@/lib/dummy-clashes";
import type { Clash, ClashStatus, ClashPriority } from "@/lib/types";
import { PRIORITY_META } from "@/lib/types";
import { Topbar } from "@/components/topbar";
import { IssueGroup } from "@/components/issue-group";
import { ClashDetail } from "@/components/clash-detail";
import { IfcViewer } from "@/components/ifc-viewer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/components/theme-provider";
import { DisplayOptionsPanel, DEFAULT_DISPLAY_OPTIONS } from "@/components/display-options-panel";
import type { DisplayOptions } from "@/components/display-options-panel";
import { IssueRow } from "@/components/issue-row";
import { SlidersHorizontal } from "lucide-react";

type Tab = "all" | "active" | "by-rule" | "overview";
type FocusMode = "split" | "viewer" | "list";

// Inline SVG icons to avoid extra dependencies
function IconExpand({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

// Generic collapsible group used for priority / rule / assignee groupings
function FlatGroup({
  label,
  clashes,
  selectedGuid,
  onSelectClash,
  onStatusChange,
  onPriorityChange,
  displayOptions,
}: {
  label: string;
  clashes: Clash[];
  selectedGuid: string | null;
  onSelectClash: (guid: string) => void;
  onStatusChange: (guid: string, status: ClashStatus) => void;
  onPriorityChange: (guid: string, priority: ClashPriority) => void;
  displayOptions: DisplayOptions;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="mb-0.5">
      <div
        className="flex items-center gap-2 px-4 py-1.5 cursor-pointer hover:bg-accent/30 transition-colors sticky top-0 bg-background z-10 border-b border-border/40"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="text-muted-foreground text-[10px]">{collapsed ? "▶" : "▼"}</span>
        <span className="text-xs font-medium text-foreground/80">{label}</span>
        <span className="text-xs text-muted-foreground">{clashes.length}</span>
      </div>
      {!collapsed &&
        clashes.map((clash) => (
          <IssueRow
            key={clash.guid}
            clash={clash}
            selected={selectedGuid === clash.guid}
            onClick={() => onSelectClash(clash.guid)}
            onStatusChange={(s) => onStatusChange(clash.guid, s)}
            onPriorityChange={(p) => onPriorityChange(clash.guid, p)}
            displayOptions={displayOptions}
          />
        ))}
    </div>
  );
}

function IconCompress({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [clashes, setClashes] = useState<Clash[]>(DUMMY_CLASHES);
  const [focusMode, setFocusMode] = useState<FocusMode>("split");
  const [listWidth, setListWidth] = useState(420);
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>(DEFAULT_DISPLAY_OPTIONS);
  const [showDisplayPanel, setShowDisplayPanel] = useState(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(420);
  const { toggle: toggleTheme } = useTheme();

  const selectedClash = useMemo(
    () => clashes.find((c) => c.guid === selectedGuid) ?? null,
    [selectedGuid, clashes]
  );

  const filteredClashes = useMemo(() => {
    let result = clashes;
    if (activeTab === "active") {
      result = result.filter((c) => c.status === "open" || c.status === "in_progress");
    }
    // Apply ordering
    const { orderBy, orderDesc } = displayOptions;
    const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (orderBy === "priority") cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      else if (orderBy === "status") cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      else if (orderBy === "created") cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (orderBy === "id") cmp = a.id.localeCompare(b.id);
      return orderDesc ? -cmp : cmp;
    });
    return result;
  }, [activeTab, clashes, displayOptions]);

  const groupedByStatus = useMemo(() => {
    const groups: Partial<Record<ClashStatus, Clash[]>> = {};
    STATUS_ORDER.forEach((status) => {
      const items = filteredClashes.filter((c) => c.status === status);
      if (items.length > 0) groups[status] = items;
    });
    return groups;
  }, [filteredClashes]);

  const groupedByRule = useMemo(() => {
    const groups: Record<string, Clash[]> = {};
    filteredClashes.forEach((c) => {
      if (!groups[c.ruleId]) groups[c.ruleId] = [];
      groups[c.ruleId].push(c);
    });
    return groups;
  }, [filteredClashes]);

  const groupedByPriority = useMemo(() => {
    const PRIORITY_ORDER_LIST = ["urgent", "high", "medium", "low", "none"] as const;
    const groups: Partial<Record<string, Clash[]>> = {};
    PRIORITY_ORDER_LIST.forEach((p) => {
      const items = filteredClashes.filter((c) => c.priority === p);
      if (items.length > 0) groups[p] = items;
    });
    return groups;
  }, [filteredClashes]);

  const groupedByAssignee = useMemo(() => {
    const groups: Record<string, Clash[]> = {};
    filteredClashes.forEach((c) => {
      const key = c.assignee ?? "Unassigned";
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    return groups;
  }, [filteredClashes]);

  const groupedByModel = useMemo(() => {
    const groups: Record<string, Clash[]> = {};
    filteredClashes.forEach((c) => {
      [c.fileA, c.fileB].forEach((file) => {
        if (!groups[file]) groups[file] = [];
        if (!groups[file].includes(c)) groups[file].push(c);
      });
    });
    return groups;
  }, [filteredClashes]);

  const flatList = useMemo(
    () => STATUS_ORDER.flatMap((s) => groupedByStatus[s] ?? []),
    [groupedByStatus]
  );

  const selectedIndex = useMemo(
    () => (selectedGuid ? flatList.findIndex((c) => c.guid === selectedGuid) : -1),
    [selectedGuid, flatList]
  );

  const goNext = useCallback(() => {
    if (flatList.length === 0) return;
    const next = (selectedIndex + 1) % flatList.length;
    setSelectedGuid(flatList[next].guid);
  }, [flatList, selectedIndex]);

  const goPrev = useCallback(() => {
    if (flatList.length === 0) return;
    const prev = (selectedIndex - 1 + flatList.length) % flatList.length;
    setSelectedGuid(flatList[prev].guid);
  }, [flatList, selectedIndex]);

  const postActivity = useCallback(
    (guid: string, type: string, field: string, from: string, to: string) => {
      fetch(`/api/clashes/${guid}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, field, from, to }),
      }).catch(() => {/* fire-and-forget */});
    },
    []
  );

  const updateClash = useCallback(
    (guid: string, patch: Partial<Clash>) => {
      setClashes((prev) => {
        const current = prev.find((c) => c.guid === guid);
        if (current) {
          if (patch.status && patch.status !== current.status) {
            postActivity(guid, "status_change", "status", current.status, patch.status);
          }
          if (patch.priority && patch.priority !== current.priority) {
            postActivity(guid, "priority_change", "priority", current.priority, patch.priority);
          }
          if ("assignee" in patch && patch.assignee !== current.assignee) {
            postActivity(
              guid,
              "assignee_change",
              "assignee",
              current.assignee ?? "",
              patch.assignee ?? ""
            );
          }
        }
        return prev.map((c) => (c.guid === guid ? { ...c, ...patch } : c));
      });
    },
    [postActivity]
  );

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "Escape") setSelectedGuid(null);
      if (e.key === "d" || e.key === "D") toggleTheme();
      if (e.key === "ArrowDown" && !selectedGuid) setSelectedGuid(flatList[0]?.guid ?? null);
      if (e.key === "ArrowDown" && selectedGuid) goNext();
      if (e.key === "ArrowUp" && selectedGuid) goPrev();
      if (e.key === "ArrowRight" && selectedGuid) goNext();
      if (e.key === "ArrowLeft" && selectedGuid) goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedGuid, flatList, goNext, goPrev, toggleTheme]);

  // Resize drag
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = listWidth;

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = startXRef.current - ev.clientX;
        const newWidth = Math.max(280, Math.min(700, startWidthRef.current + delta));
        setListWidth(newWidth);
      };
      const onUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [listWidth]
  );

  const totalVisible = filteredClashes.filter(
    (c) => c.status !== "closed" && c.status !== "resolved"
  ).length;

  const showViewer = focusMode !== "list";
  const showList = focusMode !== "viewer";

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <Topbar activeTab={activeTab} onTabChange={(t) => setActiveTab(t as Tab)} />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 3D Viewer */}
        {showViewer && (
          <div className="flex-1 min-w-0 relative">
            <IfcViewer selectedClash={selectedClash} clashes={clashes} />

            {/* Viewer focus controls */}
            <div className="absolute top-3 right-3 flex items-center gap-1 z-20">
              {focusMode === "viewer" ? (
                <button
                  onClick={() => setFocusMode("split")}
                  className="p-1.5 rounded bg-black/40 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/60 transition-colors"
                  title="Split view"
                >
                  <IconCompress />
                </button>
              ) : (
                <button
                  onClick={() => setFocusMode("viewer")}
                  className="p-1.5 rounded bg-black/40 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/60 transition-colors"
                  title="Focus viewer (hide list)"
                >
                  <IconExpand />
                </button>
              )}
            </div>

            {/* When viewer is focused, show restore button at bottom */}
            {focusMode === "viewer" && (
              <div className="absolute bottom-3 right-3 z-20">
                <button
                  onClick={() => setFocusMode("split")}
                  className="px-3 py-1.5 rounded bg-black/50 backdrop-blur-sm text-white/70 hover:text-white text-[11px] transition-colors"
                >
                  Show list
                </button>
              </div>
            )}
          </div>
        )}

        {/* Resize handle */}
        {showViewer && showList && (
          <div
            className="w-1 shrink-0 bg-border hover:bg-primary/40 cursor-col-resize transition-colors relative"
            onMouseDown={onResizeMouseDown}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Right panel: issue list + detail */}
        {showList && (
          <div
            className="shrink-0 flex flex-col border-l border-border overflow-hidden"
            style={{ width: focusMode === "list" ? "100%" : listWidth }}
          >
            {selectedClash ? (
              <ClashDetail
                clash={selectedClash}
                index={selectedIndex}
                total={flatList.length}
                onClose={() => setSelectedGuid(null)}
                onPrev={goPrev}
                onNext={goNext}
                onStatusChange={(s) => updateClash(selectedClash.guid, { status: s })}
                onPriorityChange={(p) => updateClash(selectedClash.guid, { priority: p })}
                onAssigneeChange={(a) => updateClash(selectedClash.guid, { assignee: a })}
              />
            ) : (
              <>
                {/* List header */}
                <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2">
                  <h2 className="text-xs font-medium text-muted-foreground">
                    {activeTab === "all"
                      ? "All Issues"
                      : activeTab === "active"
                      ? "Active"
                      : activeTab === "by-rule"
                      ? "By Rule"
                      : "Overview"}
                  </h2>
                  <span className="text-xs text-muted-foreground ml-1">{filteredClashes.length}</span>
                  <div className="flex-1" />
                  {/* Display options toggle */}
                  <button
                    onClick={() => setShowDisplayPanel((v) => !v)}
                    className={`p-1 rounded transition-colors ${showDisplayPanel ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                    title="Display options"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </button>
                  {/* Focus list toggle */}
                  <button
                    onClick={() => setFocusMode(focusMode === "list" ? "split" : "list")}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title={focusMode === "list" ? "Split view" : "Focus list (hide viewer)"}
                  >
                    {focusMode === "list" ? <IconCompress /> : <IconExpand />}
                  </button>
                </div>

                <div className="relative flex-1 overflow-hidden">
                  <ScrollArea className="h-full">
                    {activeTab === "by-rule" ? (
                      // Legacy "By Rule" tab keeps its own grouping
                      Object.entries(groupedByRule).map(([ruleId, ruleClashes]) => (
                        <div key={ruleId} className="mb-0.5">
                          <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/40 bg-background sticky top-0 z-10">
                            {ruleId}{" "}
                            <span className="ml-1 text-muted-foreground/60">{ruleClashes.length}</span>
                          </div>
                          {ruleClashes.map((clash) => (
                            <button
                              key={clash.guid}
                              onClick={() => setSelectedGuid(clash.guid)}
                              className="w-full flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-accent/40 border-b border-border/40 text-left"
                            >
                              <span className="text-muted-foreground font-mono w-14">{clash.id}</span>
                              <span className="flex-1 truncate">{clash.title}</span>
                            </button>
                          ))}
                        </div>
                      ))
                    ) : displayOptions.groupBy === "status" ? (
                      STATUS_ORDER.map((status) =>
                        groupedByStatus[status] ? (
                          <IssueGroup
                            key={status}
                            status={status}
                            clashes={groupedByStatus[status]!}
                            selectedGuid={selectedGuid}
                            onSelectClash={setSelectedGuid}
                            onStatusChange={(guid, s) => updateClash(guid, { status: s })}
                            onPriorityChange={(guid, p) => updateClash(guid, { priority: p })}
                            displayOptions={displayOptions}
                          />
                        ) : null
                      )
                    ) : displayOptions.groupBy === "priority" ? (
                      (["urgent", "high", "medium", "low", "none"] as const).map((p) =>
                        groupedByPriority[p] ? (
                          <FlatGroup
                            key={p}
                            label={PRIORITY_META[p].label}
                            clashes={groupedByPriority[p]!}
                            selectedGuid={selectedGuid}
                            onSelectClash={setSelectedGuid}
                            onStatusChange={(guid, s) => updateClash(guid, { status: s })}
                            onPriorityChange={(guid, p2) => updateClash(guid, { priority: p2 })}
                            displayOptions={displayOptions}
                          />
                        ) : null
                      )
                    ) : displayOptions.groupBy === "rule" ? (
                      Object.entries(groupedByRule).map(([ruleId, ruleClashes]) => (
                        <FlatGroup
                          key={ruleId}
                          label={ruleId}
                          clashes={ruleClashes}
                          selectedGuid={selectedGuid}
                          onSelectClash={setSelectedGuid}
                          onStatusChange={(guid, s) => updateClash(guid, { status: s })}
                          onPriorityChange={(guid, p) => updateClash(guid, { priority: p })}
                          displayOptions={displayOptions}
                        />
                      ))
                    ) : displayOptions.groupBy === "assignee" ? (
                      Object.entries(groupedByAssignee).map(([assignee, assigneeClashes]) => (
                        <FlatGroup
                          key={assignee}
                          label={assignee}
                          clashes={assigneeClashes}
                          selectedGuid={selectedGuid}
                          onSelectClash={setSelectedGuid}
                          onStatusChange={(guid, s) => updateClash(guid, { status: s })}
                          onPriorityChange={(guid, p) => updateClash(guid, { priority: p })}
                          displayOptions={displayOptions}
                        />
                      ))
                    ) : displayOptions.groupBy === "model" ? (
                      Object.entries(groupedByModel).map(([model, modelClashes]) => (
                        <FlatGroup
                          key={model}
                          label={model}
                          clashes={modelClashes}
                          selectedGuid={selectedGuid}
                          onSelectClash={setSelectedGuid}
                          onStatusChange={(guid, s) => updateClash(guid, { status: s })}
                          onPriorityChange={(guid, p) => updateClash(guid, { priority: p })}
                          displayOptions={displayOptions}
                        />
                      ))
                    ) : (
                      // No grouping — flat list
                      filteredClashes.map((clash) => (
                        <IssueRow
                          key={clash.guid}
                          clash={clash}
                          selected={selectedGuid === clash.guid}
                          onClick={() => setSelectedGuid(clash.guid)}
                          onStatusChange={(s) => updateClash(clash.guid, { status: s })}
                          onPriorityChange={(p) => updateClash(clash.guid, { priority: p })}
                          displayOptions={displayOptions}
                        />
                      ))
                    )}
                  </ScrollArea>

                  {/* Display options panel overlay */}
                  <DisplayOptionsPanel
                    open={showDisplayPanel}
                    options={displayOptions}
                    onChange={setDisplayOptions}
                    onClose={() => setShowDisplayPanel(false)}
                  />
                </div>

                {/* Status bar */}
                <div className="px-4 py-1.5 border-t border-border text-[11px] text-muted-foreground shrink-0 flex items-center gap-2">
                  <span>models/: 7 files</span>
                  <span>·</span>
                  <span>data/: {clashes.length} clashes</span>
                  <span>·</span>
                  <span className="text-amber-500">{totalVisible} active</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
