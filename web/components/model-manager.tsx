"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, FileBox, Trash2, RefreshCw, CheckCircle, Loader2, ChevronRight, X, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface IfcModelEntry {
  filename: string;
  displayName: string;
  uploadedAt: string;
  elementCount: number;
  parsedAt: string | null;
}

interface ModelManagerProps {
  onModelsChange: (models: IfcModelEntry[]) => void;
  onClose?: () => void;
}

type ParseState = "idle" | "parsing" | "done" | "error";

export function ModelManager({ onModelsChange, onClose }: ModelManagerProps) {
  const [models, setModels] = useState<IfcModelEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parseStates, setParseStates] = useState<Record<string, ParseState>>({});
  const [parseErrors, setParseErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      const data: { models: IfcModelEntry[] } = await res.json();
      setModels(data.models);
      onModelsChange(data.models);
    } catch {
      // silently ignore
    }
  }, [onModelsChange]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const ifcFiles = Array.from(files).filter((f) => f.name.endsWith(".ifc"));
      if (ifcFiles.length === 0) return;

      setUploading(true);
      try {
        const form = new FormData();
        for (const f of ifcFiles) form.append("files", f);

        const res = await fetch("/api/models/upload", { method: "POST", body: form });
        await res.json();
        await loadModels();
      } finally {
        setUploading(false);
      }
    },
    [loadModels]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDelete = useCallback(
    async (filename: string) => {
      await fetch(`/api/models?filename=${encodeURIComponent(filename)}`, { method: "DELETE" });
      await loadModels();
    },
    [loadModels]
  );

  const handleParse = useCallback(async (filename: string) => {
    setParseStates((p) => ({ ...p, [filename]: "parsing" }));
    setParseErrors((p) => { const n = { ...p }; delete n[filename]; return n; });
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(filename)}/parse`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail ?? body.error ?? "Parse failed");
      }
      setParseStates((p) => ({ ...p, [filename]: "done" }));
      await loadModels();
    } catch (err) {
      setParseStates((p) => ({ ...p, [filename]: "error" }));
      setParseErrors((p) => ({ ...p, [filename]: String(err) }));
    }
  }, [loadModels]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-primary/10">
        <FileBox className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-foreground/70 tracking-tight">IFC Models</span>
        <span className="text-[10px] text-muted-foreground/50">{models.length}</span>
        <div className="flex-1" />
        <button
          onClick={loadModels}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          "mx-3 mt-3 mb-2 shrink-0 rounded-lg border-2 border-dashed transition-all cursor-pointer",
          isDragging
            ? "border-primary/60 bg-primary/5"
            : "border-primary/20 hover:border-primary/40 hover:bg-accent/20"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex flex-col items-center gap-1.5 py-4 pointer-events-none select-none">
          {uploading ? (
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
          ) : (
            <Upload className="w-5 h-5 text-muted-foreground/50" />
          )}
          <span className="text-[11px] text-muted-foreground/60">
            {uploading ? "Uploading…" : "Drop .ifc files or click to browse"}
          </span>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {/* Model list */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {models.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/40 text-center py-6 px-3">
              No models yet. Upload .ifc files to get started.
            </p>
          ) : (
            <div className="py-1">
              {models.map((model) => (
                <ModelRow
                  key={model.filename}
                  model={model}
                  parseState={parseStates[model.filename] ?? (model.parsedAt ? "done" : "idle")}
                  parseError={parseErrors[model.filename]}
                  onParse={() => handleParse(model.filename)}
                  onDelete={() => handleDelete(model.filename)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  parseState,
  parseError,
  onParse,
  onDelete,
}: {
  model: IfcModelEntry;
  parseState: ParseState;
  parseError?: string;
  onParse: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center gap-2 group">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground/40 hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn("w-3 h-3 transition-transform", expanded && "rotate-90")} />
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground/80 truncate">{model.displayName}</p>
          <p className="text-[10px] text-muted-foreground/40 truncate">{model.filename}</p>
        </div>

        {/* Parse state indicator */}
        {parseState === "parsing" && (
          <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
        )}
        {parseState === "done" && model.elementCount > 0 && (
          <span className="text-[9px] text-emerald-500/70 font-medium shrink-0">
            {model.elementCount.toLocaleString()}
          </span>
        )}
        {parseState === "error" && (
          <span title={parseError}><AlertCircle className="w-3 h-3 text-red-400 shrink-0" /></span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {(parseState === "idle" || parseState === "error") && (
            <button
              onClick={onParse}
              className="p-1 rounded text-muted-foreground hover:text-blue-400 hover:bg-accent transition-colors"
              title="Parse elements"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          {parseState === "done" && (
            <button
              onClick={onParse}
              className="p-1 rounded text-muted-foreground hover:text-blue-400 hover:bg-accent transition-colors"
              title="Re-parse elements"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-accent transition-colors"
            title="Remove model"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Expanded info */}
      {expanded && (
        <div className="mt-1.5 ml-5 pl-2 border-l border-primary/10 space-y-0.5">
          <InfoRow label="File" value={model.filename} />
          <InfoRow label="Uploaded" value={new Date(model.uploadedAt).toLocaleString()} />
          {model.parsedAt && (
            <>
              <InfoRow label="Parsed" value={new Date(model.parsedAt).toLocaleString()} />
              <InfoRow label="Elements" value={model.elementCount.toLocaleString()} />
            </>
          )}
          {!model.parsedAt && parseState !== "parsing" && (
            <button
              onClick={onParse}
              className="flex items-center gap-1 mt-1 text-[10px] text-blue-400/70 hover:text-blue-400 transition-colors"
            >
              <CheckCircle className="w-2.5 h-2.5" />
              Parse now to extract elements
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground/40 w-14 shrink-0">{label}</span>
      <span className="text-[10px] text-foreground/60 truncate">{value}</span>
    </div>
  );
}
