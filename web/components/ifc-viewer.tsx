"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import type * as OBC from "@thatopen/components";
import type * as FRAGS from "@thatopen/fragments";
import type { Clash, ClashViewpoint } from "@/lib/types";
import type { IfcModelEntry } from "@/components/model-manager";
import type { BcfSelectedElement } from "@/components/bcf-create-dialog";
import { X, Loader2, FilePlus } from "lucide-react";

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
}

export function IfcViewer({ selectedClash, clashes, theme, models, colorizeBy: colorizeByProp, onCreateBcfIssue }: IfcViewerProps) {
  const [colorizeByInternal] = useState<ColorizeBy>("priority");
  const colorizeBy: ColorizeBy = colorizeByProp ?? colorizeByInternal;

  // Multi-element selection for BCF issue creation
  const [bcfSelection, setBcfSelection] = useState<BcfSelectedElement[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const refs = useRef<ViewerRefs>({
    components: null,
    world: null,
    fragments: null,
    ifcLoader: null,
    bubblesGroup: null,
    highlightGroup: null,
    grid: null,
    loadedFiles: new Set(),
  });

  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Selection popover state
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [loadingProperties, setLoadingProperties] = useState(false);

  // ── Init ThatOpen world ─────────────────────────────────────────────────────
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

      const bgColor = new THREE.Color(0x0d0d10);
      world.scene.three.background = bgColor;
      world.scene.three.fog = new THREE.FogExp2(bgColor.getHex(), 0.006);

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
      };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load models when list changes ──────────────────────────────────────────
  useEffect(() => {
    if (!models || models.length === 0) return;
    const { ifcLoader, loadedFiles, world, fragments, bubblesGroup } = refs.current;
    if (!ifcLoader || !world) return;

    const toLoad = models.filter((m) => !loadedFiles.has(m.filename));
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

      if (bubblesGroup) placeBubbles(clashes, bubblesGroup, colorizeBy);
      if (world && fragments) fitCameraToModels(world, fragments);
    }

    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // ── Fallback: load hardcoded models when no models prop ─────────────────────
  useEffect(() => {
    if (models && models.length > 0) return;
    const { ifcLoader, world, fragments, bubblesGroup } = refs.current;
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

      if (bubblesGroup) placeBubbles(clashes, bubblesGroup, colorizeBy);
      if (world && fragments) fitCameraToModels(world, fragments);
    }

    // Delay slightly to allow init to complete
    const t = setTimeout(loadDefaults, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const { highlightGroup, fragments, world } = refs.current;
    if (!highlightGroup) return;

    highlightGroup.clear();
    setSelectedElement(null);

    if (fragments?.initialized) {
      for (const model of fragments.core.models.list.values()) {
        resetModelAppearance(model.object);
      }
    }

    if (!selectedClash) return;

    if (fragments?.initialized) {
      for (const model of fragments.core.models.list.values()) {
        const name = model.modelId;
        if (name === selectedClash.fileA) tintModel(model.object, COLOR_A, 0.9);
        else if (name === selectedClash.fileB) tintModel(model.object, COLOR_B, 0.9);
        else ghostModel(model.object, 0.06);
      }
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClash]);

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

        // Fetch parsed elements from our DB; match by GlobalId then fall back to first
        const res = await fetch(
          `/api/models/${encodeURIComponent(hitModelId)}/parse`
        );
        if (res.ok) {
          type ElemData = { expressId: number; globalId: string; ifcType: string; name: string | null; properties: Record<string, string> };
          const data: { elements: ElemData[] } = await res.json();

          const elem = (resolvedGlobalId
            ? data.elements.find((el) => el.globalId === resolvedGlobalId)
            : undefined) ?? data.elements[0];

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
                return [...prev.slice(-1), bcfEl];
              });
            } else {
              setBcfSelection([bcfEl]);
            }
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

  const bgClass = theme === "dark" ? "bg-[#090910]" : "bg-white";
  const overlayBgClass = theme === "dark" ? "bg-[#090910]/80" : "bg-white/80";

  return (
    <div className={`relative w-full h-full ${bgClass}`}>
      <div
        ref={containerRef}
        className="w-full h-full"
        onClick={handleCanvasClick}
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

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 text-[11px] text-white/55 bg-black/50 backdrop-blur-sm rounded px-3 py-1.5 select-none">
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
        ) : (
          <>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#e24b4a]" />Urgent</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f09595]" />High</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ba7517]" />Medium</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#639922]" />Low</span>
          </>
        )}
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
          <div className="flex items-center gap-1.5 text-[11px] text-foreground/70">
            {bcfSelection.map((el, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: i === 0 ? "#ff3b30" : "#007aff" }} />
                <span className="font-mono text-[10px] text-foreground/60 max-w-[120px] truncate">
                  {el.globalId || el.modelFilename}
                </span>
              </span>
            ))}
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

function placeBubbles(clashes: Clash[], group: THREE.Group, colorizeBy: ColorizeBy) {
  group.clear();
  const geo = new THREE.SphereGeometry(0.5, 14, 14);
  for (const clash of clashes) {
    const color = getBubbleColor(clash, colorizeBy);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(...clash.midpoint);
    mesh.userData.clashGuid = clash.guid;
    group.add(mesh);
  }
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

function ghostModel(obj: THREE.Object3D, opacity: number) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => { m.transparent = true; m.opacity = opacity; m.needsUpdate = true; });
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
