"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type * as OBC from "@thatopen/components";
import type * as FRAGS from "@thatopen/fragments";
import type { Clash } from "@/lib/types";

// IFC files to load from models/test-cde/ via /api/models/
const IFC_FILES = [
  "BIM_3W_Team2_ARCH.ifc",
  "BIM_3W_Team2_STR.ifc",
  "BIM_3W_Team2_MEP.ifc",
  "BIM_3W_Team2_FIRE.ifc",
  "BIM_3W_Team2_GEO.ifc",
  "BIM_3W_Team2_ARCH_Context.ifc",
  "BIM_3W_Team2_ARCH_Furniture.ifc",
];

const PRIORITY_COLORS: Record<string, number> = {
  urgent: 0xe24b4a,
  high: 0xf09595,
  medium: 0xba7517,
  low: 0x639922,
  none: 0x6b7280,
};

const COLOR_A = new THREE.Color(0xff3b30); // red — Side A
const COLOR_B = new THREE.Color(0x007aff); // blue — Side B

interface IfcViewerProps {
  selectedClash: Clash | null;
  clashes: Clash[];
}

type LoadingState = "idle" | "loading" | "done" | "error";

type OBCWorld = OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>;

export function IfcViewer({ selectedClash, clashes }: IfcViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<OBCWorld | null>(null);
  const fragmentsManagerRef = useRef<OBC.FragmentsManager | null>(null);
  const modelsRef = useRef<Map<string, FRAGS.FragmentsModel>>(new Map());
  const bubblesGroupRef = useRef<THREE.Group | null>(null);
  const highlightGroupRef = useRef<THREE.Group | null>(null);

  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [loadedCount, setLoadedCount] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Init ThatOpen world ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let cleanupFn: (() => void) | undefined;

    async function init() {
      // Runtime import (safe for client-only bundle)
      const OBCRuntime = await import("@thatopen/components");
      if (disposed) return;

      const components = new OBCRuntime.Components();

      const worlds = components.get(OBCRuntime.Worlds);
      const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();

      world.scene = new OBCRuntime.SimpleScene(components);
      world.renderer = new OBCRuntime.SimpleRenderer(components, container!);
      world.camera = new OBCRuntime.SimpleCamera(components);
      world.scene.setup();
      worldRef.current = world;

      // Scene styling
      world.scene.three.background = new THREE.Color(0x0d0d10);
      world.scene.three.fog = new THREE.FogExp2(0x0d0d10, 0.006);
      const fillLight = new THREE.DirectionalLight(0x8080ff, 0.4);
      fillLight.position.set(-30, 20, -30);
      world.scene.three.add(fillLight);

      // Grid
      world.scene.three.add(new THREE.GridHelper(200, 60, 0x1e1e24, 0x161618));

      // Overlay groups for bubbles + highlight markers
      const bubblesGroup = new THREE.Group();
      const highlightGroup = new THREE.Group();
      world.scene.three.add(bubblesGroup);
      world.scene.three.add(highlightGroup);
      bubblesGroupRef.current = bubblesGroup;
      highlightGroupRef.current = highlightGroup;

      components.init();

      // ── Fragments manager init ──
      const fragments = components.get(OBCRuntime.FragmentsManager);
      fragmentsManagerRef.current = fragments;

      const workerRes = await fetch("/wasm/worker.mjs");
      const workerBlob = new Blob([await workerRes.text()], { type: "text/javascript" });
      const workerURL = URL.createObjectURL(workerBlob);
      fragments.init(workerURL);

      // Auto-add models to scene + fix z-fighting when any model loads
      fragments.core.onModelLoaded.add((model: FRAGS.FragmentsModel) => {
        model.useCamera(world.camera.three);
        if (!world.scene.three.children.includes(model.object)) {
          world.scene.three.add(model.object);
        }
        fixZFighting(model.object);
        // Register by filename so clash highlight lookup works
        if (!modelsRef.current.has(model.modelId)) {
          modelsRef.current.set(model.modelId, model);
        }
      });

      // Camera update → fragment LOD
      world.camera.controls.addEventListener("update", () => {
        if (fragments.initialized) fragments.core.update();
      });

      // Resize observer
      const ro = new ResizeObserver(() => {
        world.renderer?.resize();
        world.camera.updateAspect();
      });
      ro.observe(container!);

      // ── Load IFC files ──
      setLoadingState("loading");
      const ifcLoader = components.get(OBCRuntime.IfcLoader);
      // absolute: true → path is used as-is: "/wasm/web-ifc.wasm"
      // absolute: false → path is prepended to currentScriptPath (bundle dir) — wrong for Next.js
      await ifcLoader.setup({
        autoSetWasm: false,
        wasm: { path: "/wasm/", absolute: true },
      });

      let loaded = 0;
      for (const filename of IFC_FILES) {
        if (disposed) break;

        // Yield to the event loop so the UI can update the progress bar
        setCurrentFile(filename.replace("BIM_3W_Team2_", "").replace(".ifc", ""));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        try {
          console.log(`[IFC] Fetching ${filename}…`);
          const res = await fetch(`/api/models/${filename}`);
          if (!res.ok) {
            console.warn(`[IFC] Not found: ${filename} (${res.status})`);
          } else {
            const buffer = await res.arrayBuffer();
            console.log(`[IFC] Converting ${filename} (${(buffer.byteLength / 1e6).toFixed(1)} MB)…`);
            // coordinate=true: auto-align all models to a shared origin
            await ifcLoader.load(new Uint8Array(buffer), true, filename);
            console.log(`[IFC] Loaded ${filename}`);
          }
        } catch (err) {
          console.warn(`[IFC] Failed: ${filename}`, err);
        }
        loaded++;
        setLoadedCount(loaded);
      }

      if (!disposed) {
        setLoadingState("done");
        placeBubbles(clashes, bubblesGroup);
        fitCameraToModels(world, fragments);
      }

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Selected clash → highlight models + fly camera ──────────────────────────
  useEffect(() => {
    const highlightGroup = highlightGroupRef.current;
    const fragments = fragmentsManagerRef.current;
    if (!highlightGroup) return;

    // Clear markers
    highlightGroup.clear();

    // Reset all model opacities
    if (fragments?.initialized) {
      for (const model of fragments.core.models.list.values()) {
        resetModelAppearance(model.object);
      }
    }

    if (!selectedClash) return;

    // Ghost everything, then highlight the two clashing files
    if (fragments?.initialized) {
      for (const model of fragments.core.models.list.values()) {
        const name = model.modelId;
        if (name === selectedClash.fileA) {
          tintModel(model.object, COLOR_A, 0.9);
        } else if (name === selectedClash.fileB) {
          tintModel(model.object, COLOR_B, 0.9);
        } else {
          ghostModel(model.object, 0.06);
        }
      }
    }

    // Clash marker at midpoint
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

    // Fly camera to BCF viewpoint
    const world = worldRef.current;
    if (world) {
      const { cameraPosition: cp, target: tgt } = selectedClash.viewpoint;
      world.camera.controls.setLookAt(cp[0], cp[1], cp[2], tgt[0], tgt[1], tgt[2], true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClash]);

  return (
    <div className="relative w-full h-full bg-[#0d0d10]">
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading bar */}
      {loadingState === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0d10]/80 pointer-events-none">
          <p className="text-xs text-white/50 mb-3">Loading IFC models…</p>
          <div className="w-56 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/50 rounded-full transition-all duration-500"
              style={{ width: `${(loadedCount / IFC_FILES.length) * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-white/30 mt-2">
            {loadedCount} / {IFC_FILES.length}
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
              {selectedClash.fileA.replace("BIM_3W_Team2_", "").replace(".ifc", "")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#007aff] shrink-0" />
              {selectedClash.fileB.replace("BIM_3W_Team2_", "").replace(".ifc", "")}
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
      {loadingState === "done" && !selectedClash && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[11px] text-white/25 pointer-events-none select-none whitespace-nowrap">
          Left-drag orbit · Right-drag pan · Scroll zoom · Click issue to inspect
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function placeBubbles(clashes: Clash[], group: THREE.Group) {
  group.clear();
  const geo = new THREE.SphereGeometry(0.5, 14, 14);
  for (const clash of clashes) {
    const color = PRIORITY_COLORS[clash.priority] ?? 0x6b7280;
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
