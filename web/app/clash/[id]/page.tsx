"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useMemo, useCallback } from "react";
import { DUMMY_CLASHES } from "@/lib/dummy-clashes";
import type { Clash, ClashStatus } from "@/lib/types";
import { STATUS_ORDER } from "@/lib/types";
import { ClashDetail } from "@/components/clash-detail";

export default function ClashPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [clashes, setClashes] = useState<Clash[]>(DUMMY_CLASHES);

  const flatList = useMemo(
    () => STATUS_ORDER.flatMap((s) => clashes.filter((c) => c.status === s)),
    [clashes]
  );

  const clash = useMemo(() => clashes.find((c) => c.id === id) ?? null, [clashes, id]);
  const index = useMemo(() => flatList.findIndex((c) => c.id === id), [flatList, id]);

  const goPrev = useCallback(() => {
    if (flatList.length === 0) return;
    const prev = (index - 1 + flatList.length) % flatList.length;
    router.push(`/clash/${flatList[prev].id}`);
  }, [flatList, index, router]);

  const goNext = useCallback(() => {
    if (flatList.length === 0) return;
    const next = (index + 1) % flatList.length;
    router.push(`/clash/${flatList[next].id}`);
  }, [flatList, index, router]);

  const updateClash = useCallback((guid: string, patch: Partial<Clash>) => {
    setClashes((prev) => prev.map((c) => (c.guid === guid ? { ...c, ...patch } : c)));
  }, []);

  if (!clash) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">
        Clash {id} not found.
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
        onStatusChange={(s) => updateClash(clash.guid, { status: s })}
        onPriorityChange={(p) => updateClash(clash.guid, { priority: p })}
        onAssigneeChange={(a) => updateClash(clash.guid, { assignee: a })}
      />
    </div>
  );
}
