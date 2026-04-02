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

You can download the pre-built **Clash CLI** binary for your operating system from the [GitHub Releases](https://github.com/kongsgaard/clashero/releases) page.

To ensure the `clash` command is available in your terminal (added to your PATH), move the downloaded binary to:
- **macOS/Linux**: `/usr/local/bin/`
- **Windows**: A folder included in your PATH, such as `C:\Windows\System32\` (requires admin) or a custom folder added to your Environment Variables.

Alternatively, you can build it from source if you have Rust installed:

```bash
cd clash
cargo build --release
```

After building, the binary will be located at `clash/target/release/clash`.

### Agent Skills

To enable agents to work with the clash detection engine, you can download the **clash-cli** skill. This skill provides the necessary instructions and context for agents to use the `clash` command effectively.

You can find the skill in the `skills/clash-cli` directory.

### Usage

Open Claude Desktop and describe what you want to do in plain language:

> "I want to run clash detection on my IFC models in C:/models/project"

Claude will guide you through registering models, generating clash rules, running detection, and reviewing results.

## Railway Deployment

Set these environment variables in Railway for the web app + worker:

- `DATABASE_URL`: Postgres connection string (Auth.js + integrations).
- `AUTH_SECRET`: Auth.js secret (generate with `openssl rand -base64 32`).
- `AUTH_URL`: Public URL for the app (e.g. `https://clashero.up.railway.app`).
- `AUTH_TRUST_HOST`: `true` when running behind Railway.
- `CLASHERO_MASTER_KEY`: Master key for encrypting integration secrets.
- `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`: Linear OAuth app credentials.
- `LINEAR_REDIRECT_URI`: `<app-url>/api/integrations/linear/callback`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google OAuth credentials.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: GitHub OAuth credentials.
- `MICROSOFT_ENTRA_CLIENT_ID`, `MICROSOFT_ENTRA_CLIENT_SECRET`, `MICROSOFT_ENTRA_TENANT_ID`: Microsoft Entra credentials.
- `EMAIL_SERVER`, `EMAIL_FROM`: SMTP connection string and sender for magic link login.
- `DALUX_API_BASE_URL`: Optional Dalux API base override.
- `NEXT_PUBLIC_BASE_URL`: Public base URL used in Linear issue links.
