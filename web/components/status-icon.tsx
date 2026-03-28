"use client";

import { cn } from "@/lib/utils";
import type { ClashStatus } from "@/lib/types";

interface StatusIconProps {
  status: ClashStatus;
  size?: "sm" | "md";
  className?: string;
}

export function StatusIcon({ status, size = "sm", className }: StatusIconProps) {
  const dim = size === "sm" ? 14 : 18;
  const base = cn("inline-block shrink-0", className);

  if (status === "open") {
    return (
      <svg width={dim} height={dim} viewBox="0 0 16 16" className={base}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="#6B7280" strokeWidth="2" />
      </svg>
    );
  }

  if (status === "in_progress") {
    return (
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 16 16"
        className={cn(base, "animate-spin")}
        style={{ animationDuration: "2.5s" }}
      >
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="#F59E0B"
          strokeWidth="2"
          strokeDasharray="20 17"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (status === "in_review") {
    return (
      <svg width={dim} height={dim} viewBox="0 0 16 16" className={base}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="#3B82F6" strokeWidth="2" />
        <path
          d="M5.5 8.5 L7.5 10.5 L10.5 6"
          stroke="#3B82F6"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (status === "resolved") {
    return (
      <svg width={dim} height={dim} viewBox="0 0 16 16" className={base}>
        <circle cx="8" cy="8" r="7" fill="#22C55E" />
        <path
          d="M5.5 8.5 L7.5 10.5 L10.5 6"
          stroke="white"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // closed
  return (
    <svg width={dim} height={dim} viewBox="0 0 16 16" className={base}>
      <circle cx="8" cy="8" r="7" fill="#374151" />
    </svg>
  );
}
