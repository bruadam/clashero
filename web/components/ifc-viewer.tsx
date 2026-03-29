"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import type * as OBC from "@thatopen/components";
import type * as OBCF from "@thatopen/components-front";
import type * as FRAGS from "@thatopen/fragments";
import type { Clash, ClashViewpoint } from "@/lib/types";
import type { IfcModelEntry } from "@/components/model-manager";
import type { BcfSelectedElement } from "@/components/bcf-create-dialog";
import {
  X, Loader2, FilePlus, ChevronDown,
  Maximize2, Grid3X3, Eye, EyeOff, Ruler, Scissors, RotateCcw,
  Box, Sun,
} from "lucide-react";
import { STATUS_META, PRIORITY_META } from "@/lib/types";
import { toast } from "sonner";

const PRIORITY_COLORS: Record<string, number> = {
  urgent: 0xe24b4a,
  high: 0xf09595,
  medium: 0xba7517,
  low: 0x639922,
  none: 0x6b7280,
};

const STATUS_COLORS: Record<string, number> = {
  open:        0x6b7280,
  in_progress: 0xf59e0b,
  in_review:   0x3b82f6,
  resolved:    0x22c55e,
  closed:      0x374151,
};

// Up to 8 stable hues for assignees / rule sets
const PALETTE = [0x6366f1, 0xf43f5e, 0x06b6d4, 0x84cc16, 0xf97316, 0xa855f7, 0x14b8a6, 0xfbbf24];

function stableIndex(key: string, max: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) >>> 0;
  return h % max;
}

export type DateRange = "last-hour" | "last-day" | "last-week" | "last-month" | "this-year";
export type DateField = "created";
export type ColorizeBy =
  | "priority"
  | "status"
  | "assignee"
  | "rule"
  | { dateField: DateField; range: DateRange };

// Color for "within range" vs "outside range"
const DATE_IN_COLOR  = 0x22c55e;
const DATE_OUT_COLOR = 0x374151;

const COLOR_A = new THREE.Color(0xff3b30);
const COLOR_B = new THREE.Color(0x007aff);

export interface SelectedElementInfo {
  expressId: number;
  globalId: string;
  ifcType: string;
  name: string | null;
  modelFilename: string;
  properties: Record<string, string>;
  screenPosition: { x: number; y: number };
}

interface IfcViewerProps {
  selectedClash: Clash | null;
  clashes: Clash[];
  theme: "dark" | "light";
  models?: IfcModelEntry[];
  colorizeBy?: ColorizeBy;
  onColorizeByChange?: (v: ColorizeBy) => void;
  onCreateBcfIssue?: (elements: BcfSelectedElement[], viewpoint: ClashViewpoint) => void;
  onBubbleRightClick?: (clash: Clash, x: number, y: number) => void;
}

type LoadingState = "idle" | "loading" | "done" | "error";

type OBCWorld = OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>;

// Shared init ref — we only want to init ThatOpen once per mount
interface ViewerRefs {
  components: OBC.Components | null;
  world: OBCWorld | null;
  fragments: OBC.FragmentsManager | null;
  ifcLoader: OBC.IfcLoader | null;
  bubblesGroup: THREE.Group | null;
  highlightGroup: THREE.Group | null;
  grid: THREE.GridHelper | null;
  // track loaded filenames
  loadedFiles: Set<string>;
  // tools
  lengthMeasurement: OBCF.LengthMeasurement | null;
  clipper: OBC.Clipper | null;
  // authoring
  hider: OBC.Hider | null;
  classifier: OBC.Classifier | null;
  boundingBoxer: OBC.BoundingBoxer | null;
  highlighter: OBCF.Highlighter | null;
}

