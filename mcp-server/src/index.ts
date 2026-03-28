import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

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
// Models and rules are stored as simple JSON files on disk so they survive
// between conversations. Claude Desktop restarts the MCP server each session,
// so in-memory state would be lost.

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
          "List all IFC models currently registered for this project. " +
          "Call this to see what models and disciplines are available before " +
          "generating clash rules or running clash detection.",
        inputSchema: {
          type: "object",
          properties: {},
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

      // --- Clash detection (stub, real implementation by C) -----------------
      {
        name: "run_clash_detection",
        description:
          "Run clash detection on the registered IFC models using the saved rules. " +
          "Returns a list of clashes found between building components. " +
          "Call this when the user wants to analyse models for clashes.",
        inputSchema: {
          type: "object",
          properties: {
            ifc_file_paths: {
              type: "array",
              items: { type: "string" },
              description:
                "List of absolute IFC file paths to include. If omitted, uses all registered models.",
            },
            rules_path: {
              type: "string",
              description:
                "Path to the rules JSON file. If omitted, uses the saved rules.json.",
            },
          },
        },
      },

      // --- Reporting (stub, real implementation by B) -----------------------
      {
        name: "generate_report",
        description:
          "Generate a clash report from the results of a previous clash detection run. " +
          "Returns a Markdown report with clash summaries, severity ratings, screenshots, " +
          "and links to the 3D web viewer per clash.",
        inputSchema: {
          type: "object",
          properties: {
            clash_results_id: {
              type: "string",
              description: "The ID returned by run_clash_detection.",
            },
            format: {
              type: "string",
              enum: ["markdown", "bcf"],
              description: "'markdown' for a readable report, 'bcf' for BIM Collaboration Format.",
            },
          },
          required: ["clash_results_id"],
        },
      },
      {
        name: "get_model_viewer",
        description:
          "Get an interactive 3D viewer for an IFC model, optionally highlighting specific clashes. " +
          "Returns an HTML snippet with an embedded Three.js viewer.",
        inputSchema: {
          type: "object",
          properties: {
            ifc_file_path: {
              type: "string",
              description: "Absolute path to the IFC file to view.",
            },
            highlight_clash_ids: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of clash IDs to highlight.",
            },
          },
          required: ["ifc_file_path"],
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
    const models = readModels();
    if (models.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No models registered yet. Use register_model to add IFC files to this project.",
          },
        ],
      };
    }
    const table = models
      .map((m) => `- [${m.id}] **${m.name}** (${m.discipline})\n  Path: ${m.path}`)
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Registered models (${models.length}):\n\n${table}`,
        },
      ],
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

  // --- run_clash_detection (stub) -------------------------------------------
  if (name === "run_clash_detection") {
    const models = readModels();
    const filePaths = (args?.ifc_file_paths as string[]) ?? models.map((m) => m.path);

    // STUB: replace with call to C's Rust binary, e.g.:
    //   const result = await runRustBinary("clash.exe", ["--rules", rulesPath, ...filePaths]);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              results_id: "run-001",
              ifc_files: filePaths,
              status: "complete",
              total_clashes: 3,
              clashes: [
                {
                  id: "CLH-001",
                  severity: "critical",
                  element_a: { id: "Pipe-DP-01", type: "IfcPipeSegment", discipline: "MEP" },
                  element_b: { id: "Beam-S-14", type: "IfcBeam", discipline: "STR" },
                  location: { x: 12.4, y: 3.1, z: 8.7 },
                  description: "Pipe DP-01 intersects structural beam S-14 at level 3",
                },
                {
                  id: "CLH-002",
                  severity: "major",
                  element_a: { id: "Duct-AHU-02", type: "IfcDuctSegment", discipline: "HVAC" },
                  element_b: { id: "Wall-A-22", type: "IfcWall", discipline: "ARCH" },
                  location: { x: 7.2, y: 5.0, z: 6.0 },
                  description: "HVAC duct AHU-02 passes through architectural wall A-22 without a penetration sleeve",
                },
                {
                  id: "CLH-003",
                  severity: "minor",
                  element_a: { id: "Cable-EL-05", type: "IfcCableSegment", discipline: "ELEC" },
                  element_b: { id: "Pipe-DP-03", type: "IfcPipeSegment", discipline: "MEP" },
                  location: { x: 9.8, y: 2.3, z: 8.7 },
                  description: "Electrical cable EL-05 runs within 50mm of pipe DP-03",
                },
              ],
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // --- generate_report (stub) -----------------------------------------------
  if (name === "generate_report") {
    const resultsId = args?.clash_results_id as string;
    const format = (args?.format as string) ?? "markdown";

    const VIEWER_BASE_URL = "https://viewer.clashero.com";
    const SCREENSHOT_BASE_PATH = "./screenshots";

    const clashSection = (
      id: string, badge: string, title: string, level: string,
      location: string, elements: string, disciplines: string,
      assignedTo: string, action: string
    ): string => {
      const viewerUrl = `${VIEWER_BASE_URL}/clash/${id}`;
      const screenshotPath = `${SCREENSHOT_BASE_PATH}/${id}.png`;
      return `### ${badge} ${id} — ${title}

