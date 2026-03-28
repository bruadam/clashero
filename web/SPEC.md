# Clashero Dashboard — Platform Spec v3

**Linear-like clash coordination dashboard with embedded IFC viewers**

---

## 1. Overview

The Clashero Dashboard is a locally-served Next.js app (`web/`) that presents clash detection results in a **Linear-inspired interface** with two 3D viewer modes:

1. **Overview viewer** — full IFC model loaded via `@thatopen/components`, all clashes shown as colored bubbles at their midpoints. Click a bubble → select that clash.
2. **Detail viewer** — same ThatOpen world, re-uses the cached IFC scene. Highlights the clashing elements by IFC GUID (from BCF), ghosts the rest, and flies the camera to the BCF viewpoint.

Data comes from the Rust clash engine (`clash/`) which writes BCF to `web/data/`. The IFC files in `models/` are parsed in-browser by ThatOpen — no mesh pre-baking needed. A local MCP server wraps the full pipeline for Claude Code.

### Repo structure

```
CLASHERO/
├── .claude/
│   └── skills/thatopen/
│       ├── SKILL.md
│       └── settings.local.json
├── clash/                     ← Rust clash engine
│   ├── src/
│   └── Cargo.toml
├── models/                    ← local IFC files
│   ├── B250_ARK.ifc
│   ├── B250_VENT.ifc
│   └── B250_VVS.ifc
├── web/                       ← this spec (Next.js dashboard)
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── data/                  ← output from clash/ engine
└── README.md
```

### Init

```bash
cd web
npx shadcn@latest init --preset b3PBYm --template next --rtl
```

### Stack

| Layer       | Technology                           | Role                                    |
| ----------- | ------------------------------------ | --------------------------------------- |
| Framework   | Next.js (App Router)                 | Routing, API, SSR                       |
| UI          | shadcn/ui (preset b3PBYm) + Tailwind | Linear-like components                  |
| Overview 3D | @thatopen/components                 | Full IFC model + bubbles                |
| Detail 3D   | @thatopen/components                 | Highlight elements by IFC GUID from BCF |
| Data        | `web/data/` filesystem               | BCF from clash/ engine                  |
| State       | React (useState/useReducer)          | No external store                       |

---

## 2. Data flow

```
models/*.ifc ──→ clash/ (Rust) ──→ web/data/report.bcf
                                    web/data/rules.json

web/ reads web/data/report.bcf + models/*.ifc (ThatOpen loads IFC for both viewers)
```

---

## 3. Input contract

### 3.1 BCF (`web/data/report.bcf`)

Each topic = one clash. Topic GUID links to mesh data.

### 3.2 Rules (`web/data/rules.json`) — optional

```json
[
  {
    "id": "VENT×VVS",
    "a": { "file": "B250_VENT.ifc", "selector": "..." },
    "b": { "file": "B250_VVS.ifc", "selector": "..." }
  }
]
```

### 3.3 IFC files (`models/*.ifc`)

Both viewers load IFC files directly from `models/` via `@thatopen/components`. The models are loaded once at app init, cached as a ThatOpen `FragmentsGroup`, and reused across both the overview (ghosted scene + bubbles) and the detail view (element highlighting by IFC GUID).

---

## 4. UI design — Linear reference

The interface mirrors Linear's visual language from your screenshots:

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Topbar                                                         │
│  CLASHERO   All Issues │ Active │ By Rule   ⚙  ≡  ⊞            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ Workstreams  3 ──────────────────────────────────────── + ┐ │
│  │ ··· CLH-001 ● Duct × Pipe           › VENT×VVS   ◎31 👤  │ │
│  │ ··· CLH-002 ● Wall × Duct           › ARK×VENT   ◎31 👤  │ │
│  │ ··· CLH-003 ● Slab × Pipe    ○ 3/5  › ARK×VVS    ◎31 👤  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ In Review  3 ────────────────────────────────────────── + ┐ │
│  │ ||| CLH-004 ◉ Duct fitting clash    › VENT×VVS  ◎31 👤   │ │
│  │ ||| CLH-005 ◉ Pipe crossing wall    › VVS×ARK   ◎31 👤   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ In Progress  3 ─────────────────────────────────────── + ┐ │
│  │ ...                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Open  9 ─────────────────────────────────────────────── + ┐ │
│  │ ...                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  models/: 3 files · clash/: ✓ · data/: 12 clashes              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Issue detail (slide-over or navigated page)

