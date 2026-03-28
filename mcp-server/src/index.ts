import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawnSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Compute the repo root from the location of this file (mcp-server/src/index.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// dist/  →  mcp-server/  →  repo root
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MODELS_DIR = path.join(REPO_ROOT, "models");

// ── Runtime constants ─────────────────────────────────────────────────────────
const CLASH_BINARY = path.join(REPO_ROOT, "clash", "target", "release", "clash.exe");
const BCF_OUTPUT_PATH = path.join(REPO_ROOT, "web", "data", "report.bcf");
const DASHBOARD_URL = "http://localhost:3000";

// ---------------------------------------------------------------------------
// Server definition
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "clashero", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ---------------------------------------------------------------------------
// Persistent storage helpers
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(
  process.env.APPDATA ?? process.env.HOME ?? ".",
  "clashero"
);
const MODELS_FILE = path.join(DATA_DIR, "models-registry.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readModels(): ModelEntry[] {
  ensureDataDir();
  if (!fs.existsSync(MODELS_FILE)) return [];
  return JSON.parse(fs.readFileSync(MODELS_FILE, "utf-8")) as ModelEntry[];
}

function writeModels(models: ModelEntry[]) {
  ensureDataDir();
  fs.writeFileSync(MODELS_FILE, JSON.stringify(models, null, 2));
}

interface ModelEntry {
  id: string;
  name: string;
  discipline: string;
  path: string;
  registered_at: string;
}

// Minimal Clash shape for report formatting
interface ClashEntry {
  guid: string;
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  ruleId: string;
  ifcGuidA: string;
  ifcGuidB: string;
  fileA: string;
  fileB: string;
  midpoint: [number, number, number];
  assignee?: string;
  labels: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // --- Model registry ---------------------------------------------------
      {
        name: "register_model",
        description:
          "Register an IFC model file with a discipline label so Claude knows " +
          "which files are part of this project. Call this when the user provides " +
          "an IFC file path and wants to add it to the project. " +
          "Example disciplines: ARCH, STR, MEP, HVAC, ELEC, FIRE, GEO.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Human-readable model name, e.g. 'Architecture' or 'MEP Services'",
            },
            discipline: {
              type: "string",
              description:
                "Short discipline code, e.g. ARCH, STR, MEP, HVAC, ELEC, FIRE, GEO. " +
                "Used when generating clash rules to decide which pairs to check.",
            },
            path: {
              type: "string",
              description: "Absolute path to the IFC file on disk.",
            },
          },
          required: ["name", "discipline", "path"],
        },
      },
      {
        name: "list_models",
        description:
          "ALWAYS call this first when the user mentions models, IFC files, or wants to " +
          "start clash detection — even if they have not specified a path. " +
          "Shows all registered models AND scans the repo's models/ folder for any " +
          "unregistered IFC files, inferring their discipline codes from the filename. " +
          "Use auto_register to register all discovered files in one step.",
        inputSchema: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description:
                "Extra directory to scan for IFC files. The repo models/ folder is " +
                "always scanned automatically — only provide this for additional locations.",
            },
            auto_register: {
              type: "boolean",
              description:
                "If true, automatically register all unregistered IFC files found. " +
                "Default false — show the list to the user for confirmation first.",
            },
          },
        },
      },
      {
        name: "remove_model",
        description:
          "Remove an IFC model from the project registry by its ID. " +
          "Call this when the user wants to remove a model from the project.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The model ID as returned by list_models.",
            },
          },
          required: ["id"],
        },
      },

      // --- Rules ------------------------------------------------------------
      {
        name: "save_clash_rules",
        description:
          "Save a set of clash detection rules to a JSON file on disk. " +
          "Call this after you have reasoned about which discipline pairs should " +
          "be checked and generated the rules JSON. The saved file will be passed " +
          "to C's Rust clash engine as input. " +
          "Each rule specifies two element selectors (a and b) to check against each other. " +
          "Selector syntax: exact IFC type e.g. 'IfcBeam', or wildcard e.g. 'IfcDuct*', " +
          "or pipe-separated list e.g. 'IfcWall|IfcSlab'.",
        inputSchema: {
          type: "object",
          properties: {
            rules: {
              type: "array",
              description: "Array of clash rules to save.",
              items: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "Rule name, typically DisciplineAxDisciplineB e.g. 'VENTxSTR'",
                  },
                  a: {
                    type: "object",
                    properties: {
                      selector: {
                        type: "string",
                        description: "IFC type selector for side A, e.g. 'IfcDuct*'",
                      },
                    },
                    required: ["selector"],
                  },
                  b: {
                    type: "object",
                    properties: {
                      selector: {
                        type: "string",
                        description: "IFC type selector for side B, e.g. 'IfcBeam|IfcColumn'",
                      },
                    },
                    required: ["selector"],
                  },
                },
                required: ["name", "a", "b"],
              },
            },
            output_path: {
              type: "string",
              description:
                "Where to save the rules JSON file. If omitted, saves to the " +
                "clashero data directory as 'rules.json'.",
            },
          },
          required: ["rules"],
        },
      },
      {
        name: "list_clash_rules",
        description:
          "Show the currently saved clash rules. Call this when the user wants " +
          "to review, edit, or confirm the rules before running clash detection.",
        inputSchema: {
          type: "object",
          properties: {
            rules_path: {
              type: "string",
              description: "Path to the rules JSON file. Defaults to the clashero data directory.",
            },
          },
        },
      },

      // --- Clash detection --------------------------------------------------
      {
        name: "run_clash_detection",
        description:
          "Run clash detection on the registered IFC models using the saved rules. " +
          "Invokes the Rust clash engine, generates a BCF report, and returns how many " +
          "clashes were found. After this, call import_clash_results to load the results " +
          "into the dashboard (confirm with the user first if there are existing results).",
        inputSchema: {
          type: "object",
          properties: {
            rules_path: {
              type: "string",
              description:
                "Path to the rules JSON file. If omitted, uses the saved rules.json.",
            },
            tolerance: {
              type: "number",
              description:
                "Clearance tolerance in metres. Elements closer than this distance are " +
                "reported as clashes. Default 0 (hard intersection only).",
            },
          },
        },
      },
      {
        name: "import_clash_results",
        description:
          "Import the BCF clash report generated by run_clash_detection into the " +
          "dashboard database. This replaces any previously imported results. " +
          "Always confirm with the user before calling this if there are existing clashes " +
          "in the database (the existing_db_count field returned by run_clash_detection).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },

      // --- Reporting --------------------------------------------------------
      {
        name: "generate_report",
        description:
          "Generate a Markdown clash report from the dashboard. Fetches live clash data " +
          "(status, priority, assignee) from the running dashboard. " +
          "Requires the dashboard to be running (cd web && npm run dev).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_model_viewer",
        description:
          "Get a link to the interactive 3D clash viewer. Checks whether the dashboard " +
          "is running and returns a clickable URL. If the dashboard is not running, " +
          "instructs the user how to start it.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "start_dashboard",
        description:
          "Start the Next.js dashboard (web app) in the background so the 3D viewer and " +
          "clash list are accessible at http://localhost:3000. " +
          "Call this when the user wants to open the viewer or review results in the browser " +
          "and get_model_viewer reports that the dashboard is not running.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Tool call handlers
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // --- register_model -------------------------------------------------------
  if (name === "register_model") {
    const models = readModels();
    const id = `model-${Date.now()}`;
    const entry: ModelEntry = {
      id,
      name: args?.name as string,
      discipline: (args?.discipline as string).toUpperCase(),
      path: args?.path as string,
      registered_at: new Date().toISOString(),
    };
    models.push(entry);
    writeModels(models);
    return {
      content: [
        {
          type: "text",
          text: `Registered model:\n${JSON.stringify(entry, null, 2)}\n\nTotal models: ${models.length}`,
        },
      ],
    };
  }

  // --- list_models ----------------------------------------------------------
  if (name === "list_models") {
    const registered = readModels();
    const autoRegister = (args?.auto_register as boolean) ?? false;

    const dirsToScan = [DEFAULT_MODELS_DIR];
    if (args?.directory) dirsToScan.push(args.directory as string);

    const inferDiscipline = (filePath: string): string => {
      const upper = path.basename(filePath).toUpperCase();
      if (upper.includes("ARCH") && upper.includes("CONTEXT"))  return "ARCH_CONTEXT";
      if (upper.includes("ARCH") && upper.includes("FURN"))     return "ARCH_FURNITURE";
      if (upper.includes("ARCH"))  return "ARCH";
      if (upper.includes("STR") || upper.includes("STRUCT"))    return "STR";
      if (upper.includes("MEP"))   return "MEP";
      if (upper.includes("HVAC") || upper.includes("VENT"))     return "HVAC";
      if (upper.includes("ELEC") || upper.includes("EL_"))      return "ELEC";
      if (upper.includes("FIRE"))  return "FIRE";
      if (upper.includes("GEO") || upper.includes("SITE"))      return "GEO";
      return "UNKNOWN";
    };

    const foundFiles: string[] = [];
    const scanDir = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) scanDir(full);
        else if (entry.name.toLowerCase().endsWith(".ifc")) foundFiles.push(full);
      }
    };
    dirsToScan.forEach(scanDir);

    const registeredPaths = new Set(registered.map((m) => m.path));
    const unregistered = foundFiles
      .filter((p) => !registeredPaths.has(p))
      .map((p) => ({ name: path.basename(p, ".ifc"), discipline: inferDiscipline(p), path: p }));

    if (autoRegister && unregistered.length > 0) {
      const updated = [...registered];
      for (const u of unregistered) {
        updated.push({ id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...u, registered_at: new Date().toISOString() });
      }
      writeModels(updated);
      const lines = updated.map((m) => `- [${m.id}] **${m.name}** (${m.discipline})`).join("\n");
      return {
        content: [{ type: "text", text: `Registered ${unregistered.length} new models. All models (${updated.length}):\n\n${lines}` }],
      };
    }

    const parts: string[] = [];
    if (registered.length > 0) {
      parts.push(`**Registered (${registered.length}):**\n` +
        registered.map((m) => `- [${m.id}] **${m.name}** (${m.discipline})\n  Path: ${m.path}`).join("\n"));
    }
    if (unregistered.length > 0) {
      parts.push(`**Found but not registered (${unregistered.length}):**\n` +
        unregistered.map((u) => `- **${u.name}** → inferred discipline: \`${u.discipline}\`\n  Path: ${u.path}`).join("\n") +
        "\n\nShall I register these? I can adjust any discipline codes first if needed.");
    }
    if (parts.length === 0) {
      return {
        content: [{ type: "text", text: `No IFC files found in ${DEFAULT_MODELS_DIR} and no models registered.` }],
      };
    }
    return {
      content: [{ type: "text", text: parts.join("\n\n") }],
    };
  }

  // --- remove_model ---------------------------------------------------------
  if (name === "remove_model") {
    const models = readModels();
    const id = args?.id as string;
    const filtered = models.filter((m) => m.id !== id);
    if (filtered.length === models.length) {
      return {
        content: [{ type: "text", text: `No model found with ID: ${id}` }],
        isError: true,
      };
    }
    writeModels(filtered);
    return {
      content: [{ type: "text", text: `Removed model ${id}. ${filtered.length} models remaining.` }],
    };
  }

  // --- save_clash_rules -----------------------------------------------------
  if (name === "save_clash_rules") {
    ensureDataDir();
    const rules = args?.rules;
    const outputPath = (args?.output_path as string) ?? path.join(DATA_DIR, "rules.json");
    fs.writeFileSync(outputPath, JSON.stringify(rules, null, 2));
    const count = Array.isArray(rules) ? rules.length : 0;
    return {
      content: [
        {
          type: "text",
          text: `Saved ${count} clash rules to: ${outputPath}\n\n${JSON.stringify(rules, null, 2)}`,
        },
      ],
    };
  }

  // --- list_clash_rules -----------------------------------------------------
  if (name === "list_clash_rules") {
    const rulesPath = (args?.rules_path as string) ?? path.join(DATA_DIR, "rules.json");
    if (!fs.existsSync(rulesPath)) {
      return {
        content: [
          {
            type: "text",
            text: `No rules file found at: ${rulesPath}\n\nUse save_clash_rules to generate and save rules first.`,
          },
        ],
      };
    }
    const rules = fs.readFileSync(rulesPath, "utf-8");
    const parsed = JSON.parse(rules) as unknown[];
    return {
      content: [
        {
          type: "text",
          text: `Clash rules at ${rulesPath} (${parsed.length} rules):\n\n\`\`\`json\n${rules}\n\`\`\``,
        },
      ],
    };
  }

  // --- run_clash_detection --------------------------------------------------
  if (name === "run_clash_detection") {
    const models = readModels();
    if (models.length === 0) {
      return {
        content: [{ type: "text", text: "No models registered. Use list_models and register_model first." }],
        isError: true,
      };
    }

    const rulesPath = (args?.rules_path as string) ?? path.join(DATA_DIR, "rules.json");
    if (!fs.existsSync(rulesPath)) {
      return {
        content: [{ type: "text", text: "No clash rules saved. Use save_clash_rules to generate rules first." }],
        isError: true,
      };
    }

    // Read our rules format: [{ name, a: { selector }, b: { selector } }]
    const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8")) as Array<{
      name: string;
      a: { selector: string };
      b: { selector: string };
    }>;

    // Only use models that exist on disk
    const validModels = models.filter((m) => fs.existsSync(m.path));
    if (validModels.length === 0) {
      return {
        content: [{ type: "text", text: "None of the registered model files exist on disk. Check the file paths." }],
        isError: true,
      };
    }

    // Transform to C's ClashSet format:
    // All models appear on both sides; the selector per side filters which elements participate.
    const clashSets = rules.map((rule) => ({
      name: rule.name,
      a: validModels.map((m) => ({ file: m.path, selector: rule.a.selector, mode: "i" })),
      b: validModels.map((m) => ({ file: m.path, selector: rule.b.selector, mode: "i" })),
    }));

    // Write config file
    const configPath = path.join(DATA_DIR, "clash-config.json");
    fs.writeFileSync(configPath, JSON.stringify(clashSets, null, 2));

    // Ensure BCF output directory exists
    const bcfDir = path.dirname(BCF_OUTPUT_PATH);
    if (!fs.existsSync(bcfDir)) fs.mkdirSync(bcfDir, { recursive: true });

    // Check binary exists
    if (!fs.existsSync(CLASH_BINARY)) {
      return {
        content: [{
          type: "text",
          text: `Clash binary not found at: ${CLASH_BINARY}\n\nBuild it with:\n  cd clash\n  cargo build --release`,
        }],
        isError: true,
      };
    }

    // Run the engine
    const tolerance = (args?.tolerance as number) ?? 0.0;
    const result = spawnSync(
      CLASH_BINARY,
      ["detect", "--clash-set", configPath, "--output", BCF_OUTPUT_PATH, "--tolerance", String(tolerance)],
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    );

    if (result.error) {
      return {
        content: [{ type: "text", text: `Failed to run clash engine: ${result.error.message}` }],
        isError: true,
      };
    }
    if (result.status !== 0) {
      return {
        content: [{ type: "text", text: `Clash engine failed (exit code ${result.status}):\n${result.stderr}` }],
        isError: true,
      };
    }

    const stdout = result.stdout ?? "";
    const match = stdout.match(/Total Clashes:\s*(\d+)/);
    const clashCount = match ? parseInt(match[1], 10) : -1;

    // Check if the dashboard already has data
    let existingDbCount = 0;
    try {
      const resp = await fetch(`${DASHBOARD_URL}/api/clashes`);
      if (resp.ok) {
        const data = await resp.json() as { clashes: unknown[]; source: string };
        if (data.source === "db") existingDbCount = data.clashes.length;
      }
    } catch {
      // Dashboard not running — that's fine
    }

    return {
      content: [{
        type: "text",
        text: [
          `**Clash detection complete.**`,
          ``,
          `\`\`\``,
          stdout.trim(),
          `\`\`\``,
          ``,
          `**BCF report:** \`${BCF_OUTPUT_PATH}\``,
          `**Clashes found:** ${clashCount >= 0 ? clashCount : "see output above"}`,
          `**Existing dashboard results:** ${existingDbCount > 0 ? existingDbCount + " clashes" : "none"}`,
          ``,
          existingDbCount > 0
            ? `⚠️ The dashboard already has ${existingDbCount} clash(es). Call \`import_clash_results\` to replace them with the new results (confirm with user first).`
            : `Call \`import_clash_results\` to load these results into the dashboard.`,
        ].join("\n"),
      }],
    };
  }

  // --- import_clash_results -------------------------------------------------
  if (name === "import_clash_results") {
    let response: Response;
    try {
      response = await fetch(`${DASHBOARD_URL}/api/clashes/import`, { method: "POST" });
    } catch {
      return {
        content: [{
          type: "text",
          text: `Could not reach the dashboard at ${DASHBOARD_URL}.\n\nStart it with:\n  cd web\n  npm run dev`,
        }],
        isError: true,
      };
    }

    if (!response.ok) {
      const body = await response.text();
      return {
        content: [{ type: "text", text: `Import failed (HTTP ${response.status}): ${body}` }],
        isError: true,
      };
    }

    const data = await response.json() as { imported: number };
    return {
      content: [{
        type: "text",
        text: `✅ Imported **${data.imported}** clash${data.imported !== 1 ? "es" : ""} into the dashboard.\n\nView them at: ${DASHBOARD_URL}`,
      }],
    };
  }

  // --- generate_report ------------------------------------------------------
  if (name === "generate_report") {
    let clashes: ClashEntry[] = [];
    let source = "unknown";

    try {
      const resp = await fetch(`${DASHBOARD_URL}/api/clashes`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { clashes: ClashEntry[]; source: string };
      clashes = data.clashes;
      source = data.source;
    } catch {
      return {
        content: [{
          type: "text",
          text: `Could not reach the dashboard at ${DASHBOARD_URL}.\n\nStart it with:\n  cd web\n  npm run dev\n\nThen run import_clash_results before generating the report.`,
        }],
        isError: true,
      };
    }

    if (source === "dummy") {
      return {
        content: [{
          type: "text",
          text: `No real clash data in the dashboard. Run \`run_clash_detection\` then \`import_clash_results\` first.`,
        }],
      };
    }

    // Group clashes by priority
    const byPriority: Record<string, ClashEntry[]> = { urgent: [], high: [], medium: [], low: [], none: [] };
    for (const c of clashes) {
      const p = c.priority ?? "none";
      (byPriority[p] ?? byPriority["none"]).push(c);
    }

    const priorityBadge: Record<string, string> = {
      urgent: "🔴 Urgent",
      high: "🟠 High",
      medium: "🟡 Medium",
      low: "🟢 Low",
      none: "⚪ None",
    };

    const statusCounts: Record<string, number> = {};
    for (const c of clashes) {
      statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
    }

    const summaryRows = Object.entries(statusCounts)
      .map(([s, n]) => `| ${s} | ${n} |`)
      .join("\n");

    const priorityRows = Object.entries(byPriority)
      .filter(([, arr]) => arr.length > 0)
      .map(([p, arr]) => `| ${priorityBadge[p] ?? p} | ${arr.length} |`)
      .join("\n");

    const clashSections = clashes.map((c) => {
      const viewerUrl = `${DASHBOARD_URL}/clashes/${c.guid}`;
      const pos = c.midpoint ? `(${c.midpoint.map((v) => v.toFixed(2)).join(", ")})` : "—";
      return [
        `### ${priorityBadge[c.priority] ?? "⚪"} ${c.id} — ${c.title}`,
        ``,
        `| | |`,
        `|---|---|`,
        `| **Status** | ${c.status} |`,
        `| **Priority** | ${c.priority} |`,
        `| **Rule** | ${c.ruleId || "—"} |`,
        `| **Elements** | \`${c.ifcGuidA}\` × \`${c.ifcGuidB}\` |`,
        `| **Location** | ${pos} |`,
        `| **Assignee** | ${c.assignee ?? "—"} |`,
        `| **Labels** | ${c.labels?.join(", ") || "—"} |`,
        ``,
        c.description ? `> ${c.description}` : "",
        ``,
        `[Open in 3D viewer →](${viewerUrl})`,
      ].filter((l) => l !== null).join("\n");
    }).join("\n\n---\n\n");

    const report = [
      `# Clash Detection Report`,
      ``,
      `| | |`,
      `|---|---|`,
      `| **Generated** | ${new Date().toISOString()} |`,
      `| **Source** | ${source} |`,
      `| **Total Clashes** | ${clashes.length} |`,
      ``,
      `## Summary by status`,
      ``,
      `| Status | Count |`,
      `|---|---|`,
      summaryRows,
      ``,
      `## Summary by priority`,
      ``,
      `| Priority | Count |`,
      `|---|---|`,
      priorityRows,
      ``,
      `---`,
      ``,
      `## Clashes`,
      ``,
      clashSections,
    ].join("\n");

    return { content: [{ type: "text", text: report }] };
  }

  // --- get_model_viewer -----------------------------------------------------
  if (name === "get_model_viewer") {
    let dashboardRunning = false;
    try {
      const resp = await fetch(DASHBOARD_URL, { signal: AbortSignal.timeout(2000) });
      dashboardRunning = resp.ok || resp.status < 500;
    } catch {
      dashboardRunning = false;
    }

    if (dashboardRunning) {
      return {
        content: [{
          type: "text",
          text: `The dashboard is running. Open it at:\n\n**${DASHBOARD_URL}**\n\nYou can view individual clashes at \`${DASHBOARD_URL}/clashes/<guid>\`.`,
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: `The dashboard is not running.\n\nStart it with:\n\`\`\`\ncd web\nnpm run dev\n\`\`\`\n\nThen open **${DASHBOARD_URL}** in your browser.`,
      }],
    };
  }

  // --- start_dashboard ------------------------------------------------------
  if (name === "start_dashboard") {
    // Check if already running
    try {
      const resp = await fetch(DASHBOARD_URL, { signal: AbortSignal.timeout(2000) });
      if (resp.ok || resp.status < 500) {
        return {
          content: [{
            type: "text",
            text: `Dashboard is already running at ${DASHBOARD_URL}`,
          }],
        };
      }
    } catch {
      // Not running — proceed to start
    }

    const webDir = path.join(REPO_ROOT, "web");
    if (!fs.existsSync(webDir)) {
      return {
        content: [{ type: "text", text: `web/ directory not found at: ${webDir}` }],
        isError: true,
      };
    }

    // Spawn npm run dev detached so it survives independently of this process
    const child = spawn("npm", ["run", "dev"], {
      cwd: webDir,
      detached: true,
      stdio: "ignore",
      shell: true,
    });
    child.unref();

    // Poll for up to 15 s
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const resp = await fetch(DASHBOARD_URL, { signal: AbortSignal.timeout(1000) });
        if (resp.ok || resp.status < 500) {
          return {
            content: [{
              type: "text",
              text: `Dashboard started. Open it at:\n\n**${DASHBOARD_URL}**`,
            }],
          };
        }
      } catch {
        // Still starting up
      }
    }

    return {
      content: [{
        type: "text",
        text: `Dashboard process launched but did not respond within 15 s. ` +
          `It may still be starting — try opening ${DASHBOARD_URL} in a moment.`,
      }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