[![Screenshot of clash ${id} — click to open in 3D viewer](${screenshotPath})](${viewerUrl})

| | |
|---|---|
| **Level** | ${level} |
| **Location (x, y, z)** | ${location} |
| **Elements** | ${elements} |
| **Disciplines** | ${disciplines} |
| **Assigned to** | ${assignedTo} |

**Action:** ${action}

[Open in 3D Viewer →](${viewerUrl})`;
    };

    // STUB: replace with call to B's report generator.
    const markdownReport = `# Clash Detection Report

| | |
|---|---|
| **Run ID** | \`${resultsId}\` |
| **Generated** | ${new Date().toISOString()} |
| **Total Clashes** | 3 |

### Summary

| Severity | Count |
|---|---|
| 🔴 Critical | 1 |
| 🟠 Major | 1 |
| 🟡 Minor | 1 |

---

## 🔴 Critical

${clashSection("CLH-001","🔴","Pipe DP-01 × Beam S-14","Level 3","(12.4, 3.1, 8.7)",
  "`Pipe-DP-01` (IfcPipeSegment) × `Beam-S-14` (IfcBeam)","MEP × STR",
  "MEP Engineer","Reroute pipe or raise beam — coordinate with structural team before proceeding.")}

---

## 🟠 Major

${clashSection("CLH-002","🟠","Duct AHU-02 × Wall A-22","Level 2","(7.2, 5.0, 6.0)",
  "`Duct-AHU-02` (IfcDuctSegment) × `Wall-A-22` (IfcWall)","HVAC × ARCH",
  "HVAC Engineer","Add penetration sleeve in wall A-22. Issue RFI to architect.")}

---

## 🟡 Minor

${clashSection("CLH-003","🟡","Cable EL-05 × Pipe DP-03","Level 3","(9.8, 2.3, 8.7)",
  "`Cable-EL-05` (IfcCableSegment) × `Pipe-DP-03` (IfcPipeSegment)","ELEC × MEP",
  "Electrical Engineer","Increase separation between cable and pipe to meet code minimum (100mm).")}
`;

    return {
      content: [
        {
          type: "text",
          text: format === "bcf"
            ? `BCF export not yet implemented. Here is the Markdown report instead:\n\n${markdownReport}`
            : markdownReport,
        },
      ],
    };
  }

  // --- get_model_viewer (stub) ----------------------------------------------
  if (name === "get_model_viewer") {
    const filePath = args?.ifc_file_path as string;
    return {
      content: [
        {
          type: "text",
          text:
            `3D viewer not yet implemented.\n\nWhen B's viewer is ready, this tool will return ` +
            `an HTML file with an embedded Three.js viewer for: ${filePath}`,
        },
      ],
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
