import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Server definition
// ---------------------------------------------------------------------------
// This is the MCP server for Clashero. It exposes tools that Claude can call
// when a user asks it to run clash detection, generate reports, etc.
//
// Right now the tools are STUBS — they return fake data so we can test the
// end-to-end wiring before C and B have built the real backends.
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "clashero",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ---------------------------------------------------------------------------
// Tool definitions
// Claude reads these descriptions to decide when to call each tool.
// Good descriptions = Claude uses the right tool at the right time.
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "run_clash_detection",
        description:
          "Run clash detection on one or more IFC model files using a set of rules. " +
          "Returns a list of clashes found between building components (e.g. pipes " +
          "clashing with beams, ducts clashing with walls). Call this when the user " +
          "wants to analyse a model for clashes or conflicts.",
        inputSchema: {
          type: "object",
          properties: {
            ifc_file_path: {
              type: "string",
              description:
                "Absolute path to the IFC file to analyse, e.g. C:/models/building_A.ifc",
            },
            rules_file_path: {
              type: "string",
              description:
                "Optional path to a JSON rules file that defines which element types " +
                "to check against each other. If omitted, default rules are used.",
            },
          },
          required: ["ifc_file_path"],
        },
      },
      {
        name: "generate_report",
        description:
          "Generate a clash report from the results of a previous clash detection run. " +
          "Returns a Markdown report with clash summaries, severity ratings, and " +
          "responsibility assignments. Call this after run_clash_detection when the " +
          "user wants a report or summary of the clashes.",
        inputSchema: {
          type: "object",
          properties: {
            clash_results_id: {
              type: "string",
              description:
                "The ID returned by run_clash_detection that identifies which results to report on.",
            },
            format: {
              type: "string",
              enum: ["markdown", "bcf"],
              description:
                "Output format. 'markdown' for a readable report, 'bcf' for a BIM " +
                "Collaboration Format file for use in BIM tools. Defaults to 'markdown'.",
            },
          },
          required: ["clash_results_id"],
        },
      },
      {
        name: "get_model_viewer",
        description:
          "Get an interactive 3D viewer for an IFC model, optionally highlighting " +
          "specific clashes. Returns an HTML snippet with an embedded Three.js viewer " +
          "that can be opened in a browser. Call this when the user wants to visually " +
          "inspect the model or a specific clash location.",
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
              description:
                "Optional list of clash IDs to highlight in the viewer.",
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
// These are called by Claude when it decides to use a tool.
// Currently returning stub data — replace with real calls to C's and B's code.
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "run_clash_detection") {
    const filePath = args?.ifc_file_path as string;

    // STUB: In the real implementation this will shell out to C's Rust binary:
    //   const result = await runRustBinary("clash.exe", [filePath, rulesPath]);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              results_id: "run-001",
              ifc_file: filePath,
              status: "complete",
              total_clashes: 3,
              clashes: [
                {
                  id: "CLH-001",
                  severity: "critical",
                  element_a: { id: "Pipe-DP-01", type: "IfcPipeSegment", discipline: "Mechanical" },
                  element_b: { id: "Beam-S-14", type: "IfcBeam", discipline: "Structural" },
                  location: { x: 12.4, y: 3.1, z: 8.7 },
                  description: "Pipe DP-01 intersects structural beam S-14 at level 3",
                },
                {
                  id: "CLH-002",
                  severity: "major",
                  element_a: { id: "Duct-AHU-02", type: "IfcDuctSegment", discipline: "HVAC" },
                  element_b: { id: "Wall-A-22", type: "IfcWall", discipline: "Architecture" },
                  location: { x: 7.2, y: 5.0, z: 6.0 },
                  description: "HVAC duct AHU-02 passes through architectural wall A-22 without a penetration sleeve",
                },
                {
                  id: "CLH-003",
                  severity: "minor",
                  element_a: { id: "Cable-EL-05", type: "IfcCableSegment", discipline: "Electrical" },
                  element_b: { id: "Pipe-DP-03", type: "IfcPipeSegment", discipline: "Mechanical" },
                  location: { x: 9.8, y: 2.3, z: 8.7 },
                  description: "Electrical cable EL-05 runs within 50mm of pipe DP-03, below minimum separation",
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

  if (name === "generate_report") {
    const resultsId = args?.clash_results_id as string;
    const format = (args?.format as string) ?? "markdown";

    // STUB: In the real implementation this will call B's report generator.
    const markdownReport = `# Clash Detection Report
**Run ID:** ${resultsId}
**Generated:** ${new Date().toISOString()}
**Total Clashes:** 3

---

## Critical (1)

### CLH-001 — Pipe DP-01 × Beam S-14
- **Location:** Level 3, Grid 12.4 / 3.1
- **Disciplines:** Mechanical vs Structural
- **Assigned to:** Mechanical Engineer
- **Action:** Reroute pipe or raise beam — coordinate with structural team before proceeding.

---

## Major (1)

### CLH-002 — Duct AHU-02 × Wall A-22
- **Location:** Level 2, Grid 7.2 / 5.0
- **Disciplines:** HVAC vs Architecture
- **Assigned to:** HVAC Engineer
- **Action:** Add penetration sleeve in wall A-22. Issue RFI to architect.

---

## Minor (1)

### CLH-003 — Cable EL-05 × Pipe DP-03
- **Location:** Level 3, Grid 9.8 / 2.3
- **Disciplines:** Electrical vs Mechanical
- **Assigned to:** Electrical Engineer
- **Action:** Increase separation between cable and pipe to meet code minimum (100mm).
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

  if (name === "get_model_viewer") {
    const filePath = args?.ifc_file_path as string;

    // STUB: In the real implementation this will call B's viewer generator.
    return {
      content: [
        {
          type: "text",
          text:
            `3D viewer not yet implemented.\n\n` +
            `When B's viewer is ready, this tool will return an HTML file with an ` +
            `embedded Three.js viewer for: ${filePath}\n\n` +
            `It will be openable in any browser with no installation required.`,
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
