"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { STATUS_ORDER } from "@/lib/dummy-clashes";
import type { Clash, ClashStatus, ClashPriority } from "@/lib/types";
import { PRIORITY_META } from "@/lib/types";
import { Topbar } from "@/components/topbar";
import { IssueGroup } from "@/components/issue-group";
import { ClashDetail } from "@/components/clash-detail";
import { IfcViewer } from "@/components/ifc-viewer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/components/theme-provider";
import {
  DisplayOptionsPanel,
  DEFAULT_DISPLAY_OPTIONS,
} from "@/components/display-options-panel";
import type { DisplayOptions } from "@/components/display-options-panel";
import { IssueRow } from "@/components/issue-row";
import { SlidersHorizontal, Upload, Layers, Download } from "lucide-react";
import { parseBcf } from "@/lib/bcf-parser";
import { exportBcf, downloadBcf } from "@/lib/bcf-exporter";
import { ModelManager } from "@/components/model-manager";
import type { IfcModelEntry } from "@/components/model-manager";
import { BcfCreateDialog } from "@/components/bcf-create-dialog";
import type { BcfSelectedElement } from "@/components/bcf-create-dialog";
import type { ClashViewpoint } from "@/lib/types";
import { BubbleContextMenu } from "@/components/bubble-context-menu";

type Tab = "all" | "active" | "by-rule" | "overview";
type FocusMode = "split" | "viewer" | "list";

