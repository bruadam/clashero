"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useMemo, useCallback, useEffect } from "react";
import type { Clash, ClashStatus, ClashPriority } from "@/lib/types";
import { STATUS_ORDER } from "@/lib/types";
import { ClashDetail } from "@/components/clash-detail";

export default function ClashPage() {
  const { id: guid } = useParams<{ id: string }>();
  const router = useRouter();

  const [clash, setClash] = useState<Clash | null>(null);
  const [allClashes, setAllClashes] = useState<Clash[]>([]);
  const [loading, setLoading] = useState(true);

  // Load the target clash + all clashes (for prev/next navigation)
  useEffect(() => {
    Promise.all([
      fetch(`/api/clashes/${guid}`).then((r) => r.ok ? r.json() as Promise<Clash> : null),
      fetch("/api/clashes").then((r) => r.json() as Promise<{ clashes: Clash[] }>),
    ]).then(([single, all]) => {
      setClash(single);
      setAllClashes(all.clashes ?? []);
    }).finally(() => setLoading(false));
  }, [guid]);

  const flatList = useMemo(
    () => STATUS_ORDER.flatMap((s) => allClashes.filter((c) => c.status === s)),
    [allClashes]
  );

  const index = useMemo(
    () => flatList.findIndex((c) => c.guid === guid),
    [flatList, guid]
  );

  const goPrev = useCallback(() => {
    if (flatList.length === 0) return;
    const prev = (index - 1 + flatList.length) % flatList.length;
    router.push(`/clash/${flatList[prev].guid}`);
  }, [flatList, index, router]);

  const goNext = useCallback(() => {
    if (flatList.length === 0) return;
    const next = (index + 1) % flatList.length;
    router.push(`/clash/${flatList[next].guid}`);
  }, [flatList, index, router]);

  const persistPatch = useCallback(async (patch: Partial<Clash>) => {
    await fetch(`/api/clashes/${guid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setClash((prev) => prev ? { ...prev, ...patch } : prev);
    setAllClashes((prev) => prev.map((c) => c.guid === guid ? { ...c, ...patch } : c));
  }, [guid]);

  const onStatusChange = useCallback((status: ClashStatus) => persistPatch({ status }), [persistPatch]);
  const onPriorityChange = useCallback((priority: ClashPriority) => persistPatch({ priority }), [persistPatch]);
  const onAssigneeChange = useCallback((assignee: string) => persistPatch({ assignee }), [persistPatch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (!clash) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">
        Clash not found.
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background">
      <ClashDetail
        clash={clash}
        index={index}
        total={flatList.length}
        onClose={() => router.push("/")}
        onPrev={goPrev}
        onNext={goNext}
        onStatusChange={onStatusChange}
        onPriorityChange={onPriorityChange}
        onAssigneeChange={onAssigneeChange}
      />
    </div>
  );
}
