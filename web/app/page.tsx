"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { DUMMY_CLASHES, STATUS_ORDER } from "@/lib/dummy-clashes";
import type { Clash, ClashStatus } from "@/lib/types";
import { Topbar } from "@/components/topbar";
import { IssueGroup } from "@/components/issue-group";
import { ClashDetail } from "@/components/clash-detail";
import { IfcViewer } from "@/components/ifc-viewer";
import { ScrollArea } from "@/components/ui/scroll-area";

type Tab = "all" | "active" | "by-rule" | "overview";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);

  const selectedClash = useMemo(
    () => DUMMY_CLASHES.find((c) => c.guid === selectedGuid) ?? null,
    [selectedGuid]
  );

  const filteredClashes = useMemo(() => {
    if (activeTab === "active") {
      return DUMMY_CLASHES.filter((c) => c.status === "open" || c.status === "in_progress");
    }
    return DUMMY_CLASHES;
  }, [activeTab]);

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

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedGuid(null);
      if (e.key === "ArrowDown" && !selectedGuid) setSelectedGuid(flatList[0]?.guid ?? null);
      if (e.key === "ArrowDown" && selectedGuid) goNext();
      if (e.key === "ArrowUp" && selectedGuid) goPrev();
      if (e.key === "ArrowRight" && selectedGuid) goNext();
      if (e.key === "ArrowLeft" && selectedGuid) goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedGuid, flatList, goNext, goPrev]);

  const totalVisible = filteredClashes.filter(
    (c) => c.status !== "closed" && c.status !== "resolved"
  ).length;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <Topbar activeTab={activeTab} onTabChange={(t) => setActiveTab(t as Tab)} />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* 3D Viewer */}
        <div className="flex-1 min-w-0 relative">
          <IfcViewer
            selectedClash={selectedClash}
            clashes={DUMMY_CLASHES}
          />
        </div>

        {/* Right panel: issue list + detail */}
        <div className="w-[420px] shrink-0 flex flex-col border-l border-border overflow-hidden">
          {selectedClash ? (
            <ClashDetail
              clash={selectedClash}
              index={selectedIndex}
              total={flatList.length}
              onClose={() => setSelectedGuid(null)}
              onPrev={goPrev}
              onNext={goNext}
            />
          ) : (
            <>
              {/* List header */}
              <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2">
                <h2 className="text-xs font-medium text-muted-foreground">
                  {activeTab === "all" ? "All Issues" : activeTab === "active" ? "Active" : activeTab === "by-rule" ? "By Rule" : "Overview"}
                </h2>
                <span className="text-xs text-muted-foreground ml-1">
                  {filteredClashes.length}
                </span>
              </div>

              <ScrollArea className="flex-1">
                {activeTab === "by-rule" ? (
                  Object.entries(groupedByRule).map(([ruleId, clashes]) => (
                    <div key={ruleId} className="mb-0.5">
                      <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/40 bg-background sticky top-0 z-10">
                        {ruleId} <span className="ml-1 text-muted-foreground/60">{clashes.length}</span>
                      </div>
                      {clashes.map((clash) => (
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
                ) : (
                  STATUS_ORDER.map((status) =>
                    groupedByStatus[status] ? (
                      <IssueGroup
                        key={status}
                        status={status}
                        clashes={groupedByStatus[status]!}
                        selectedGuid={selectedGuid}
                        onSelectClash={setSelectedGuid}
                      />
                    ) : null
                  )
                )}
              </ScrollArea>

              {/* Status bar */}
              <div className="px-4 py-1.5 border-t border-border text-[11px] text-muted-foreground shrink-0 flex items-center gap-2">
                <span>models/: 7 files</span>
                <span>·</span>
                <span>data/: {DUMMY_CLASHES.length} clashes</span>
                <span>·</span>
                <span className="text-amber-500">{totalVisible} active</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
