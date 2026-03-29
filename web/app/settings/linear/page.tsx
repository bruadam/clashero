"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ExternalLink, CheckCircle2, XCircle, Loader2, ArrowLeft, RefreshCw } from "lucide-react";

interface Settings {
  connected: boolean;
  workspaceName?: string;
  workspaceId?: string;
  teamId?: string;
  projectId?: string;
}

interface Team {
  id: string;
  name: string;
  key: string;
}

interface Project {
  id: string;
  name: string;
}

function LinearSettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ succeeded: number; failed: number; total: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const justConnected = searchParams.get("connected") === "1";
  const oauthError = searchParams.get("error");

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/linear/settings");
    const data = await res.json() as Settings;
    setSettings(data);
    if (data.connected) {
      setSelectedTeam(data.teamId ?? "");
      setSelectedProject(data.projectId ?? "");
    }
  }, []);

  const loadTeams = useCallback(async () => {
    const res = await fetch("/api/linear/teams");
    if (!res.ok) return;
    const data = await res.json() as { teams: Team[] };
    setTeams(data.teams);
  }, []);

  const loadProjects = useCallback(async (teamId: string) => {
    if (!teamId) { setProjects([]); return; }
    const res = await fetch(`/api/linear/projects?teamId=${encodeURIComponent(teamId)}`);
    if (!res.ok) return;
    const data = await res.json() as { projects: Project[] };
    setProjects(data.projects);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (settings?.connected) loadTeams();
  }, [settings?.connected, loadTeams]);

  useEffect(() => {
    loadProjects(selectedTeam);
  }, [selectedTeam, loadProjects]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/linear/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeam, projectId: selectedProject }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    loadSettings();
  };

  const disconnect = async () => {
    setDisconnecting(true);
    await fetch("/api/linear/settings", { method: "DELETE" });
    setDisconnecting(false);
    setSettings({ connected: false });
    setTeams([]);
    setProjects([]);
    setSelectedTeam("");
    setSelectedProject("");
  };

  const syncProject = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/linear/sync-project", { method: "POST" });
      const data = await res.json() as { succeeded?: number; failed?: number; total?: number; error?: string };
      if (!res.ok || data.error) { setSyncError(data.error ?? "Sync failed"); return; }
      setSyncResult({ succeeded: data.succeeded ?? 0, failed: data.failed ?? 0, total: data.total ?? 0 });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-6 py-10 space-y-8">
        {/* Back */}
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to dashboard
        </button>

        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold">Linear Integration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Push clash issues to Linear and pull status changes back into Clashero.
          </p>
        </div>

        {/* OAuth error banner */}
        {oauthError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{decodeURIComponent(oauthError)}</p>
          </div>
        )}

        {/* Connection card */}
        <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {settings?.connected ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-muted-foreground/50" />
              )}
              <span className="text-sm font-medium">
                {settings?.connected
                  ? `Connected to ${settings.workspaceName ?? "Linear"}`
                  : "Not connected"}
              </span>
            </div>

            {settings?.connected ? (
              <button
                onClick={disconnect}
                disabled={disconnecting}
                className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <a
                href="/api/linear/auth"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Connect with Linear
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {justConnected && settings?.connected && (
            <div className="flex items-center gap-2 rounded bg-green-500/10 border border-green-500/20 px-2.5 py-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              <span className="text-xs text-green-400">Successfully connected!</span>
            </div>
          )}
        </div>

        {/* Team + Project selectors */}
        {settings?.connected && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Team
              </label>
              {teams.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading teams…
                </div>
              ) : (
                <select
                  value={selectedTeam}
                  onChange={(e) => { setSelectedTeam(e.target.value); setSelectedProject(""); }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select a team…</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.key})</option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Project <span className="text-muted-foreground/50 normal-case font-normal">(optional)</span>
              </label>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                disabled={!selectedTeam || projects.length === 0}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {saved && (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Saved
                </span>
              )}
              <button
                onClick={save}
                disabled={saving || !selectedTeam}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Sync all clashes */}
        {settings?.connected && (
          <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Sync project clashes</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Push all unsynced clashes to Linear at once. Already-linked clashes are skipped.
              </p>
            </div>

            {syncResult && (
              <div className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-xs border ${syncResult.failed > 0 ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-green-500/20 bg-green-500/10 text-green-400"}`}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {syncResult.total === 0
                  ? "All clashes are already synced."
                  : `${syncResult.succeeded} of ${syncResult.total} pushed successfully${syncResult.failed > 0 ? ` · ${syncResult.failed} failed` : ""}.`}
              </div>
            )}

            {syncError && (
              <div className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs border border-red-500/30 bg-red-500/10 text-red-400">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                {syncError}
              </div>
            )}

            <button
              onClick={syncProject}
              disabled={syncing || !settings.teamId}
              title={!settings.teamId ? "Save a team first" : "Push all unsynced clashes to Linear"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync all clashes to Linear"}
            </button>
          </div>
        )}

        {/* Help */}
        <div className="rounded-lg border border-border/50 bg-muted/5 px-4 py-3 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Setup</p>
          <ol className="text-xs text-muted-foreground/70 space-y-1 list-decimal list-inside">
            <li>Set <code className="font-mono text-[10px] bg-muted px-1 rounded">LINEAR_CLIENT_ID</code> and <code className="font-mono text-[10px] bg-muted px-1 rounded">LINEAR_CLIENT_SECRET</code> in <code className="font-mono text-[10px] bg-muted px-1 rounded">.env.local</code></li>
            <li>Click <strong>Connect with Linear</strong> to authorise via OAuth</li>
            <li>Select the team (and optionally a project) to push issues into</li>
            <li>On any clash detail, click <strong>Push to Linear</strong> to create the issue</li>
            <li>Use <strong>Pull</strong> to sync the Linear status back into Clashero</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export default function LinearSettingsPage() {
  return (
    <Suspense>
      <LinearSettingsContent />
    </Suspense>
  );
}
