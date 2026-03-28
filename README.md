# Clashero - A clash detection tool based on Claude

Clashero is a powerful clash detection tool designed to be used as a MCP agent in Claude to analyze, identify, prioritize, and report on clashes in 3D models. It provides detailed insights into the nature of clashes, their severity, and actionable recommendations for resolution. It assigns the issues to the appropriate responsible person or team based on the type of clash and the components involved.

## Key Features

- **Clash Detection**: Analyze 3D models to identify clashes between different components, such as architectural, structural, and MEP elements.
- **Clash Prioritization**: Assess the severity of each clash based on factors like the type of clash, the components involved, and the potential impact on the project timeline and budget based on the best practices and user input on which area is more important.
- **Detailed Reporting**: Generate comprehensive reports that include the location, severity, and recommended actions for each clash.
- **Responsibility Assignment**: Automatically assign clashes to the appropriate responsible person or team based on the type of clash and the components involved.
- **Screenshot Generation**: Capture screenshots of the clashes for visual reference in reports and communication.
- **Integration with Project Management Tools**: Optionally integrate with project management tools to create tasks for resolving clashes and track their resolution status. (e.g. Linear, Microsoft List, etc.)

## Repository Structure

```
clashero/
├── clash/          # Rust clash detection engine (C)
├── mcp-server/     # MCP server — Claude integration (A)
├── models/         # IFC model files
├── CLAUDE.md       # Claude agent instructions and workflow
└── README.md
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18 or later
- [Rust](https://rustup.rs) (for the clash engine)
- [Claude Desktop](https://claude.ai/download) (to use the MCP server)

### MCP Server setup

The MCP server is what connects Claude Desktop to the clash detection tools.

```bash
cd mcp-server
npm install
npm run build
```

Then add the following to your Claude Desktop config file
(`%APPDATA%\Claude\claude_desktop_config.json` on Windows,
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "clashero": {
      "command": "node",
      "args": ["C:\\path\\to\\clashero\\mcp-server\\dist\\index.js"]
    }
  }
}
```

Restart Claude Desktop. You should see **clashero** listed under the connectors icon in the chat input.

### Clash engine setup

```bash
cd clash
cargo build --release
```

### Usage

Open Claude Desktop and describe what you want to do in plain language:

> "I want to run clash detection on my IFC models in C:/models/project"

Claude will guide you through registering models, generating clash rules, running detection, and reviewing results.