// Inline SVG icons to avoid extra dependencies
function IconExpand({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
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
    <div className="px-2">
      <div
        className="flex items-center gap-1.5 pl-3 pr-4 py-[5px] cursor-pointer hover:bg-accent/20 transition-colors sticky top-0 bg-background/95 backdrop-blur-sm z-10"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="text-muted-foreground/40 w-3 flex items-center">
          {collapsed ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M4 2l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 4l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <span className="text-[11px] font-semibold text-foreground/70 tracking-tight">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground/50 font-medium">
          {clashes.length}
        </span>
      </div>
      <div className="mx-3 h-px rounded-full bg-primary/15" />
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
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
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
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [focusMode, setFocusMode] = useState<FocusMode>("split");
  const [listWidth, setListWidth] = useState(420);
  const [detailWidth, setDetailWidth] = useState(320);
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>(
    DEFAULT_DISPLAY_OPTIONS,
  );
  const [showDisplayPanel, setShowDisplayPanel] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showModelManager, setShowModelManager] = useState(false);
  const [ifcModels, setIfcModels] = useState<IfcModelEntry[]>([]);
  const [bcfCreatePending, setBcfCreatePending] = useState<{ elements: BcfSelectedElement[]; viewpoint: ClashViewpoint } | null>(null);
  const [bubbleCtxMenu, setBubbleCtxMenu] = useState<{ clash: Clash; x: number; y: number } | null>(null);
  const bcfInputRef = useRef<HTMLInputElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(420);
  const isDetailDraggingRef = useRef(false);
  const detailStartXRef = useRef(0);
  const detailStartWidthRef = useRef(320);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  // Load clashes from BCF (falls back to dummy data when report.bcf is absent)
  useEffect(() => {
    fetch("/api/clashes")
      .then((r) => r.json())
      .then((data: { clashes: Clash[] }) => setClashes(data.clashes))
      .catch(() => {
        /* silently keep empty list */
      });
  }, []);

  const selectedClash = useMemo(
    () => clashes.find((c) => c.guid === selectedGuid) ?? null,
    [selectedGuid, clashes],
  );

  const filteredClashes = useMemo(() => {
    let result = clashes;
    if (activeTab === "active") {
      result = result.filter(
        (c) => c.status === "open" || c.status === "in_progress",
      );
    }
    // Apply ordering
    const { orderBy, orderDesc } = displayOptions;
    const PRIORITY_ORDER: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
      none: 4,
    };
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (orderBy === "priority")
        cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      else if (orderBy === "status")
        cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      else if (orderBy === "created")
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
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
    const PRIORITY_ORDER_LIST = [
      "urgent",
      "high",
      "medium",
      "low",
      "none",
    ] as const;
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
    [groupedByStatus],
  );

  const selectedIndex = useMemo(
    () =>
      selectedGuid ? flatList.findIndex((c) => c.guid === selectedGuid) : -1,
    [selectedGuid, flatList],
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
      }).catch(() => {
        /* fire-and-forget */
      });
    },
    [],
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
            postActivity(guid, "assignee_change", "assignee", current.assignee ?? "", patch.assignee ?? "");
          }
        }
        return prev.map((c) => (c.guid === guid ? { ...c, ...patch } : c));
      });
      // Persist to DB
      fetch(`/api/clashes/${guid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => { /* fire-and-forget */ });
    },
    [postActivity],
  );

  const handleBcfImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsImporting(true);
      try {
        const buffer = await file.arrayBuffer();
        const imported = await parseBcf(buffer);

        // Fetch current guids fresh to avoid stale closure
        const currentRes = await fetch("/api/clashes");
        const currentData = await currentRes.json() as { clashes: Clash[] };
        const existingGuids = new Set(currentData.clashes.map((c: Clash) => c.guid));
        const newClashes = imported.filter((c) => !existingGuids.has(c.guid));

        // POST each new clash to persist in DB — the API assigns sequential IDs
        const saved: Clash[] = [];
        for (const clash of newClashes) {
          const res = await fetch("/api/clashes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(clash),
          });
          if (res.ok) saved.push(await res.json() as Clash);
        }

        if (saved.length > 0) {
          setClashes((prev) => [...prev, ...saved]);
        }
      } catch (err) {
        console.error("BCF import failed:", err);
      } finally {
        setIsImporting(false);
        e.target.value = "";
      }
    },
    [],
  );

  const handleBcfExportAll = useCallback(async () => {
    const blob = await exportBcf(clashes);
    downloadBcf(blob, "clashero-export.bcf");
  }, [clashes]);

  const handleBcfIssueCreated = useCallback(async (clash: Clash) => {
    const res = await fetch("/api/clashes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clash),
    });
    if (res.ok) {
      const saved = await res.json() as Clash;
      setClashes((prev) => [...prev, saved]);
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "Escape") setSelectedGuid(null);
      if (e.key === "d" || e.key === "D") toggleTheme();
      if (e.key === "ArrowDown" && !selectedGuid)
        setSelectedGuid(flatList[0]?.guid ?? null);
      if (e.key === "ArrowDown" && selectedGuid) goNext();
      if (e.key === "ArrowUp" && selectedGuid) goPrev();
      if (e.key === "ArrowRight" && selectedGuid) goNext();
      if (e.key === "ArrowLeft" && selectedGuid) goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedGuid, flatList, goNext, goPrev, toggleTheme]);

  // Resize drag — viewer/list divider
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = listWidth;

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = startXRef.current - ev.clientX;
        setListWidth(Math.max(120, startWidthRef.current + delta));
      };
      const onUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [listWidth],
  );

  // Resize drag — list/detail divider
  const onDetailResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDetailDraggingRef.current = true;
      detailStartXRef.current = e.clientX;
      detailStartWidthRef.current = detailWidth;

      const onMove = (ev: MouseEvent) => {
        if (!isDetailDraggingRef.current) return;
        const delta = detailStartXRef.current - ev.clientX;
        setDetailWidth(Math.max(120, detailStartWidthRef.current + delta));
      };
      const onUp = () => {
        isDetailDraggingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [detailWidth],
  );

  const totalVisible = filteredClashes.filter(
    (c) => c.status !== "closed" && c.status !== "resolved",
  ).length;

  const showViewer = focusMode !== "list";
  const showList = focusMode !== "viewer";

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <Topbar
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t as Tab)}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 3D Viewer */}
        {showViewer && (
          <div className="flex-1 min-w-0 relative">
            <IfcViewer
              selectedClash={selectedClash}
              clashes={clashes}
              theme={theme}
              models={ifcModels}
              onCreateBcfIssue={(elements, viewpoint) =>
                setBcfCreatePending({ elements, viewpoint })
              }
              onBubbleRightClick={(clash, x, y) => setBubbleCtxMenu({ clash, x, y })}
            />

            {bubbleCtxMenu && (
              <BubbleContextMenu
                clash={bubbleCtxMenu.clash}
                x={bubbleCtxMenu.x}
                y={bubbleCtxMenu.y}
                onClose={() => setBubbleCtxMenu(null)}
                onStatusChange={(guid, s) => updateClash(guid, { status: s })}
                onPriorityChange={(guid, p) => updateClash(guid, { priority: p })}
                onAssigneeChange={(guid, a) => updateClash(guid, { assignee: a || undefined })}
              />
            )}

            {/* Model Manager slide-in panel */}
            {showModelManager && (
              <div className="absolute top-0 left-0 bottom-0 w-72 z-30 bg-background border-r border-primary/15 shadow-xl flex flex-col">
                <ModelManager
                  onModelsChange={setIfcModels}
                  onClose={() => setShowModelManager(false)}
                />
              </div>
            )}

            {/* Viewer controls */}
            <div className="absolute top-3 left-3 z-20 flex items-center gap-1">
              <button
                onClick={() => setShowModelManager((v) => !v)}
                className={`p-1.5 rounded backdrop-blur-sm transition-colors text-[11px] flex items-center gap-1.5 ${showModelManager ? "bg-primary/20 text-foreground" : "bg-black/40 text-white/70 hover:text-white hover:bg-black/60"}`}
                title="Manage IFC models"
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="font-medium">Models</span>
              </button>
            </div>

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
            className="w-1 shrink-0 bg-primary/10 hover:bg-primary/30 cursor-col-resize transition-colors relative"
            onMouseDown={onResizeMouseDown}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Right panel: issue list + detail side by side */}
        {showList && (
          <div
            className="shrink-0 flex overflow-hidden relative before:absolute before:left-0 before:top-3 before:bottom-3 before:w-px before:rounded-full before:bg-primary/15"
            style={{ width: focusMode === "list" ? "100%" : listWidth }}
          >
            {/* Issue list — always visible, shrinks when detail is open */}
            <div className="flex flex-col overflow-hidden min-w-0" style={{ flex: selectedClash ? `0 0 ${listWidth - detailWidth}px` : "1 1 auto" }}>
              {/* List header */}
              <div className="px-3 py-2 shrink-0 flex items-center gap-2">
                <h2 className="text-[11px] font-semibold text-foreground/60 tracking-tight">
                  {activeTab === "all"
                    ? "All Issues"
                    : activeTab === "active"
                      ? "Active"
                      : activeTab === "by-rule"
                        ? "By Rule"
                        : "Overview"}
                </h2>
                <span className="text-[10px] text-muted-foreground/50 font-medium">
                  {filteredClashes.length}
                </span>
                <div className="flex-1" />
                {/* Display options toggle */}
                <div className="relative">
                  <button
                    ref={filterBtnRef}
                    onClick={() => setShowDisplayPanel((v) => !v)}
                    className={`p-1 rounded transition-colors ${showDisplayPanel ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                    title="Display options"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <DisplayOptionsPanel
                    open={showDisplayPanel}
                    options={displayOptions}
                    onChange={setDisplayOptions}
                    onClose={() => setShowDisplayPanel(false)}
                    anchorRef={filterBtnRef}
                  />
                </div>
                {/* Focus list toggle */}
                <button
                  onClick={() =>
                    setFocusMode(focusMode === "list" ? "split" : "list")
                  }
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title={
                    focusMode === "list"
                      ? "Split view"
                      : "Focus list (hide viewer)"
                  }
                >
                  {focusMode === "list" ? <IconCompress /> : <IconExpand />}
                </button>
              </div>
              <div className="mx-3 h-px rounded-full bg-primary/15 shrink-0" />

              <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  {activeTab === "by-rule"
                    ? Object.entries(groupedByRule).map(
                        ([ruleId, ruleClashes]) => (
                          <FlatGroup
                            key={ruleId}
                            label={ruleId}
                            clashes={ruleClashes}
                            selectedGuid={selectedGuid}
                            onSelectClash={setSelectedGuid}
                            onStatusChange={(guid, s) =>
                              updateClash(guid, { status: s })
                            }
                            onPriorityChange={(guid, p) =>
                              updateClash(guid, { priority: p })
                            }
                            displayOptions={displayOptions}
                          />
                        ),
                      )
                    : displayOptions.groupBy === "status"
                      ? STATUS_ORDER.map((status) =>
                          groupedByStatus[status] ? (
                            <IssueGroup
                              key={status}
                              status={status}
                              clashes={groupedByStatus[status]!}
                              selectedGuid={selectedGuid}
                              onSelectClash={setSelectedGuid}
                              onStatusChange={(guid, s) =>
                                updateClash(guid, { status: s })
                              }
                              onPriorityChange={(guid, p) =>
                                updateClash(guid, { priority: p })
                              }
                              displayOptions={displayOptions}
                            />
                          ) : null,
                        )
                      : displayOptions.groupBy === "priority"
                        ? (
                            [
                              "urgent",
                              "high",
                              "medium",
                              "low",
                              "none",
                            ] as const
                          ).map((p) =>
                            groupedByPriority[p] ? (
                              <FlatGroup
                                key={p}
                                label={PRIORITY_META[p].label}
                                clashes={groupedByPriority[p]!}
                                selectedGuid={selectedGuid}
                                onSelectClash={setSelectedGuid}
                                onStatusChange={(guid, s) =>
                                  updateClash(guid, { status: s })
                                }
                                onPriorityChange={(guid, p2) =>
                                  updateClash(guid, { priority: p2 })
                                }
                                displayOptions={displayOptions}
                              />
                            ) : null,
                          )
                        : displayOptions.groupBy === "rule"
                          ? Object.entries(groupedByRule).map(
                              ([ruleId, ruleClashes]) => (
                                <FlatGroup
                                  key={ruleId}
                                  label={ruleId}
                                  clashes={ruleClashes}
                                  selectedGuid={selectedGuid}
                                  onSelectClash={setSelectedGuid}
                                  onStatusChange={(guid, s) =>
                                    updateClash(guid, { status: s })
                                  }
                                  onPriorityChange={(guid, p) =>
                                    updateClash(guid, { priority: p })
                                  }
                                  displayOptions={displayOptions}
                                />
                              ),
                            )
                          : displayOptions.groupBy === "assignee"
                            ? Object.entries(groupedByAssignee).map(
                                ([assignee, assigneeClashes]) => (
                                  <FlatGroup
                                    key={assignee}
                                    label={assignee}
                                    clashes={assigneeClashes}
                                    selectedGuid={selectedGuid}
                                    onSelectClash={setSelectedGuid}
                                    onStatusChange={(guid, s) =>
                                      updateClash(guid, { status: s })
                                    }
                                    onPriorityChange={(guid, p) =>
                                      updateClash(guid, { priority: p })
                                    }
                                    displayOptions={displayOptions}
                                  />
                                ),
                              )
                            : displayOptions.groupBy === "model"
                              ? Object.entries(groupedByModel).map(
                                  ([model, modelClashes]) => (
                                    <FlatGroup
                                      key={model}
                                      label={model}
                                      clashes={modelClashes}
                                      selectedGuid={selectedGuid}
                                      onSelectClash={setSelectedGuid}
                                      onStatusChange={(guid, s) =>
                                        updateClash(guid, { status: s })
                                      }
                                      onPriorityChange={(guid, p) =>
                                        updateClash(guid, { priority: p })
                                      }
                                      displayOptions={displayOptions}
                                    />
                                  ),
                                )
                              : // No grouping — flat list
                                filteredClashes.map((clash) => (
                                  <IssueRow
                                    key={clash.guid}
                                    clash={clash}
                                    selected={selectedGuid === clash.guid}
                                    onClick={() =>
                                      setSelectedGuid(clash.guid)
                                    }
                                    onStatusChange={(s) =>
                                      updateClash(clash.guid, { status: s })
                                    }
                                    onPriorityChange={(p) =>
                                      updateClash(clash.guid, { priority: p })
                                    }
                                    displayOptions={displayOptions}
                                  />
                                ))}
                </ScrollArea>
              </div>

              {/* Import from BCF */}
              <input
                ref={bcfInputRef}
                type="file"
                accept=".bcf,.bcfzip"
                className="hidden"
                onChange={handleBcfImport}
              />
              <div className="mx-3 h-px rounded-full bg-primary/15 shrink-0" />
              <div className="px-3 py-2 shrink-0 flex gap-1.5">
                <button
                  onClick={() => bcfInputRef.current?.click()}
                  disabled={isImporting}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <Upload className="w-3 h-3" />
                  {isImporting ? "Importing…" : "Import BCF"}
                </button>
                <button
                  onClick={handleBcfExportAll}
                  disabled={clashes.length === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  title="Export all issues as BCF"
                >
                  <Download className="w-3 h-3" />
                  Export BCF
                </button>
              </div>

              <div className="mx-3 h-px rounded-full bg-primary/15 shrink-0" />
              {/* Status bar */}
              <div className="px-4 py-1.5 text-[11px] text-muted-foreground shrink-0 flex items-center gap-2">
                <span>
                  models/: {ifcModels.length > 0 ? ifcModels.length : 3} files
                </span>
                <span>·</span>
                <span>data/: {clashes.length} clashes</span>
                <span>·</span>
                <span className="text-amber-500">{totalVisible} active</span>
              </div>
            </div>

            {/* Detail panel — appears alongside list when an issue is selected */}
            {selectedClash && (
              <>
                <div
                  className="w-1 shrink-0 bg-primary/10 hover:bg-primary/30 cursor-col-resize transition-colors relative"
                  onMouseDown={onDetailResizeMouseDown}
                >
                  <div className="absolute inset-y-0 -left-1 -right-1" />
                </div>
                <div className="flex flex-col overflow-hidden min-w-0" style={{ width: detailWidth }}>
                  <ClashDetail
                    clash={selectedClash}
                    index={selectedIndex}
                    total={flatList.length}
                    onClose={() => setSelectedGuid(null)}
                    onPrev={goPrev}
                    onNext={goNext}
                    onStatusChange={(s) =>
                      updateClash(selectedClash.guid, { status: s })
                    }
                    onPriorityChange={(p) =>
                      updateClash(selectedClash.guid, { priority: p })
                    }
                    onAssigneeChange={(a) =>
                      updateClash(selectedClash.guid, { assignee: a })
                    }
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* BCF Create Issue dialog */}
      {bcfCreatePending && (
        <BcfCreateDialog
          selectedElements={bcfCreatePending.elements}
          viewpoint={bcfCreatePending.viewpoint}
          onClose={() => setBcfCreatePending(null)}
          onCreated={handleBcfIssueCreated}
        />
      )}
    </div>
  );
}