Matches Linear's detail view from your screenshot:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← CLH-001 › CLH-001 Duct DN400 × Pipe DN150          1 / 12  │
├───────────────────────────────────────────┬─────────────────────┤
│                                           │  Properties ▾       │
│  Duct DN400 × Pipe DN150                  │  ◉ In Progress     │
│  Sub-issue of 🟢 VENT×VVS rule   ○ 0/3   │  ··· Critical      │
│                                           │  👤 michael.wk     │
│  Description...                           │  △ Set estimate     │
│  Ventilation duct DN400 intersects hot    │  ◎ Cycle 1         │
│  water pipe DN150 at level 02, zone B3.   │                     │
│                                           │  Labels ▾           │
│  📎 🔗                                    │  ⊕ Add label       │
│  + Add sub-issues                         │                     │
│                                           │  Source files ▾     │
│  ┌─────────────────────────────────────┐  │  B250_VENT.ifc     │
│  │                                     │  │  B250_VVS.ifc      │
│  │         3D VIEWPORT                 │  │                     │
│  │                                     │  │  IFC GUIDs ▾       │
│  │   [Red duct] ──×── [Blue pipe]      │  │  A: 2x0ZmQ...     │
│  │                                     │  │  B: 3aB1kR...     │
│  │   🔄 Reset  📐 Fit  👻 Context     │  │                     │
│  │   ● A (VENT)  ● B (VVS)  ○ Ctx     │  │  BCF ▾             │
│  └─────────────────────────────────────┘  │  📎 Download .bcf  │
│                                           │  📷 Download .png  │
│  Activity              Subscribe 👤       │                     │
│  ○ clash/ detected · 2h ago              │                     │
│  ○ moved to In Progress · 1h ago         │                     │
│                                           │                     │
│  ┌ Leave a comment...              📎 ↑ ┐│                     │
│  └──────────────────────────────────────┘│                     │
├───────────────────────────────────────────┴─────────────────────┤
```

### 4.3 Overview viewer (top of list or dedicated tab)

A full-width 3D panel above the issue list (collapsible) or as a separate tab/view:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              FULL IFC MODEL (web-ifc / ThatOpen)                │
│                                                                 │
│         [ghosted building]                                      │
│                    🔴 ← clash bubble (critical)                 │
│              🟡 ← clash bubble (major)                          │
│                         🟢 ← clash bubble (minor)               │
│                                                                 │
│   Click bubble → selects clash in list below                    │
│   Hover bubble → tooltip with clash title + discipline pair     │
│                                                                 │
│   🔄 Reset  📐 Fit all  👻 Toggle model opacity                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Viewer architecture — dual mode

### 5.1 Overview viewer (`components/overview-viewer.tsx`)

**Purpose:** Show all clashes in spatial context on the full building model.

**Engine:** `@thatopen/components` — `IfcLoader`, `FragmentsGroup`, `SimpleScene`, `SimpleCamera`.

**Why ThatOpen:** Provides a ready-made world (scene + camera + renderer), built-in IFC loading via fragments, and a `Hider` component for opacity control. The loaded `FragmentsGroup` is cached on the `Components` instance and reused by the detail viewer — no double-parse.

```typescript
interface OverviewViewerProps {
  ifcFiles: string[]; // paths to models/*.ifc (served via /api/models/)
  clashes: Clash[]; // all clashes with midpoints from BCF
  selectedGuid: string | null;
  onSelectClash: (guid: string) => void;
}
```

**Loading:**

1. Init ThatOpen `Components`, create `World` with `SimpleScene` + `SimpleCamera` + `SimpleRenderer`
2. Load each IFC file via `IfcLoader.load()` → `FragmentsGroup` (cached on `Components`)
3. Set all fragments to ghosted opacity (0.15) via `Hider` or direct material override
4. For each clash, place a `THREE.Mesh` sphere at the BCF viewpoint `camera.target` (or computed midpoint), colored by priority
5. Attach raycaster click + hover handlers to bubbles

**Bubble rendering:**

```typescript
const bubbleGeo = new THREE.SphereGeometry(0.3, 16, 16);
clashes.forEach((clash) => {
  const color =
    clash.priority === "critical"
      ? 0xe24b4a
      : clash.priority === "major"
        ? 0xba7517
        : 0x639922;
  const mat = new THREE.MeshBasicMaterial({ color });
  const bubble = new THREE.Mesh(bubbleGeo, mat);
  bubble.position.set(...clash.midpoint);
  bubble.userData = { clashGuid: clash.guid };
  world.scene.three.add(bubble);
});
```

**Interaction:**

- Raycaster on click → find intersected bubble → `onSelectClash(guid)`
- Raycaster on hover → show tooltip (HTML overlay) with clash title
- Selected bubble: pulsing animation or ring highlight
- Building model: semi-transparent (opacity 0.15), no element interaction

**Performance:**

- Load IFC once via ThatOpen, cache `FragmentsGroup` on the shared `Components` instance
- Detail viewer reuses the same loaded fragments — no re-parse on clash selection
- Bubbles are lightweight (shared geometry, instanced if >50 clashes)

### 5.2 Detail viewer (`components/detail-viewer.tsx`)

**Purpose:** Inspect one specific clash with highlighted clashing elements, ghosted context, and camera flown to the BCF viewpoint.

**Engine:** `@thatopen/components` — reuses the cached `FragmentsGroup` from the overview. Uses `Highlighter` to color elements by IFC GUID, `Hider` to ghost everything else, and `CameraControls` to apply the BCF viewpoint.

**No mesh pre-baking needed** — element GUIDs stored in the BCF topic are used to select and highlight geometry directly in the loaded IFC fragments.

```typescript
interface DetailViewerProps {
  clash: Clash; // BCF topic with ifcGuids for side A and B
  viewpoint?: ClashViewpoint; // BCF viewpoint (camera pos + target)
}
```

**Scene setup:**

1. Reuse `Components` instance + cached `FragmentsGroup` (no reload)
2. Use `Highlighter.highlight({ red: guidSetA, blue: guidSetB })` for the clashing elements
3. Use `Hider` to set all other elements to ghost opacity (0.05–0.1)
4. Apply BCF viewpoint via `camera.controls.setLookAt(...)` for initial camera position
5. Restore full visibility + clear highlights on clash change / panel close

**Toolbar:** Reset view (fly to BCF viewpoint), fit to clash, toggle context visibility, ortho/persp, fullscreen.

**Color legend:** `● Side A (VENT)  ● Side B (VVS)  ○ Context`

### 5.3 When to show which viewer

| State               | Overview viewer              | Detail viewer           |
| ------------------- | ---------------------------- | ----------------------- |
| No clash selected   | Visible (top of page or tab) | Hidden                  |
| Clash selected      | Collapsed or tab-switched    | Visible in detail panel |
| Overview tab active | Full height                  | Hidden                  |
| Detail view open    | Hidden (or minimized)        | In detail panel         |

---

## 6. Components — Linear-style

### 6.1 Topbar (`components/topbar.tsx`)

```
CLASHERO    All Issues │ Active │ By Rule │ Overview 🌐    ⚙ ≡ ⊞
```

| Element       | Description                                             |
| ------------- | ------------------------------------------------------- |
| Logo          | "CLASHERO" text                                         |
| Tabs          | All Issues, Active, Backlog (Linear-style view filters) |
| "By Rule"     | Groups issues by clash rule instead of status           |
| "Overview 🌐" | Toggles the full-model 3D overview                      |
| Right icons   | Settings, list/board view toggle, dark mode             |

shadcn: `Tabs` or custom tab bar with Tailwind.

### 6.2 Issue group header (`components/issue-group.tsx`)

Matches Linear's collapsible status groups:

```
▾ ● In Progress  3                                              +
```

- Status icon (colored dot matching Linear's palette)
- Status name
- Count
- Collapse toggle
- "+" to add (future: create new clash manually)

### 6.3 Issue row (`components/issue-row.tsx`)

Matches Linear's row layout from your screenshot:

```
··· CLH-001 ● Duct DN400 × Pipe DN150  › VENT×VVS  ◎31 △1 👤 Mar 28
```

| Element         | Description                                      |
| --------------- | ------------------------------------------------ | -------- | --- | ----------- | --- | --- | --------------------------------------- |
| Priority icon   | `···` (no priority), `                           | `(low),` |     | `(medium),` |     |     | `(high),`!!!` (urgent) — same as Linear |
| ID              | `CLH-001`                                        |
| Status dot      | Colored circle matching status                   |
| Title           | Clash title (truncated)                          |
| Parent          | `› VENT×VVS` — the rule that produced this clash |
| Cycle           | `◎ 31` — cycle/sprint reference (optional)       |
| Estimate        | `△ 1` — effort estimate (optional)               |
| Assignee avatar | Small avatar circle                              |
| Date            | Creation date                                    |

**On click:** Opens detail view (slide-over panel or page navigation, matching Linear).

### 6.4 Detail panel (`components/clash-detail.tsx`)

Slide-over or full-page view matching your Linear screenshot. Sections:

1. **Header** — title, sub-issue of rule, sub-issue count
2. **Description** — rich text (markdown rendered)
3. **Attachments** — PNG snapshot, BCF file download
4. **3D Viewport** — `DetailViewer` component (expandable)
5. **Activity feed** — log of status changes, comments
6. **Comment box** — "Leave a comment..." with attachments

**Properties sidebar** (right column, matches Linear exactly):

| Property     | Value                                                      |
| ------------ | ---------------------------------------------------------- |
| Status       | Select: Open → In Progress → In Review → Resolved → Closed |
| Priority     | Select: Critical / Major / Minor                           |
| Assignee     | Select from team members                                   |
| Estimate     | Number input                                               |
| Cycle        | Select                                                     |
| Labels       | Multi-select: level-02, zone-B3, ...                       |
| Source files | B250_VENT.ifc, B250_VVS.ifc                                |
| IFC GUIDs    | Copyable list                                              |
| BCF          | Download link                                              |

### 6.5 Status bar (`components/status-bar.tsx`)

```
models/: 3 files (ARK, VENT, VVS) · clash/: built ✓ · data/: 12 clashes · report.bcf: 45KB
```

---

## 7. File structure (`web/`)

```
web/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    ← main list view
│   ├── globals.css
│   ├── clash/
│   │   └── [guid]/
│   │       └── page.tsx            ← detail view (or use slide-over)
│   └── api/
│       ├── clashes/
│       │   ├── route.ts            ← GET all clashes from BCF
│       │   └── [guid]/
│       │       └── route.ts        ← GET single clash + mesh
│       ├── snapshot/
│       │   └── [guid]/
│       │       └── route.ts        ← GET PNG from BCF
│       ├── models/
│       │   └── [filename]/
│       │       └── route.ts        ← GET: serve IFC file from models/
│       └── reload/
│           └── route.ts            ← POST: invalidate cache
├── components/
│   ├── topbar.tsx
│   ├── issue-group.tsx
│   ├── issue-row.tsx
│   ├── clash-detail.tsx
│   ├── properties-sidebar.tsx
│   ├── activity-feed.tsx
│   ├── comment-box.tsx
│   ├── overview-viewer.tsx         ← full IFC model + bubbles (@thatopen/components)
│   ├── detail-viewer.tsx           ← element highlighting by IFC GUID (@thatopen/components)
│   ├── viewer-toolbar.tsx
│   ├── color-legend.tsx
│   ├── clash-bubble.tsx            ← 3D bubble marker for overview
│   ├── status-bar.tsx
│   └── ui/                         ← shadcn generated
├── lib/
│   ├── bcf-parser.ts
│   ├── types.ts
│   ├── ifc-loader.ts               ← @thatopen/components wrapper (shared world + cache)
│   ├── paths.ts
│   └── utils.ts
├── data/                           ← from clash/ engine (gitignored)
│   ├── report.bcf
│   └── rules.json
├── components.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 8. shadcn components