export function IfcViewer({ selectedClash, clashes, theme, models, colorizeBy: colorizeByProp, onColorizeByChange, onCreateBcfIssue, onBubbleRightClick }: IfcViewerProps) {
  const [colorizeByInternal, setColorizeByInternal] = useState<ColorizeBy>("priority");
  const colorizeBy: ColorizeBy = colorizeByProp ?? colorizeByInternal;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  // Midpoint overrides computed from actual element bounding boxes after models load
  const [midpointOverrides, setMidpointOverrides] = useState<Map<string, [number, number, number]>>(new Map());

  useEffect(() => {
    if (!showColorPicker) return;
    function onDown(e: MouseEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showColorPicker]);

  function setColorizeBy(v: ColorizeBy) {
    setColorizeByInternal(v);
    onColorizeByChange?.(v);
    setShowColorPicker(false);
  }

  // Multi-element selection for BCF issue creation
  const [bcfSelection, setBcfSelection] = useState<BcfSelectedElement[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a stable ref to clashes so the click callback can read the latest value
  const clashesRef = useRef(clashes);
  useEffect(() => { clashesRef.current = clashes; }, [clashes]);
  const refs = useRef<ViewerRefs>({
    components: null,
    world: null,
    fragments: null,
    ifcLoader: null,
    bubblesGroup: null,
    highlightGroup: null,
    grid: null,
    loadedFiles: new Set(),
    lengthMeasurement: null,
    clipper: null,
    hider: null,
    classifier: null,
    boundingBoxer: null,
    highlighter: null,
  });

  // ── Toolbox state ──────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<"none" | "measure" | "clip">("none");
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [isolated, setIsolated] = useState(false);

  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Selection popover state
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [loadingProperties, setLoadingProperties] = useState(false);

  // ── Init ThatOpen world ─────────────────────────────────────────────────────
  // Capture theme at mount time so init can set the correct initial background
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let cleanupFn: (() => void) | undefined;

    async function init() {
      const OBCRuntime = await import("@thatopen/components");
      if (disposed) return;

      const components = new OBCRuntime.Components();
      refs.current.components = components;

      const worlds = components.get(OBCRuntime.Worlds);
      const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();
      refs.current.world = world;

      world.scene = new OBCRuntime.SimpleScene(components);
      world.renderer = new OBCRuntime.SimpleRenderer(components, container!);
      world.camera = new OBCRuntime.SimpleCamera(components);
      world.scene.setup();

      const isDarkInit = themeRef.current === "dark";
      const bgColor = new THREE.Color(isDarkInit ? 0x090910 : 0xffffff);
      world.scene.three.background = bgColor;
      world.scene.three.fog = new THREE.FogExp2(bgColor.getHex(), isDarkInit ? 0.006 : 0.003);

      const fillLight = new THREE.DirectionalLight(0x8080ff, 0.4);
      fillLight.position.set(-30, 20, -30);
      world.scene.three.add(fillLight);

      const grid = new THREE.GridHelper(200, 60, 0x1e1e24, 0x161618);
      world.scene.three.add(grid);
      refs.current.grid = grid;

      const bubblesGroup = new THREE.Group();
      const highlightGroup = new THREE.Group();
      world.scene.three.add(bubblesGroup);
      world.scene.three.add(highlightGroup);
      refs.current.bubblesGroup = bubblesGroup;
      refs.current.highlightGroup = highlightGroup;

      components.init();

      // Fragments manager
      const fragments = components.get(OBCRuntime.FragmentsManager);
      refs.current.fragments = fragments;

      const workerRes = await fetch("/wasm/worker.mjs");
      const workerBlob = new Blob([await workerRes.text()], { type: "text/javascript" });
      const workerURL = URL.createObjectURL(workerBlob);
      fragments.init(workerURL);

      fragments.core.onModelLoaded.add((model: FRAGS.FragmentsModel) => {
        model.useCamera(world.camera.three);
        if (!world.scene.three.children.includes(model.object)) {
          world.scene.three.add(model.object);
        }
        fixZFighting(model.object);
        if (!refs.current.loadedFiles.has(model.modelId)) {
          refs.current.loadedFiles.add(model.modelId);
        }
      });

      world.camera.controls.addEventListener("update", () => {
        if (fragments.initialized) fragments.core.update();
      });

      const ro = new ResizeObserver(() => {
        world.renderer?.resize();
        world.camera.updateAspect();
      });
      ro.observe(container!);

      // IFC loader
      const ifcLoader = components.get(OBCRuntime.IfcLoader);
      refs.current.ifcLoader = ifcLoader;
      await ifcLoader.setup({
        autoSetWasm: false,
        wasm: { path: "/wasm/", absolute: true },
      });

      // ── OBCF tools ────────────────────────────────────────────────────────
      const OBCFRuntime = await import("@thatopen/components-front");
      if (disposed) return;

      const lengthMeasurement = components.get(OBCFRuntime.LengthMeasurement);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (lengthMeasurement as any).world = world;
      lengthMeasurement.enabled = false;
      refs.current.lengthMeasurement = lengthMeasurement as unknown as OBCF.LengthMeasurement;

      const clipper = components.get(OBCRuntime.Clipper);
      clipper.enabled = false;
      refs.current.clipper = clipper;

      // Wire clip edges so section planes render styled outlines
      const clipStyler = components.get(OBCFRuntime.ClipStyler);
      clipStyler.world = world;
      clipper.onAfterCreate.add((plane) => {
        // Find the ID for this plane in clipper.list and create styled edges
        for (const [id, p] of clipper.list) {
          if (p === plane) {
            clipStyler.createFromClipping(id);
            break;
          }
        }
      });

      // ── Authoring tools ───────────────────────────────────────────────────
      const hider = components.get(OBCRuntime.Hider);
      refs.current.hider = hider;

      const classifier = components.get(OBCRuntime.Classifier);
      refs.current.classifier = classifier;

      const boundingBoxer = components.get(OBCRuntime.BoundingBoxer);
      refs.current.boundingBoxer = boundingBoxer;

      const highlighter = components.get(OBCFRuntime.Highlighter);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (highlighter as any).setup({ world });
      highlighter.zoomToSelection = false;
      refs.current.highlighter = highlighter as unknown as OBCF.Highlighter;

      // Register custom highlight styles for clash element A (red) and B (blue)
      const FRAGS_Init = await import("@thatopen/fragments");
      highlighter.styles.set("clashA", {
        color: COLOR_A,
        renderedFaces: FRAGS_Init.RenderedFaces.TWO,
        opacity: 1,
        transparent: false,
      });
      highlighter.styles.set("clashB", {
        color: COLOR_B,
        renderedFaces: FRAGS_Init.RenderedFaces.TWO,
        opacity: 1,
        transparent: false,
      });
      highlighter.styles.set("ghost", {
        color: new THREE.Color(0x888888),
        renderedFaces: FRAGS_Init.RenderedFaces.TWO,
        opacity: 0.15,
        transparent: true,
      });

      // Classify models as they load so Hider & Classifier work immediately
      fragments.core.onModelLoaded.add(async () => {
        try { await classifier.byIfcBuildingStorey(); } catch { /* no storey data */ }
        try { await classifier.byModel(); } catch { /* skip */ }
      });

      cleanupFn = () => {
        ro.disconnect();
        URL.revokeObjectURL(workerURL);
        components.dispose();
      };
    }

    init().catch((err) => {
      console.error("[IFC] Init error:", err);
      setLoadingState("error");
      setLoadError(String(err?.message ?? err));
    });

    return () => {
      disposed = true;
      cleanupFn?.();
      refs.current = {
        components: null,
        world: null,
        fragments: null,
        ifcLoader: null,
        bubblesGroup: null,
        highlightGroup: null,
        grid: null,
        loadedFiles: new Set(),
        lengthMeasurement: null,
        clipper: null,
        hider: null,
        classifier: null,
        boundingBoxer: null,
        highlighter: null,
      };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load models when list changes ──────────────────────────────────────────
  useEffect(() => {
    if (!models || models.length === 0) return;
    const { ifcLoader, loadedFiles, world, fragments } = refs.current;
    if (!ifcLoader || !world) return;

    const toLoad = models.filter(
      (m) => !loadedFiles.has(m.filename)
    );
    if (toLoad.length === 0) return;

    async function loadModels() {
      setLoadingState("loading");
      setTotalCount(toLoad.length);
      let loaded = 0;

      for (const model of toLoad) {
        setCurrentFile(model.displayName);
        await new Promise<void>((r) => setTimeout(r, 0));
        try {
          const res = await fetch(`/api/models/${model.filename}`);
          if (!res.ok) {
            console.warn(`[IFC] Not found: ${model.filename}`);
          } else {
            const buffer = await res.arrayBuffer();
            await refs.current.ifcLoader!.load(new Uint8Array(buffer), true, model.filename);
          }
        } catch (err) {
          console.warn(`[IFC] Failed: ${model.filename}`, err);
        }
        loaded++;
        setLoadedCount(loaded);
      }

      setLoadingState("done");
      setCurrentFile(null);

      if (world && fragments) fitCameraToModels(world, fragments);
      if (fragments) {
        refineMidpoints(fragments, clashes).then((overrides) => {
          setMidpointOverrides(overrides);
        });
      }
    }

    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // ── Fallback: load hardcoded models when no models prop ─────────────────────
  useEffect(() => {
    if (models && models.length > 0) return;
    const { ifcLoader, world, fragments } = refs.current;
    if (!ifcLoader) return;

    const DEFAULT_FILES = [
      "Building-Architecture.ifc",
      "Building-Hvac.ifc",
      "Building-Structural.ifc",
    ];

    async function loadDefaults() {
      setLoadingState("loading");
      setTotalCount(DEFAULT_FILES.length);
      let loaded = 0;

      for (const filename of DEFAULT_FILES) {
        setCurrentFile(filename.replace(".ifc", ""));
        await new Promise<void>((r) => setTimeout(r, 0));
        try {
          const res = await fetch(`/api/models/${filename}`);
          if (res.ok) {
            const buffer = await res.arrayBuffer();
            await refs.current.ifcLoader!.load(new Uint8Array(buffer), true, filename);
          }
        } catch (err) {
          console.warn(`[IFC] Default load failed: ${filename}`, err);
        }
        loaded++;
        setLoadedCount(loaded);
      }

      setLoadingState("done");
      setCurrentFile(null);

      if (world && fragments) fitCameraToModels(world, fragments);
      if (fragments) {
        refineMidpoints(fragments, clashes).then((overrides) => {
          setMidpointOverrides(overrides);
        });
      }
    }

    // Delay slightly to allow init to complete
    const t = setTimeout(loadDefaults, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-colorize bubbles when colorizeBy, clashes, or midpoint overrides change ─
  useEffect(() => {
    const { bubblesGroup } = refs.current;
    if (bubblesGroup) placeBubbles(clashes, bubblesGroup, colorizeBy, midpointOverrides);
  }, [clashes, colorizeBy, midpointOverrides]);

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const world = refs.current.world;
    if (!world) return;

    const isDark = theme === "dark";
    const bg = new THREE.Color(isDark ? 0x090910 : 0xffffff);
    world.scene.three.background = bg;
    world.scene.three.fog = new THREE.FogExp2(bg.getHex(), isDark ? 0.006 : 0.003);

    const grid = refs.current.grid;
    if (grid) {
      const mats = grid.material as unknown as THREE.Material[];
      if (mats[0] instanceof THREE.LineBasicMaterial)
        mats[0].color.set(isDark ? 0x1e1e24 : 0xd1d5db);
      if (mats[1] instanceof THREE.LineBasicMaterial)
        mats[1].color.set(isDark ? 0x161618 : 0xe5e7eb);
    }
  }, [theme]);

  // ── Selected clash → highlight ─────────────────────────────────────────────
  useEffect(() => {
    const { highlightGroup, fragments, world, bubblesGroup } = refs.current;
    if (!highlightGroup) return;
    // Don't attempt highlights until models are fully loaded
    if (loadingState !== "done") return;

    // Cancel any in-flight highlight from a previous selection
    let cancelled = false;

    highlightGroup.clear();
    setSelectedElement(null);

    // Toggle bubble visibility: show only the selected clash's bubble, or all if none selected
    if (bubblesGroup) {
      for (const child of bubblesGroup.children) {
        child.visible = !selectedClash || child.userData.clashGuid === selectedClash.guid;
      }
    }

    async function applyHighlight() {
      if (!highlightGroup) return;

      const highlighter = refs.current.highlighter;

      // Clear previous Highlighter selections for clash styles
      if (highlighter) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hl = highlighter as any;
          if (hl.selection?.clashA) hl.selection.clashA = {};
          if (hl.selection?.clashB) hl.selection.clashB = {};
          if (hl.selection?.ghost) hl.selection.ghost = {};
          await hl.updateColors?.();
        } catch { /* ignore if not yet ready */ }
      }

      // Reset all models: clear per-element highlights and restore full opacity
      if (fragments?.initialized) {
        for (const model of fragments.core.models.list.values()) {
          try {
            await model.resetHighlight(undefined);
            await model.resetOpacity(undefined);
          } catch {
            resetModelAppearance(model.object);
          }
        }
      }

      if (!selectedClash || cancelled) return;
      if (cancelled) return;

      if (fragments?.initialized) {
        // Resolve each clash GUID to its correct model and local IDs.
        // Use fileA/fileB to target the right model directly; fall back to scanning all models.
        const clashMapA: OBC.ModelIdMap = {};
        const clashMapB: OBC.ModelIdMap = {};
        const modelsWithClash = new Set<string>();

        const slots: Array<{ guid: string; file: string; map: OBC.ModelIdMap }> = [];
        if (selectedClash.ifcGuidA) slots.push({ guid: selectedClash.ifcGuidA, file: selectedClash.fileA, map: clashMapA });
        if (selectedClash.ifcGuidB) slots.push({ guid: selectedClash.ifcGuidB, file: selectedClash.fileB, map: clashMapB });

        for (const { guid, file, map } of slots) {
          if (cancelled) return;

          // Helper: try resolving the GUID in a specific model
          const tryModel = async (model: import("@thatopen/fragments").FragmentsModel): Promise<boolean> => {
            try {
              const localIds = await model.getLocalIdsByGuids([guid]);
              const ids = localIds.filter((id): id is number => id != null);
              if (ids.length > 0) {
                map[model.modelId] = new Set(ids);
                modelsWithClash.add(model.modelId);
                return true;
              }
            } catch { /* GUID not in this model */ }
            return false;
          };

          // Try the expected model first (fileA/fileB → modelId)
          let found = false;
          if (file) {
            const targetModel = fragments!.core.models.list.get(file);
            if (targetModel) found = await tryModel(targetModel);
          }

          // Fallback: scan all models if the expected model didn't have the GUID
          if (!found) {
            for (const model of fragments!.core.models.list.values()) {
              if (cancelled) return;
              if (await tryModel(model)) break;
            }
          }
        }

        if (cancelled) return;

        // Warn user if elements could not be found in any loaded model
        const foundA = Object.keys(clashMapA).length > 0;
        const foundB = Object.keys(clashMapB).length > 0;
        if (selectedClash.ifcGuidA && !foundA && selectedClash.ifcGuidB && !foundB) {
          toast.error("Could not find either clash element in the loaded models");
        } else if (selectedClash.ifcGuidA && !foundA) {
          toast.warning("Could not find element A in the loaded models", {
            description: selectedClash.ifcGuidA,
          });
        } else if (selectedClash.ifcGuidB && !foundB) {
          toast.warning("Could not find element B in the loaded models", {
            description: selectedClash.ifcGuidB,
          });
        }

        // Build ghost map: all elements EXCEPT the clashing ones
        const ghostMap: OBC.ModelIdMap = {};
        for (const model of fragments!.core.models.list.values()) {
          if (cancelled) return;
          try {
            const allIds = await model.getLocalIds();
            const clashIdsA = clashMapA[model.modelId];
            const clashIdsB = clashMapB[model.modelId];
            const ghostIds = new Set<number>();
            for (const id of allIds) {
              if (clashIdsA?.has(id) || clashIdsB?.has(id)) continue;
              ghostIds.add(id);
            }
            if (ghostIds.size > 0) {
              ghostMap[model.modelId] = ghostIds;
            }
          } catch { /* skip models that don't support getLocalIds */ }
        }

        if (cancelled) return;

        // Apply ghost + clash highlights via the Highlighter component
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hl = highlighter as any;
        if (hl) {
          try {
            // Ghost non-clashing elements
            if (Object.keys(ghostMap).length > 0) {
              await hl.highlightByID("ghost", ghostMap, true);
            }
            // Highlight clash elements
            if (Object.keys(clashMapA).length > 0) {
              await hl.highlightByID("clashA", clashMapA, true);
            }
            if (Object.keys(clashMapB).length > 0) {
              await hl.highlightByID("clashB", clashMapB, true);
            }
          } catch {
            // Fallback to model-level highlight if Highlighter fails
            for (const [modelId, idSet] of Object.entries(clashMapA)) {
              const model = fragments!.core.models.list.get(modelId);
              if (model) {
                try {
                  const FRAGS = await import("@thatopen/fragments");
                  await model.highlight([...idSet], {
                    color: COLOR_A,
                    renderedFaces: FRAGS.RenderedFaces.TWO,
                    opacity: 1,
                    transparent: false,
                  });
                } catch { tintModel(model.object, COLOR_A.clone(), 0.9); }
              }
            }
            for (const [modelId, idSet] of Object.entries(clashMapB)) {
              const model = fragments!.core.models.list.get(modelId);
              if (model) {
                try {
                  const FRAGS = await import("@thatopen/fragments");
                  await model.highlight([...idSet], {
                    color: COLOR_B,
                    renderedFaces: FRAGS.RenderedFaces.TWO,
                    opacity: 1,
                    transparent: false,
                  });
                } catch { tintModel(model.object, COLOR_B.clone(), 0.9); }
              }
            }
          }
        }
      }

      if (cancelled) return;

      const [mx, my, mz] = selectedClash.midpoint;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
      );
      sphere.position.set(mx, my, mz);
      highlightGroup.add(sphere);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.1, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
      );
      ring.position.set(mx, my, mz);
      ring.lookAt(mx, my + 10, mz);
      highlightGroup.add(ring);

      if (world) {
        const { cameraPosition: cp, target: tgt } = selectedClash.viewpoint;
        world.camera.controls.setLookAt(cp[0], cp[1], cp[2], tgt[0], tgt[1], tgt[2], true);
      }
    }

    applyHighlight();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClash, loadingState]);

  // ── Click → select element + show properties popover ──────────────────────
  const handleCanvasClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      const { world, fragments } = refs.current;
      if (!container || !world || !fragments?.initialized) return;

      const rect = container.getBoundingClientRect();
      // Normalised mouse coords in [-1,1] x [-1,1] (unused directly — Fragments needs pixel coords)
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      // Fragments raycast needs the canvas element from the renderer
      const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) {
        setSelectedElement(null);
        return;
      }

      // Use each model's own raycast API (safe for InterleavedBufferAttribute geometry)
      let hitModelId: string | null = null;
      let hitItemId: number | null = null;

      for (const model of fragments.core.models.list.values()) {
        try {
          const result = await model.raycast({
            camera: world.camera.three,
            mouse,
            dom: canvas,
          });
          if (result) {
            hitModelId = model.modelId;
            hitItemId = result.localId ?? null;
            break;
          }
        } catch {
          // model not yet ready or doesn't support raycast — skip
        }
      }

      if (!hitModelId) {
        setSelectedElement(null);
        return;
      }

      setLoadingProperties(true);
      setSelectedElement({
        expressId: hitItemId ?? 0,
        globalId: "",
        ifcType: "Unknown",
        name: null,
        modelFilename: hitModelId,
        properties: {},
        screenPosition: { x: e.clientX, y: e.clientY },
      });

      try {
        // Resolve localId → GlobalId using Fragments data API
        let resolvedGlobalId: string | null = null;
        if (hitItemId != null) {
          for (const model of fragments.core.models.list.values()) {
            if (model.modelId === hitModelId) {
              try {
                const guids = await model.getGuidsByLocalIds([hitItemId]);
                resolvedGlobalId = guids[0] ?? null;
              } catch { /* not available */ }
              break;
            }
          }
        }

        // Fetch element info by GlobalId (lightweight) instead of loading all model elements
        type ElemData = { expressId: number; globalId: string; ifcType: string; name: string | null; properties: Record<string, string> };
        let elem: ElemData | undefined;

        if (resolvedGlobalId) {
          const res = await fetch(`/api/elements?guid=${encodeURIComponent(resolvedGlobalId)}`);
          if (res.ok) {
            const data: Record<string, ElemData | null> = await res.json();
            elem = data[resolvedGlobalId] ?? undefined;
          }
        }

        // Fallback: fetch from model parse endpoint if GUID lookup failed
        if (!elem) {
          const res = await fetch(`/api/models/${encodeURIComponent(hitModelId)}/parse`);
          if (res.ok) {
            const data: { elements: ElemData[] } = await res.json();
            elem = data.elements[0];
          }
        }

        if (elem) {
            const info: SelectedElementInfo = {
              expressId: elem.expressId,
              globalId: elem.globalId,
              ifcType: elem.ifcType,
              name: elem.name,
              modelFilename: hitModelId,
              properties: elem.properties,
              screenPosition: { x: e.clientX, y: e.clientY },
            };
            setSelectedElement(info);

            // Log BCF topics that reference this element
            const matchingTopics = clashesRef.current.filter(
              (c) => c.ifcGuidA === elem.globalId || c.ifcGuidB === elem.globalId
            );
            if (matchingTopics.length > 0) {
              console.group(`[BCF] Topics referencing element ${elem.globalId} (${elem.ifcType}${elem.name ? " — " + elem.name : ""})`);
              for (const topic of matchingTopics) {
                console.log(`${topic.id} · ${topic.title}`, topic);
              }
              console.groupEnd();
            } else {
              console.log(`[BCF] No topics reference element ${elem.globalId} (${elem.ifcType}${elem.name ? " — " + elem.name : ""})`);
            }

            // BCF selection (Shift = append, plain click = replace)
            const bcfEl: BcfSelectedElement = {
              globalId: elem.globalId,
              modelFilename: hitModelId,
              ifcType: elem.ifcType,
              name: elem.name,
            };
            if (e.shiftKey) {
              setBcfSelection((prev) => {
                const exists = prev.findIndex((p) => p.globalId === bcfEl.globalId);
                if (exists >= 0) return prev.filter((_, i) => i !== exists);
                return [...prev, bcfEl];
              });
            } else {
              setBcfSelection([bcfEl]);
            }
          }
      } catch {
        // keep partial placeholder info
      } finally {
        setLoadingProperties(false);
      }
    },
    []
  );

  // ── Right-click on bubble → context menu ─────────────────────────────────
  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      const { world, bubblesGroup } = refs.current;
      if (!container || !world || !bubblesGroup || !onBubbleRightClick) return;

      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, world.camera.three);
      const hits = raycaster.intersectObjects(bubblesGroup.children, false);
      if (hits.length === 0) return;

      const guid = hits[0].object.userData.clashGuid as string | undefined;
      if (!guid) return;

      const clash = clashes.find((c) => c.guid === guid);
      if (!clash) return;

      onBubbleRightClick(clash, e.clientX, e.clientY);
    },
    [clashes, onBubbleRightClick],
  );

  // ── Build viewpoint from current camera ───────────────────────────────────
  const getCurrentViewpoint = useCallback((): ClashViewpoint => {
    const world = refs.current.world;
    if (!world) {
      return { cameraPosition: [0, 10, 20], cameraDirection: [0, -0.4, -0.9], cameraUpVector: [0, 1, 0], target: [0, 0, 0] };
    }
    const cam = world.camera.three;
    const pos = cam.position;
    const target = world.camera.controls.getTarget(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(target, pos).normalize();
    const up = cam.up;
    return {
      cameraPosition: [pos.x, pos.y, pos.z],
      cameraDirection: [dir.x, dir.y, dir.z],
      cameraUpVector: [up.x, up.y, up.z],
      target: [target.x, target.y, target.z],
    };
  }, []);

  // ── Tool handlers ──────────────────────────────────────────────────────────
  const handleFitView = useCallback(() => {
    const { world, fragments } = refs.current;
    if (world && fragments) fitCameraToModels(world, fragments);
  }, []);

  const handleToggleWireframe = useCallback(() => {
    const { fragments } = refs.current;
    setWireframe((prev) => {
      const next = !prev;
      if (fragments?.initialized) {
        for (const mat of fragments.core.models.materials.list.values()) {
          if (mat instanceof THREE.MeshLambertMaterial) {
            mat.wireframe = next;
          }
        }
      }
      return next;
    });
  }, []);

  const handleToggleGrid = useCallback(() => {
    const { grid } = refs.current;
    setShowGrid((prev) => {
      const next = !prev;
      if (grid) grid.visible = next;
      return next;
    });
  }, []);

  const handleToggleMeasure = useCallback(() => {
    const lm = refs.current.lengthMeasurement as unknown as { enabled: boolean; create: () => void } | null;
    setActiveTool((prev) => {
      const next = prev === "measure" ? "none" : "measure";
      // disable clipper if switching to measure
      const clipper = refs.current.clipper;
      if (clipper) clipper.enabled = false;
      if (lm) lm.enabled = next === "measure";
      return next;
    });
  }, []);

  const handleToggleClip = useCallback(() => {
    const { clipper, world } = refs.current;
    setActiveTool((prev) => {
      const next = prev === "clip" ? "none" : "clip";
      // disable measure if switching to clip
      const lm = refs.current.lengthMeasurement as unknown as { enabled: boolean } | null;
      if (lm) lm.enabled = false;
      if (clipper) {
        clipper.enabled = next === "clip";
        if (next === "clip" && world) {
          // Create a clipping plane on double-click via the clipper's built-in handler
          clipper.visible = true;
        } else if (clipper) {
          clipper.deleteAll();
          clipper.visible = false;
        }
      }
      return next;
    });
  }, []);

  const handleResetTools = useCallback(() => {
    const lm = refs.current.lengthMeasurement as unknown as { enabled: boolean; deleteAll: () => void } | null;
    const clipper = refs.current.clipper;
    if (lm) { lm.enabled = false; lm.deleteAll(); }
    if (clipper) { clipper.enabled = false; clipper.deleteAll(); clipper.visible = false; }
    setActiveTool("none");
  }, []);

  // ── Authoring handlers ─────────────────────────────────────────────────────
  const handleIsolateSelection = useCallback(async () => {
    const { hider, highlighter, fragments } = refs.current;
    if (!hider || !fragments?.initialized) return;
    // Get currently highlighted (selected) items from Highlighter
    const hl = highlighter as unknown as { selection: Record<string, OBC.ModelIdMap> } | null;
    const selected: OBC.ModelIdMap = hl?.selection?.["select"] ?? {};
    if (Object.keys(selected).length === 0) return;
    await hider.isolate(selected);
    setIsolated(true);
  }, []);

  const handleShowAll = useCallback(async () => {
    const { hider } = refs.current;
    if (!hider) return;
    await hider.set(true);
    setIsolated(false);
  }, []);

  const handleFitIsolated = useCallback(async () => {
    const { boundingBoxer, hider, fragments, world } = refs.current;
    if (!boundingBoxer || !fragments?.initialized || !world) return;
    const hl = refs.current.highlighter as unknown as { selection: Record<string, OBC.ModelIdMap> } | null;
    const selected: OBC.ModelIdMap = hl?.selection?.["select"] ?? {};
    if (Object.keys(selected).length === 0) {
      fitCameraToModels(world, fragments);
      return;
    }
    boundingBoxer.dispose();
    await boundingBoxer.addFromModelIdMap(selected);
    const box = boundingBoxer.get();
    if (box.isEmpty()) { fitCameraToModels(world, fragments); return; }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 2;
    world.camera.controls.setLookAt(
      center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist * 0.8,
      center.x, center.y, center.z, true,
    );
    boundingBoxer.dispose();
  }, []);

  const handleSelectStorey = useCallback(async (storey: string) => {
    const { classifier, hider, highlighter, fragments } = refs.current;
    if (!classifier || !hider || !fragments?.initialized) return;
    try {
      const found = await classifier.find({ "Storey": [storey] });
      if (Object.keys(found).length === 0) return;
      await hider.isolate(found);
      setIsolated(true);
      // Also highlight the selection
      const hl = highlighter as unknown as { highlightByID: (name: string, map: OBC.ModelIdMap, removePrevious?: boolean) => Promise<void> } | null;
      await hl?.highlightByID("select", found, true);
    } catch { /* classifier may not have storey data */ }
  }, []);

  // Forward double-click to clipper / length measurement create
  const handleCanvasDoubleClick = useCallback(() => {
    const { clipper, world } = refs.current;
    const lm = refs.current.lengthMeasurement as unknown as { enabled: boolean; create: () => void } | null;
    if (lm?.enabled) { lm.create(); return; }
    if (clipper?.enabled && world) {
      clipper.create(world as Parameters<typeof clipper.create>[0]);
    }
  }, []);

  const bgClass = theme === "dark" ? "bg-[#090910]" : "bg-white";
  const overlayBgClass = theme === "dark" ? "bg-[#090910]/80" : "bg-white/80";

  return (
    <div className={`relative w-full h-full ${bgClass}`}>
      <div
        ref={containerRef}
        className="w-full h-full"
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onContextMenu={handleCanvasContextMenu}
      />

      {/* Loading bar */}
      {loadingState === "loading" && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center ${overlayBgClass} pointer-events-none`}>
          <p className="text-xs text-white/50 mb-3">Loading IFC models…</p>
          <div className="w-56 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/50 rounded-full transition-all duration-500"
              style={{ width: totalCount > 0 ? `${(loadedCount / totalCount) * 100}%` : "0%" }}
            />
          </div>
          <p className="text-[10px] text-white/30 mt-2">
            {loadedCount} / {totalCount}
            {currentFile && <> · <span className="text-white/40">{currentFile}</span></>}
          </p>
        </div>
      )}

      {/* Error */}
      {loadingState === "error" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-red-400/60 text-center">
            Failed to initialize viewer
            {loadError && <><br /><span className="text-[10px] opacity-60">{loadError}</span></>}
          </p>
        </div>
      )}

      {/* Legend + color-by picker */}
      <div className="absolute bottom-3 left-3 flex flex-col items-start gap-1.5">
        {/* Color-by selector */}
        {!selectedClash && (
          <div className="relative" ref={colorPickerRef}>
            <button
              onClick={() => setShowColorPicker((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] text-white/40 hover:text-white/70 bg-black/40 backdrop-blur-sm rounded px-2 py-1 transition-colors select-none"
            >
              Color by
              <span className="text-white/60 font-medium capitalize">
                {typeof colorizeBy === "object" ? `date (${colorizeBy.range.replace("-", " ")})` : colorizeBy}
              </span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {showColorPicker && (
              <div className="absolute bottom-full mb-1 left-0 bg-popover border border-border rounded-md shadow-lg py-1 z-50 min-w-[160px]">
                {(["priority", "status", "assignee", "rule"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setColorizeBy(opt)}
                    className={`w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-accent/60 transition-colors flex items-center gap-2 ${colorizeBy === opt ? "text-foreground font-medium" : "text-foreground/60"}`}
                  >
                    {colorizeBy === opt && <span className="text-primary text-[10px]">✓</span>}
                    {colorizeBy !== opt && <span className="w-3" />}
                    {opt}
                  </button>
                ))}
                <div className="border-t border-border my-1" />
                <p className="px-3 py-1 text-[10px] text-muted-foreground/50 select-none">Date created</p>
                {(["last-hour", "last-day", "last-week", "last-month", "this-year"] as const).map((range) => {
                  const active = typeof colorizeBy === "object" && colorizeBy.range === range;
                  return (
                    <button
                      key={range}
                      onClick={() => setColorizeBy({ dateField: "created", range })}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent/60 transition-colors flex items-center gap-2 ${active ? "text-foreground font-medium" : "text-foreground/60"}`}
                    >
                      {active && <span className="text-primary text-[10px]">✓</span>}
                      {!active && <span className="w-3" />}
                      {range.replace("-", " ")}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Legend swatches */}
        <div className="flex items-center gap-2.5 text-[11px] text-white/55 bg-black/50 backdrop-blur-sm rounded px-3 py-1.5 select-none">
          {selectedClash ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff3b30] shrink-0" />
                {selectedClash.fileA.replace("Building-", "").replace(".ifc", "")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#007aff] shrink-0" />
                {selectedClash.fileB.replace("Building-", "").replace(".ifc", "")}
              </span>
            </>
          ) : colorizeBy === "priority" ? (
            <>
              {Object.entries(PRIORITY_META).map(([k, m]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} />
                  {m.label}
                </span>
              ))}
            </>
          ) : colorizeBy === "status" ? (
            <>
              {Object.entries(STATUS_META).map(([k, m]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} />
                  {m.label}
                </span>
              ))}
            </>
          ) : colorizeBy === "assignee" || colorizeBy === "rule" ? (
            (() => {
              const items = colorizeBy === "assignee"
                ? [...new Set(clashes.map((c) => c.assignee ?? "unassigned"))]
                : [...new Set(clashes.map((c) => c.ruleId))];
              return items.map((key) => (
                <span key={key} className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: `#${PALETTE[stableIndex(key, PALETTE.length)].toString(16).padStart(6, "0")}` }}
                  />
                  <span className="max-w-[80px] truncate">{key}</span>
                </span>
              ));
            })()
          ) : (
            <>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full shrink-0 bg-[#22c55e]" />
                In range
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full shrink-0 bg-[#374151]" />
                Outside
              </span>
            </>
          )}
        </div>
      </div>

      {/* Hint */}
      {loadingState === "done" && !selectedClash && !selectedElement && (
        <div className={`absolute top-3 left-1/2 -translate-x-1/2 text-[11px] pointer-events-none select-none whitespace-nowrap ${theme === "dark" ? "text-white/25" : "text-black/30"}`}>
          Left-drag orbit · Right-drag pan · Scroll zoom · Click object to inspect
        </div>
      )}

      {/* Element properties popover */}
      {selectedElement && (
        <ElementPropertiesPopover
          element={selectedElement}
          loading={loadingProperties}
          onClose={() => setSelectedElement(null)}
        />
      )}

      {/* BCF selection bar */}
      {bcfSelection.length > 0 && onCreateBcfIssue && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2
          bg-background/95 backdrop-blur-sm border border-primary/20 rounded-lg px-3 py-2 shadow-xl">
          <div className="flex items-center gap-1.5 text-[11px] text-foreground/70 max-w-[400px] overflow-x-auto">
            {bcfSelection.map((el, i) => {
              const colors = ["#ff3b30", "#007aff", "#34c759", "#ff9500", "#af52de", "#00c7be", "#ff2d55", "#5856d6"];
              return (
                <span key={el.globalId || i} className="flex items-center gap-1 shrink-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colors[i % colors.length] }} />
                  <span className="font-mono text-[10px] text-foreground/60 max-w-[120px] truncate">
                    {el.globalId || el.modelFilename}
                  </span>
                </span>
              );
            })}
          </div>
          <span className="text-muted-foreground/30 text-[10px]">·</span>
          <span className="text-[10px] text-muted-foreground/50">Shift+click to add</span>
          <button
            onClick={() => onCreateBcfIssue(bcfSelection, getCurrentViewpoint())}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors"
          >
            <FilePlus className="w-3 h-3" />
            Create BCF Issue
          </button>
          <button
            onClick={() => setBcfSelection([])}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Vertical toolbox */}
      <ViewerToolbox
        activeTool={activeTool}
        wireframe={wireframe}
        showGrid={showGrid}
        isolated={isolated}
        onFitView={handleFitView}
        onToggleWireframe={handleToggleWireframe}
        onToggleGrid={handleToggleGrid}
        onToggleMeasure={handleToggleMeasure}
        onToggleClip={handleToggleClip}
        onReset={handleResetTools}
        onIsolate={handleIsolateSelection}
        onShowAll={handleShowAll}
        onFitIsolated={handleFitIsolated}
        onSelectStorey={handleSelectStorey}
        storeys={(() => {
          const classifier = refs.current.classifier;
          if (!classifier) return [];
          const storeyMap = classifier.list.get("Storey");
          if (!storeyMap) return [];
          return Array.from(storeyMap.keys()).sort();
        })()}
      />
    </div>
  );
}

