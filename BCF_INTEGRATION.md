# Rust Engine ↔ Dashboard Integration

## Pipeline

```
models/*.ifc
    ↓  ifc_adapter.rs  — parse IFC, extract geometry + GUIDs
    ↓  clash_engine.rs — BVH broad phase → intersection/distance narrow phase
    ↓  bcf_reporter.rs — write report.bcf (ZIP archive)
web/data/report.bcf
    ↓  api/clashes/route.ts — read + parse
    ↓  bcf-parser.ts
    ↓  page.tsx — fetch + render
```

---

## Running the engine

```bash
cd clash
cargo run -- detect \
  --file ../models/test-cde/BIM_3W_Team2_MEP.ifc \
  --file ../models/test-cde/BIM_3W_Team2_STR.ifc \
  --output ../web/data/report.bcf \
  --tolerance 0.01
```

Multiple `--file` flags merge all elements into one pool. `--discipline-a`/`--discipline-b` restrict which pairs are tested (e.g. only MEP vs STR).

---

## BCF archive layout (`bcf_reporter.rs`)

For each detected clash, one topic folder is created in the ZIP:

```
report.bcf (ZIP)
├── bcf.version               "2.1"
├── project.bcfp              project XML
└── <uuid>/
    ├── markup.bcf            topic XML
    └── <viewpoint-uuid>.bcfv viewpoint XML
```

**`markup.bcf`** fields written:
- `Topic@Guid` — topic UUID → becomes `clash.guid`
- `Topic@TopicStatus` — `"Open"` (hardcoded)
- `Title` — `"Clash between <guidA> and <guidB>"`
- `Description` — verbose version of the same
- `CreationDate`, `CreationAuthor`
- `BIMSnippet/Reference` — `"<guidA>,<guidB>"`

**`<uuid>.bcfv`** fields written:
- `Components/Selection/Component@IfcGuid` — two entries, one per clashing element
- `PerspectiveCamera` — eye = midpoint + `[+2, +2, +2]`, direction toward midpoint, up `[0,0,1]`, FOV 45°

---

## BCF → Clash mapping (`bcf-parser.ts`)

| BCF field | Clash field | Notes |
|---|---|---|
| `Topic@Guid` | `guid` | |
| `Title` | `title` | |
| `Description` | `description` | |
| `Topic@TopicStatus` | `status` | fuzzy-mapped to `open/in_progress/in_review/resolved/closed` |
| `Priority` | `priority` | fuzzy-mapped to `urgent/high/medium/low/none` |
| `AssignedTo` | `assignee` | |
| `CreationDate` | `createdAt` | |
| `Labels/Label[]` | `labels` | |
| `.bcfv` `Component@IfcGuid[0]` | `ifcGuidA` | used by 3D viewer to highlight element A |
| `.bcfv` `Component@IfcGuid[1]` | `ifcGuidB` | used by 3D viewer to highlight element B |
| `.bcfv` `Component.OriginatingSystem[0/1]` | `fileA` / `fileB` | only if present |
| `.bcfv` `CameraViewPoint + Direction` | `viewpoint` | camera flies here on clash select |
| `viewpoint.target` | `midpoint` | bubble position in overview viewer |
| `fileA + fileB` stems | `ruleId` | e.g. `MEP×STR` |

---

## Known gaps

| Gap | Impact | Fix needed in |
|---|---|---|
| `Title` uses raw GUIDs instead of element names | Unreadable in UI | `bcf_reporter.rs` — emit IFC element name/type |
| No `Priority` element written | All clashes default to `none` | `bcf_reporter.rs` — derive from penetration depth |
| No `OriginatingSystem` per component | `ruleId` falls back to `"Clash"` | `bcf_reporter.rs` — add source filename per component |
| No `<Viewpoints>` reference in `markup.bcf` | Parser searches folder for any `.bcfv` — works but fragile | `bcf_reporter.rs` — add `<ViewPoint>` element |
| Camera up vector is `[0,0,1]` (Z-up) | Three.js/ThatOpen uses Y-up | `bcf_reporter.rs` — change to `[0,1,0]` |
| Midpoint uses `vertices()[0]` | Inaccurate — just the first vertex | `main.rs` — use AABB centroid instead |
