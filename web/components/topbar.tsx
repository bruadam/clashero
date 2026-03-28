"use client";

import { Settings, LayoutList, Grid3X3, Globe, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

type Tab = "all" | "active" | "by-rule" | "overview";

interface TopbarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All Issues" },
  { id: "active", label: "Active" },
];

export function Topbar({ activeTab, onTabChange }: TopbarProps) {
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-11 items-center bg-background px-4 shrink-0 relative">
      <div className="absolute bottom-0 left-3 right-3 h-px rounded-full bg-primary/15" />
      {/* Logo */}
      <div className="flex items-center gap-2 mr-6">
        <div className="w-5 h-5 rounded bg-primary flex items-center justify-center">
          <span className="text-[9px] font-black text-primary-foreground leading-none">
            C
          </span>
        </div>
        <span className="text-sm font-semibold tracking-tight">ClasHero</span>
      </div>

      {/* Tabs */}
      <nav className="flex items-center gap-0.5 flex-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-8 rounded text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            )}
          >
            {tab.id === "overview" && <Globe className="w-3 h-3" />}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          onClick={toggle}
          title="Toggle theme (D)"
        >
          {theme === "dark" ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </Button>
      </div>
    </header>
  );
}
