"use client";

import { useEffect, useState, useCallback } from "react";
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

export function LinearIntegrationSettings() {
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
    const res = await fetch("/api/integrations/linear/settings");
    const data = await res.json() as Settings;
    setSettings(data);
    if (data.connected) {
      setSelectedTeam(data.teamId ?? "");
      setSelectedProject(data.projectId ?? "");
    }
  }, []);

  const loadTeams = useCallback(async () => {
    const res = await fetch("/api/integrations/linear/teams");
    if (!res.ok) return;
    const data = await res.json() as { teams: Team[] };
    setTeams(data.teams);
  }, []);

  const loadProjects = useCallback(async (teamId: string) => {
    if (!teamId) { setProjects([]); return; }
    const res = await fetch(`/api/integrations/linear/projects?teamId=${encodeURIComponent(teamId)}`);
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
    await fetch("/api/integrations/linear/settings", {
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
    await fetch("/api/integrations/linear/settings", { method: "DELETE" });
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
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to dashboard
        </button>

        <div>
          <h1 className="text-lg font-semibold">Linear Integration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect each organization to Linear and keep clash issues in sync.
          </p>
        </div>

        {oauthError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{decodeURIComponent(oauthError)}</p>
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
                href="/api/integrations/linear/authorize"
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

        {settings?.connected && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Team
              </label>
              {teams.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading teams…
                </div>
              ) : (
                <select
                  className="w-full border border-border bg-background rounded px-2.5 py-2 text-sm"
                  value={selectedTeam}
                  onChange={(e) => setSelectedTeam(e.target.value)}
                >
                  <option value="">Select team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.key})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Project
              </label>
              {selectedTeam && projects.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading projects…
                </div>
              ) : (
                <select
                  className="w-full border border-border bg-background rounded px-2.5 py-2 text-sm"
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                >
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving || !selectedTeam}
                className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save selection"}
              </button>
              {saved && <span className="text-xs text-green-400">Saved!</span>}
            </div>
          </div>
        )}

        {settings?.connected && (
          <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Sync project</h2>
                <p className="text-xs text-muted-foreground">Push new clashes to Linear in bulk.</p>
              </div>
              <button
                onClick={syncProject}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Sync now"}
                <RefreshCw className={syncing ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
              </button>
            </div>

            {syncError && <p className="text-xs text-red-400">{syncError}</p>}
            {syncResult && (
              <p className="text-xs text-muted-foreground">
                Synced {syncResult.succeeded} of {syncResult.total} clashes ({syncResult.failed} failed)
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
