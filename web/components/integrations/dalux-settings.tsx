"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface DaluxSettings {
  connected: boolean;
  projectId?: string;
  fileAreaId?: string;
  folderPath?: string;
  folderId?: string;
  hasApiKey?: boolean;
}

interface DaluxFile {
  id: string;
  name: string;
  latestRevisionId?: string;
}

export function DaluxIntegrationSettings() {
  const router = useRouter();
  const [settings, setSettings] = useState<DaluxSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [projectId, setProjectId] = useState("");
  const [fileAreaId, setFileAreaId] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [files, setFiles] = useState<DaluxFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = async () => {
    const res = await fetch("/api/integrations/dalux/settings");
    const data = await res.json() as DaluxSettings;
    setSettings(data);
    setProjectId(data.projectId ?? "");
    setFileAreaId(data.fileAreaId ?? "");
    setFolderPath(data.folderPath ?? "");
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/integrations/dalux/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: apiKey || undefined,
        projectId,
        fileAreaId,
        folderPath,
      }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Save failed");
    } else {
      setApiKey("");
      setSaved(true);
      loadSettings();
      setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  };

  const disconnect = async () => {
    setDisconnecting(true);
    await fetch("/api/integrations/dalux/settings", { method: "DELETE" });
    setDisconnecting(false);
    setSettings({ connected: false });
    setFiles([]);
  };

  const loadFiles = async () => {
    setLoadingFiles(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/dalux/files");
      const data = await res.json() as { files?: DaluxFile[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Unable to load files");
        return;
      }
      setFiles(data.files ?? []);
    } finally {
      setLoadingFiles(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-6 py-10 space-y-8">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to dashboard
        </button>

        <div>
          <h1 className="text-lg font-semibold">Dalux Box Integration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pull IFC revisions from Dalux Box and queue clash runs in the background worker.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {settings?.connected ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-muted-foreground/50" />
              )}
              <span className="text-sm font-medium">
                {settings?.connected ? "Connected" : "Not connected"}
              </span>
            </div>
            {settings?.connected && (
              <button
                onClick={disconnect}
                disabled={disconnecting}
                className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              API Key
            </label>
            <input
              type="password"
              className="w-full border border-border bg-background rounded px-2.5 py-2 text-sm"
              placeholder={settings?.hasApiKey ? "Stored in vault" : "Enter Dalux API key"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Project ID
            </label>
            <input
              className="w-full border border-border bg-background rounded px-2.5 py-2 text-sm"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              File Area ID
            </label>
            <input
              className="w-full border border-border bg-background rounded px-2.5 py-2 text-sm"
              value={fileAreaId}
              onChange={(e) => setFileAreaId(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Folder Path
            </label>
            <input
              className="w-full border border-border bg-background rounded px-2.5 py-2 text-sm"
              placeholder="/IFC/Models"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
            />
          </div>

          {settings?.folderId && (
            <p className="text-xs text-muted-foreground">Resolved folder ID: {settings.folderId}</p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {saved && <span className="text-xs text-green-400">Saved!</span>}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">IFC files</h2>
              <p className="text-xs text-muted-foreground">Preview IFC files in the configured folder.</p>
            </div>
            <button
              onClick={loadFiles}
              disabled={loadingFiles}
              className="px-3 py-1.5 rounded text-xs bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              {loadingFiles ? "Loading…" : "Load files"}
            </button>
          </div>

          {loadingFiles && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Fetching IFC revisions…
            </div>
          )}

          {!loadingFiles && files.length === 0 && (
            <p className="text-xs text-muted-foreground">No IFC files loaded yet.</p>
          )}

          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((file) => (
                <li key={file.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">{file.name}</span>
                  <a
                    className="text-primary hover:underline"
                    href={`/api/integrations/dalux/files/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