// ── Vertical Toolbox ──────────────────────────────────────────────────────────

interface ToolboxProps {
  activeTool: "none" | "measure" | "clip";
  wireframe: boolean;
  showGrid: boolean;
  isolated: boolean;
  storeys: string[];
  onFitView: () => void;
  onToggleWireframe: () => void;
  onToggleGrid: () => void;
  onToggleMeasure: () => void;
  onToggleClip: () => void;
  onReset: () => void;
  onIsolate: () => void;
  onShowAll: () => void;
  onFitIsolated: () => void;
  onSelectStorey: (storey: string) => void;
}

function ViewerToolbox({
  activeTool,
  wireframe,
  showGrid,
  isolated,
  storeys,
  onFitView,
  onToggleWireframe,
  onToggleGrid,
  onToggleMeasure,
  onToggleClip,
  onReset,
  onIsolate,
  onShowAll,
  onFitIsolated,
  onSelectStorey,
}: ToolboxProps) {
  const [storeyOpen, setStoreyOpen] = useState(false);

  type ToolDef = {
    id: string;
    icon: React.ReactNode;
    tooltip: string;
    active?: boolean;
    onClick: () => void;
    separator?: boolean;
  };

  const viewTools: ToolDef[] = [
    {
      id: "fit",
      icon: <Maximize2 className="w-3.5 h-3.5" />,
      tooltip: "Fit all to view",
      onClick: onFitView,
    },
    {
      id: "grid",
      icon: <Grid3X3 className="w-3.5 h-3.5" />,
      tooltip: showGrid ? "Hide grid" : "Show grid",
      active: showGrid,
      onClick: onToggleGrid,
    },
    {
      id: "wireframe",
      icon: <Box className="w-3.5 h-3.5" />,
      tooltip: wireframe ? "Solid view" : "Wireframe view",
      active: wireframe,
      onClick: onToggleWireframe,
    },
  ];

  const measureTools: ToolDef[] = [
    {
      id: "measure",
      icon: <Ruler className="w-3.5 h-3.5" />,
      tooltip: activeTool === "measure" ? "Stop measuring" : "Length measurement (dbl-click to place)",
      active: activeTool === "measure",
      onClick: onToggleMeasure,
    },
    {
      id: "clip",
      icon: <Scissors className="w-3.5 h-3.5" />,
      tooltip: activeTool === "clip" ? "Remove section planes" : "Section plane (dbl-click to place)",
      active: activeTool === "clip",
      onClick: onToggleClip,
    },
    {
      id: "reset",
      icon: <RotateCcw className="w-3.5 h-3.5" />,
      tooltip: "Clear measurements & section planes",
      onClick: onReset,
    },
  ];

  const authoringTools: ToolDef[] = [
    {
      id: "isolate",
      icon: <Eye className="w-3.5 h-3.5" />,
      tooltip: "Isolate selection (click element first)",
      active: isolated,
      onClick: onIsolate,
    },
    {
      id: "showall",
      icon: <EyeOff className="w-3.5 h-3.5" />,
      tooltip: "Show all elements",
      onClick: onShowAll,
    },
    {
      id: "fitsel",
      icon: <Sun className="w-3.5 h-3.5" />,
      tooltip: "Fit camera to selection",
      onClick: onFitIsolated,
    },
  ];

  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-0.5 bg-black/50 backdrop-blur-sm border border-white/10 rounded-lg p-1">
      {/* View tools */}
      {viewTools.map((t) => (
        <ToolButton key={t.id} icon={t.icon} tooltip={t.tooltip} active={t.active} onClick={t.onClick} />
      ))}

      <div className="w-4 h-px bg-white/10 my-1" />

      {/* Measure tools */}
      {measureTools.map((t) => (
        <ToolButton key={t.id} icon={t.icon} tooltip={t.tooltip} active={t.active} onClick={t.onClick} />
      ))}

      <div className="w-4 h-px bg-white/10 my-1" />

      {/* Authoring tools */}
      {authoringTools.map((t) => (
        <ToolButton key={t.id} icon={t.icon} tooltip={t.tooltip} active={t.active} onClick={t.onClick} />
      ))}

      {/* Storey picker */}
      {storeys.length > 0 && (
        <div className="relative">
          <ToolButton
            icon={<ChevronDown className="w-3.5 h-3.5" />}
            tooltip="Isolate by storey"
            onClick={() => setStoreyOpen((v) => !v)}
            active={storeyOpen}
          />
          {storeyOpen && (
            <div className="absolute right-full mr-2 top-0 bg-popover border border-border rounded-md shadow-lg py-1 z-50 min-w-[140px] max-h-56 overflow-y-auto">
              <p className="px-3 py-1 text-[10px] text-muted-foreground/50 select-none">Building Storey</p>
              {storeys.map((s) => (
                <button
                  key={s}
                  onClick={() => { onSelectStorey(s); setStoreyOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/60 transition-colors text-foreground/70"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  icon,
  tooltip,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  tooltip: string;
  active?: boolean;
  onClick: () => void;
}) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div className="relative group" onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)}>
      <button
        onClick={onClick}
        className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
          active
            ? "bg-primary/80 text-primary-foreground"
            : "text-white/50 hover:text-white hover:bg-white/10"
        }`}
      >
        {icon}
      </button>
      {showTip && (
        <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap bg-popover border border-border text-foreground text-[10px] rounded px-2 py-1 shadow-lg pointer-events-none z-50">
          {tooltip}
        </div>
      )}
    </div>
  );
}

// ── Element Properties Popover ────────────────────────────────────────────────

function ElementPropertiesPopover({
  element,
  loading,
  onClose,
}: {
  element: SelectedElementInfo;
  loading: boolean;
  onClose: () => void;
}) {
  const props = Object.entries(element.properties);

  return (
    <div
      className="absolute z-30 pointer-events-auto"
      style={{
        left: Math.min(element.screenPosition.x + 12, window.innerWidth - 300),
        top: Math.max(element.screenPosition.y - 20, 8),
      }}
    >
      <div className="w-72 rounded-lg border border-primary/20 bg-background/95 backdrop-blur-sm shadow-xl text-[11px]">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
          <span className="font-semibold text-foreground/80 truncate flex-1">
            {element.name ?? element.ifcType}
          </span>
          <span className="text-muted-foreground/50 font-mono text-[10px] shrink-0">
            {element.ifcType}
          </span>
          <button
            onClick={onClose}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Model */}
        <div className="px-3 py-1.5 border-b border-primary/10">
          <span className="text-muted-foreground/40">Model: </span>
          <span className="text-foreground/60">{element.modelFilename.replace(".ifc", "")}</span>
        </div>

        {/* GlobalId */}
        {element.globalId && (
          <div className="px-3 py-1 border-b border-primary/10">
            <span className="text-muted-foreground/40">GlobalId: </span>
            <span className="text-foreground/50 font-mono text-[10px] break-all">{element.globalId}</span>
          </div>
        )}

        {/* Properties */}
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground/40">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Loading properties…</span>
            </div>
          ) : props.length === 0 ? (
            <p className="text-muted-foreground/40 text-center py-3 px-3">
              No properties available. Parse this model to extract data.
            </p>
          ) : (
            <div className="py-1">
              {props.map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 px-3 py-0.5 hover:bg-accent/20">
                  <span className="text-muted-foreground/50 shrink-0 w-32 truncate" title={key}>{key}</span>
                  <span className="text-foreground/70 break-words min-w-0">{String(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBubbleColor(clash: Clash, colorizeBy: ColorizeBy): number {
  if (colorizeBy === "priority") {
    return PRIORITY_COLORS[clash.priority] ?? 0x6b7280;
  }
  if (colorizeBy === "status") {
    return STATUS_COLORS[clash.status] ?? 0x6b7280;
  }
  if (colorizeBy === "assignee") {
    const key = clash.assignee ?? "unassigned";
    return PALETTE[stableIndex(key, PALETTE.length)];
  }
  if (colorizeBy === "rule") {
    return PALETTE[stableIndex(clash.ruleId, PALETTE.length)];
  }
  // date-based
  if (typeof colorizeBy === "object") {
    const dateStr = clash.createdAt;
    const clashTime = new Date(dateStr).getTime();
    const now = Date.now();
    let cutoff: number;
    switch (colorizeBy.range) {
      case "last-hour":  cutoff = now - 60 * 60 * 1000; break;
      case "last-day":   cutoff = now - 24 * 60 * 60 * 1000; break;
      case "last-week":  cutoff = now - 7 * 24 * 60 * 60 * 1000; break;
      case "last-month": cutoff = now - 30 * 24 * 60 * 60 * 1000; break;
      case "this-year": {
        const y = new Date().getFullYear();
        cutoff = new Date(y, 0, 1).getTime();
        break;
      }
    }
    return clashTime >= cutoff ? DATE_IN_COLOR : DATE_OUT_COLOR;
  }
  return 0x6b7280;
}

function placeBubbles(
  clashes: Clash[],
  group: THREE.Group,
  colorizeBy: ColorizeBy,
  overrides: Map<string, [number, number, number]> = new Map(),
) {
  group.clear();
  const geo = new THREE.SphereGeometry(0.5, 14, 14);
  for (const clash of clashes) {
    const color = getBubbleColor(clash, colorizeBy);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    const pos = overrides.get(clash.guid) ?? clash.midpoint;
    mesh.position.set(...pos);
    mesh.userData.clashGuid = clash.guid;
    group.add(mesh);
  }
}

/**
 * Compute the world-space bounding box of a single IFC element identified by
 * its GlobalId within a given loaded Fragments model.
 *
 * The mesh positions are transformed by both the mesh-local transform AND the
 * model's world matrix so the result is in scene coordinates.
 *
 * Returns null if the element is not found or has no geometry.
 */
async function computeElementBbox(
  model: import("@thatopen/fragments").FragmentsModel,
  guid: string,
): Promise<THREE.Box3 | null> {
  const localIds = await model.getLocalIdsByGuids([guid]);
  const localId = localIds[0];
  if (localId == null) return null;

  const meshDataArrays = await model.getItemsGeometry([localId]);
  const box = new THREE.Box3();
  let hasGeom = false;

  // Compose the model's world matrix with each mesh transform so that the
  // resulting bounding box is in scene (world) coordinates.
  const modelWorld = model.object.matrixWorld;

  for (const meshDataList of meshDataArrays) {
    for (const md of meshDataList) {
      if (!md.positions || md.positions.length === 0) continue;
      const composed = new THREE.Matrix4().multiplyMatrices(modelWorld, md.transform);
      for (let i = 0; i < md.positions.length; i += 3) {
        const v = new THREE.Vector3(md.positions[i], md.positions[i + 1], md.positions[i + 2]);
        v.applyMatrix4(composed);
        box.expandByPoint(v);
        hasGeom = true;
      }
    }
  }

  return hasGeom ? box : null;
}

/**
 * For each clash, resolve element A into its expected model (fileA) and element
 * B into its expected model (fileB), compute their world-space bounding boxes,
 * and place the bubble at the center of the overlap. Falls back to the closest
 * point between the two boxes when they don't overlap, or the center of
 * whichever box was found.
 */
async function refineMidpoints(
  fragments: OBC.FragmentsManager,
  clashes: Clash[],
): Promise<Map<string, [number, number, number]>> {
  const overrides = new Map<string, [number, number, number]>();
  const models = fragments.core.models.list;

  for (const clash of clashes) {
    if (!clash.ifcGuidA && !clash.ifcGuidB) continue;

    // Helper: resolve a GUID, trying the expected model first, then all models.
    const resolve = async (
      guid: string | undefined,
      expectedFile: string | undefined,
    ): Promise<THREE.Box3 | null> => {
      if (!guid) return null;

      // Try expected model first
      if (expectedFile) {
        const target = models.get(expectedFile);
        if (target) {
          try {
            const bbox = await computeElementBbox(target, guid);
            if (bbox) return bbox;
          } catch { /* not in this model */ }
        }
      }

      // Fallback: scan all models
      for (const model of models.values()) {
        try {
          const bbox = await computeElementBbox(model, guid);
          if (bbox) return bbox;
        } catch { /* continue */ }
      }

      return null;
    };

    const boxA = await resolve(clash.ifcGuidA, clash.fileA);
    const boxB = await resolve(clash.ifcGuidB, clash.fileB);

    // Both boxes found — try intersection
    if (boxA && boxB) {
      const intersection = boxA.clone().intersect(boxB);
      if (!intersection.isEmpty()) {
        const c = intersection.getCenter(new THREE.Vector3());
        overrides.set(clash.guid, [c.x, c.y, c.z]);
        continue;
      }

      // Boxes don't overlap — use the midpoint between the two closest faces.
      // Clamp the center of each box into the other to approximate the nearest
      // point on each surface, then average.
      const cA = boxA.getCenter(new THREE.Vector3());
      const cB = boxB.getCenter(new THREE.Vector3());
      const nearA = boxB.clampPoint(cA, new THREE.Vector3());
      const nearB = boxA.clampPoint(cB, new THREE.Vector3());
      const mid = nearA.add(nearB).multiplyScalar(0.5);
      overrides.set(clash.guid, [mid.x, mid.y, mid.z]);
      continue;
    }

    // Only one box found — use its center
    const fallback = boxA ?? boxB;
    if (fallback && !fallback.isEmpty()) {
      const c = fallback.getCenter(new THREE.Vector3());
      overrides.set(clash.guid, [c.x, c.y, c.z]);
    }
  }

  return overrides;
}

function fixZFighting(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => {
      m.polygonOffset = true;
      m.polygonOffsetFactor = 1;
      m.polygonOffsetUnits = 1;
    });
  });
}

function tintModel(obj: THREE.Object3D, color: THREE.Color, opacity: number) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => {
      (m as THREE.MeshLambertMaterial).color = color.clone();
      m.transparent = true;
      m.opacity = opacity;
      m.needsUpdate = true;
    });
  });
}

function resetModelAppearance(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => { m.transparent = false; m.opacity = 1; m.needsUpdate = true; });
  });
}

function fitCameraToModels(world: OBCWorld, fragments: OBC.FragmentsManager) {
  const box = new THREE.Box3();
  for (const model of fragments.core.models.list.values()) {
    box.union(model.box);
  }
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const dist = Math.max(size.x, size.y, size.z) * 1.8;

  world.camera.controls.setLookAt(
    center.x + dist * 0.6,
    center.y + dist * 0.5,
    center.z + dist * 0.8,
    center.x, center.y, center.z,
    true
  );
}