```bash
npx shadcn@latest add badge button card input scroll-area select separator \
  table tooltip resizable toggle dropdown-menu dialog tabs avatar sheet popover
```

`Sheet` is used for the detail slide-over panel (matching Linear's issue detail overlay).

---

## 9. API routes

| Route                    | Method | Description                                         |
| ------------------------ | ------ | --------------------------------------------------- |
| `/api/clashes`           | GET    | Parse BCF → all clashes + summary                   |
| `/api/clashes/[guid]`    | GET    | Single clash + BCF viewpoint + IFC GUIDs            |
| `/api/snapshot/[guid]`   | GET    | PNG from BCF archive                                |
| `/api/models/[filename]` | GET    | Serve IFC file from `models/` to browser (ThatOpen) |
| `/api/reload`            | POST   | Invalidate cache after clash/ runs                  |

The `/api/models/[filename]` route serves IFC files to the browser for ThatOpen loading. It reads from `REPO_ROOT/models/` and streams the file with appropriate headers.

---

## 10. Dependencies (`web/package.json`)

```json
{
  "dependencies": {
    "next": "latest",
    "react": "^19",
    "react-dom": "^19",
    "three": "^0.175.0",
    "@types/three": "^0.175.0",
    "@thatopen/components": "latest",
    "@thatopen/components-front": "latest",
    "@thatopen/fragments": "latest",
    "@thatopen/ui": "latest",
    "web-ifc": "^0.0.74",
    "camera-controls": "^3.1.2",
    "jszip": "^3.10.0",
    "fast-xml-parser": "^4.5.0",
    "lucide-react": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "tailwind-merge": "latest"
  }
}
```

**Note:** Both viewers use `@thatopen/components`. `web-ifc` is kept as a peer dependency (required by ThatOpen's `IfcLoader`). The `FragmentsGroup` is loaded once and shared between the overview and detail viewer via a singleton `Components` instance.

---

## 11. Color system

### Priority (Linear-style)

| Priority    | Icon  | Color   |
| ----------- | ----- | ------- | ------- | ------- | ------- |
| Urgent      | `!!!` | #E24B4A |
| High        | `     |         |         | `       | #F09595 |
| Medium      | `     |         | `       | #BA7517 |
| Low         | `     | `       | #639922 |
| No priority | `···` | muted   |

### Status (Linear-style)

| Status      | Icon | Color |
| ----------- | ---- | ----- |
| Open        | ○    | gray  |
| In Progress | ◉    | amber |
| In Review   | ◉    | blue  |
| Resolved    | ✓    | green |
| Closed      | ●    | muted |

### 3D viewport

| Element         | Color                        |
| --------------- | ---------------------------- |
| Side A          | #FF3B30 (red), opacity 0.92  |
| Side B          | #007AFF (blue), opacity 0.92 |
| Context         | #8E8E93, opacity 0.07        |
| Overview model  | #8E8E93, opacity 0.15        |
| Bubble critical | #E24B4A                      |
| Bubble major    | #BA7517                      |
| Bubble minor    | #639922                      |

---

## 12. Key interactions

| Action                   | Behavior                                          |
| ------------------------ | ------------------------------------------------- |
| Click issue row          | Open detail view (slide-over Sheet or navigation) |
| Click bubble in overview | Select clash, open detail view                    |
| Hover bubble             | Tooltip: title + discipline pair + priority       |
| Collapse status group    | Toggle group visibility (accordion)               |
| Tab: All Issues          | Show all, grouped by status                       |
| Tab: Active              | Show open + in progress only                      |
| Tab: By Rule             | Group by ruleId instead of status                 |
| Tab: Overview 🌐         | Show full-model 3D viewer                         |
| Filter/sort              | Issue list updates                                |
| Detail: change status    | Update local state (future: write back to BCF)    |
| Detail: reset view       | Fly camera to BCF viewpoint                       |
| Detail: toggle context   | Show/hide ghost elements                          |
| Escape / back arrow      | Close detail, return to list                      |
| ↑ / ↓                    | Navigate issues in list                           |
| ← / → in detail          | Previous / next clash                             |

---

## 13. Performance

- IFC files: load once via ThatOpen `IfcLoader`, cache `FragmentsGroup` on shared `Components` instance. Both viewers reuse the same loaded model.
- Detail viewer: apply `Highlighter` + `Hider` on clash change, restore on close. No geometry disposal / reload needed.
- ThatOpen WASM (`web-ifc`): loaded once at app init via `IfcLoader.setup()`.
- Bubbles: shared `SphereGeometry`, only material differs. Use instanced mesh if >50.
- Status bar filesystem reads: cached, refreshed on `/api/reload`.

---

## 14. ThatOpen architecture — shared `Components` instance

Both viewers share a single `OBC.Components` instance (module-level singleton in `lib/ifc-loader.ts`). This means:

| Concern      | Approach                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------- |
| IFC loading  | `IfcLoader.load()` once per file, results cached as `FragmentsGroup`                      |
| Scene reuse  | Overview and detail viewer attach to the same `World` or swap `World` renderers           |
| Highlighting | `Highlighter` component from `@thatopen/components-front`; clear between clash selections |
| Visibility   | `Hider` component; restore all on close                                                   |
| Camera       | BCF viewpoint applied via `world.camera.controls.setLookAt(pos, target, true)`            |
| WASM         | `IfcLoader.setup({ autoSetWasm: true })` once at app init                                 |

---

## 15. Future extensions

- Write status changes back to BCF
- Live reload via WebSocket when clash/ re-runs
- Notion / Linear sync buttons
- Annotation tools in 3D viewport
- PDF export per clash
- Board view (Kanban) in addition to list view
- Multi-project support
- Clash grouping / deduplication UI
