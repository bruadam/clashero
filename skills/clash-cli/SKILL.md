---
name: clash-cli
description: Interact with the clash CLI for IFC clash detection and BCF report generation. Use when analyzing IFC files for intersections, running clash detection, or generating BCF reports.
---

# Clash CLI

This skill provides instructions for interacting with the `clash` command-line tool, which is used for detecting clashes between IFC (Industry Foundation Classes) files and generating BCF (BIM Collaboration Format) reports.

## Quick start

Run a basic clash detection between two IFC files:

```bash
cargo run -- detect --file model1.ifc --file model2.ifc
```

## Workflows

### 1. Clash Detection

To detect clashes with a specific tolerance and output a BCF report:

```bash
cargo run -- detect --file path/to/arch.ifc --file path/to/struct.ifc --tolerance 0.01 --output report.bcfzip
```

**Options:**
- `--file <FILE>`: Path to an IFC file. You can specify multiple files by repeating the flag.
- `--tolerance <TOLERANCE>`: Tolerance for clash detection in meters (default: 0.0).
- `--output <OUTPUT>`: Optional path for the generated BCF report (e.g., `report.bcfzip`).
- `--discipline-a <DISCIPLINE>`: Filter clashes where the first element belongs to a specific discipline.
- `--discipline-b <DISCIPLINE>`: Filter clashes where the second element belongs to a specific discipline.

### 2. Generating BCF Reports

When generating BCF reports through the CLI or when implementing BCF-related features, follow these guidelines for viewpoint generation:

- **Camera Positioning**: Set the camera `eye` near the clash location.
- **Camera Direction**: Set the camera direction to `normalize(clash_position - eye)`.

## Best Practices

- Always specify the `--output` flag if you need to share or visualize the results in a BIM tool.
- Use `--discipline-a` and `--discipline-b` to reduce noise when focusing on specific trade coordination (e.g., Architecture vs. MEP).
- For large models, ensure you have sufficient memory as IFC parsing and clash detection can be resource-intensive.
